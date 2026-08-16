-- Dépôt coffre atomique + retrait sans brûler de crédits au plafond.
-- Bug : dépôt local puis sync rejetée → UI affiche un gros coffre, retrait cloud
-- « Pas assez dans le coffre ». Et withdraw faisait least(bal+amount, max)
-- tout en vidant le coffre → crédits perdus au-delà du plafond.

create or replace function public.deposit_my_vault(p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.player_scores%rowtype;
  v_amount integer;
  v_max_balance constant integer := 2_000_000_000;
  v_starting constant integer := 10_000; -- 100 crédits restent jouables
  v_max_deposit integer;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 or v_amount > v_max_balance then
    raise exception 'Montant invalide';
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_uid and p.circle_id is not null) then
    raise exception 'Rejoins un cercle d''abord';
  end if;

  select * into v_row from public.player_scores where profile_id = v_uid for update;
  if v_row.profile_id is null then
    raise exception 'Score introuvable — synchronise d''abord';
  end if;

  v_max_deposit := greatest(0, coalesce(v_row.balance, 0) - v_starting);
  if v_amount > v_max_deposit then
    raise exception 'Pas assez de surplus à coffrer (garde au moins 100 jouables)';
  end if;

  if coalesce(v_row.vault, 0) + v_amount > v_max_balance then
    raise exception 'Coffre plein — plafond atteint';
  end if;

  update public.player_scores
  set
    balance = balance - v_amount,
    vault = coalesce(vault, 0) + v_amount,
    updated_at = now()
  where profile_id = v_uid
  returning * into v_row;

  insert into public.credit_snapshots (profile_id, balance)
  values (v_uid, v_row.balance);

  return jsonb_build_object(
    'ok', true,
    'amount', v_amount,
    'balance', v_row.balance,
    'vault', v_row.vault,
    'peak_balance', v_row.peak_balance
  );
end;
$$;

revoke all on function public.deposit_my_vault(integer) from public;
grant execute on function public.deposit_my_vault(integer) to authenticated, anon;

create or replace function public.withdraw_my_vault(p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.player_scores%rowtype;
  v_amount integer;
  v_new_bal integer;
  v_max_balance constant integer := 2_000_000_000;
  v_room integer;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 or v_amount > v_max_balance then
    raise exception 'Montant invalide';
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_uid and p.circle_id is not null) then
    raise exception 'Rejoins un cercle d''abord';
  end if;

  select * into v_row from public.player_scores where profile_id = v_uid for update;
  if v_row.profile_id is null then
    raise exception 'Score introuvable — synchronise d''abord';
  end if;

  if coalesce(v_row.vault, 0) < v_amount then
    raise exception 'Pas assez dans le coffre';
  end if;

  -- Ne jamais brûler : si le plafond bloquerait, on refuse plutôt que least().
  v_room := v_max_balance - coalesce(v_row.balance, 0);
  if v_amount > v_room then
    raise exception 'Solde max — tu ne peux retirer que % crédits pour l''instant', greatest(0, v_room / 100);
  end if;

  v_new_bal := coalesce(v_row.balance, 0) + v_amount;

  update public.player_scores
  set
    vault = vault - v_amount,
    balance = v_new_bal,
    peak_balance = greatest(peak_balance, v_new_bal),
    updated_at = now()
  where profile_id = v_uid
  returning * into v_row;

  insert into public.credit_snapshots (profile_id, balance)
  values (v_uid, v_row.balance);

  return jsonb_build_object(
    'ok', true,
    'amount', v_amount,
    'balance', v_row.balance,
    'vault', v_row.vault,
    'peak_balance', v_row.peak_balance
  );
end;
$$;

revoke all on function public.withdraw_my_vault(integer) from public;
grant execute on function public.withdraw_my_vault(integer) to authenticated, anon;

-- Accepte un dépôt local dont la richesse totale est inchangée
-- (ex. cloud 400100 / 0 vs local 100 / 400000) même si les deltas
-- ne matchent pas au centime près après d’autres syncs.
create or replace function public.sync_my_score(
  p_balance integer,
  p_peak_balance integer,
  p_hands_played integer default 0,
  p_blackjacks integer default 0,
  p_best_streak integer default 0,
  p_highest_table text default 'emeraude',
  p_games_before_peak integer default 0,
  p_games_played integer default 0,
  p_vault integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.player_scores%rowtype;
  v_prev public.player_scores%rowtype;
  v_bal integer;
  v_peak integer;
  v_vault integer;
  v_games integer;
  v_wealth integer;
  v_prev_wealth integer;
  v_vault_delta integer;
  v_bal_delta integer;
  v_max_balance constant integer := 2_000_000_000;
  v_starting constant integer := 10_000;
  v_allowed_tables text[] := array['emeraude', 'onyx', 'imperiale', 'privee'];
  v_last_snap integer;
  v_stale boolean := false;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;
  if p_balance is null or p_balance < 0 or p_peak_balance is null or p_peak_balance < 0 then
    raise exception 'Scores invalides';
  end if;
  if p_vault is null or p_vault < 0 then
    raise exception 'vault invalide';
  end if;
  if p_games_before_peak is null or p_games_before_peak < 0 then
    raise exception 'games_before_peak invalide';
  end if;
  if p_games_played is null or p_games_played < 0 then
    raise exception 'games_played invalide';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.circle_id is not null) then
    raise exception 'Rejoins un cercle d''abord';
  end if;
  if p_highest_table is not null and not (p_highest_table = any (v_allowed_tables)) then
    raise exception 'Table invalide';
  end if;

  v_bal := least(p_balance, v_max_balance);
  v_vault := least(p_vault, v_max_balance);
  v_peak := least(greatest(p_peak_balance, p_balance), v_max_balance);
  v_games := p_games_played;

  select * into v_prev from public.player_scores where profile_id = v_uid for update;

  if v_prev.profile_id is not null then
    if v_games < coalesce(v_prev.games_played, 0) then
      v_stale := true;
      v_bal := v_prev.balance;
      v_vault := coalesce(v_prev.vault, 0);
      v_peak := v_prev.peak_balance;
      v_games := coalesce(v_prev.games_played, 0);
    end if;

    if not v_stale then
      if v_peak > v_prev.peak_balance
        and v_games <= coalesce(v_prev.games_played, 0)
        and coalesce(v_prev.games_played, 0) > 0
        and v_peak > v_prev.peak_balance + 50_000
      then
        v_peak := v_prev.peak_balance;
      end if;

      v_vault_delta := v_vault - coalesce(v_prev.vault, 0);
      v_bal_delta := v_bal - coalesce(v_prev.balance, 0);
      v_prev_wealth := coalesce(v_prev.balance, 0) + coalesce(v_prev.vault, 0);
      v_wealth := v_bal + v_vault;

      -- Hausse de coffre : deltas match OU richesse totale stable (dépôt).
      if v_vault_delta > 0 and abs((-v_bal_delta) - v_vault_delta) > 1 then
        if abs(v_wealth - v_prev_wealth) <= 1 then
          null;
        else
          v_vault := coalesce(v_prev.vault, 0);
          v_bal := coalesce(v_prev.balance, 0);
          v_vault_delta := 0;
          v_bal_delta := 0;
          v_wealth := v_prev_wealth;
        end if;
      end if;

      if v_vault_delta < 0 and abs(v_bal_delta - (-v_vault_delta)) > 1 then
        v_vault := coalesce(v_prev.vault, 0);
        v_vault_delta := 0;
        v_bal_delta := v_bal - coalesce(v_prev.balance, 0);
        v_wealth := v_bal + v_vault;
      end if;

      if v_games = coalesce(v_prev.games_played, 0)
        and v_bal < coalesce(v_prev.balance, 0)
        and v_vault_delta = 0
      then
        v_bal := coalesce(v_prev.balance, 0);
        v_bal_delta := 0;
        v_wealth := v_bal + v_vault;
      end if;

      if v_bal_delta > 0
        and v_vault_delta >= 0
        and v_games <= coalesce(v_prev.games_played, 0)
      then
        if coalesce(v_prev.balance, 0) < 100
          and v_bal <= v_starting
          and v_vault_delta = 0
        then
          null;
        elsif v_bal_delta <= 3000 and v_vault_delta = 0 then
          null;
        else
          v_bal := coalesce(v_prev.balance, 0);
          v_wealth := v_bal + v_vault;
        end if;
      end if;

      if v_wealth > v_prev_wealth + 100_000
        and v_games <= coalesce(v_prev.games_played, 0)
      then
        v_bal := v_prev.balance;
        v_vault := coalesce(v_prev.vault, 0);
      end if;
    end if;
  end if;

  insert into public.player_scores as s (
    profile_id, balance, peak_balance, vault, hands_played, blackjacks, best_streak,
    highest_table, games_before_peak, games_played, updated_at
  ) values (
    v_uid, v_bal, v_peak, v_vault, p_hands_played, p_blackjacks, p_best_streak,
    coalesce(p_highest_table, 'emeraude'), p_games_before_peak, v_games, now()
  )
  on conflict (profile_id) do update set
    balance = excluded.balance,
    vault = excluded.vault,
    peak_balance = greatest(s.peak_balance, excluded.peak_balance, excluded.balance),
    hands_played = greatest(s.hands_played, excluded.hands_played),
    blackjacks = greatest(s.blackjacks, excluded.blackjacks),
    best_streak = greatest(s.best_streak, excluded.best_streak),
    highest_table = excluded.highest_table,
    games_played = greatest(s.games_played, excluded.games_played),
    games_before_peak = case
      when greatest(excluded.peak_balance, excluded.balance) > s.peak_balance
        then excluded.games_before_peak
      when s.games_before_peak = 0
        and excluded.games_before_peak > 0
        and greatest(excluded.peak_balance, excluded.balance) >= s.peak_balance
        then excluded.games_before_peak
      else s.games_before_peak
    end,
    updated_at = now()
  returning * into v_row;

  select cs.balance into v_last_snap
  from public.credit_snapshots cs
  where cs.profile_id = v_uid
  order by cs.recorded_at desc
  limit 1;

  if v_last_snap is null or v_last_snap is distinct from v_row.balance then
    insert into public.credit_snapshots (profile_id, balance)
    values (v_uid, v_row.balance);
  end if;

  return jsonb_build_object(
    'balance', v_row.balance,
    'peak_balance', v_row.peak_balance,
    'vault', v_row.vault,
    'games_before_peak', v_row.games_before_peak,
    'games_played', v_row.games_played,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.sync_my_score(integer, integer, integer, integer, integer, text, integer, integer, integer) from public;
grant execute on function public.sync_my_score(integer, integer, integer, integer, integer, text, integer, integer, integer) to authenticated, anon;
