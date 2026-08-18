-- Phase 2b — correctifs adversarial review.
-- NE PAS appliquer en production sans GO dédié.

-- 1) Dès qu'un profil a du ledger, sync_my_score devient lecture seule pour ce profil.
--    Le wallet canonique reste piloté par wallet_ledger + game_rounds.
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

  select * into v_prev from public.player_scores where profile_id = v_uid for update;

  -- Profil déjà migré ledger : le client ne peut plus écrire le wallet courant.
  if exists (select 1 from public.wallet_ledger w where w.profile_id = v_uid) then
    return jsonb_build_object(
      'balance', coalesce(v_prev.balance, 0),
      'peak_balance', coalesce(v_prev.peak_balance, 0),
      'vault', coalesce(v_prev.vault, 0),
      'games_before_peak', coalesce(v_prev.games_before_peak, 0),
      'games_played', coalesce(v_prev.games_played, 0),
      'updated_at', v_prev.updated_at
    );
  end if;

  v_bal := least(p_balance, v_max_balance);
  v_vault := least(p_vault, v_max_balance);
  v_peak := least(greatest(p_peak_balance, p_balance + coalesce(p_vault, 0)), v_max_balance);
  v_games := p_games_played;

  if v_prev.profile_id is not null then
    if v_games < coalesce(v_prev.games_played, 0) then
      v_stale := true;
      v_bal := v_prev.balance;
      v_vault := coalesce(v_prev.vault, 0);
      v_peak := greatest(v_peak, coalesce(v_prev.peak_balance, 0));
      v_games := coalesce(v_prev.games_played, 0);
    end if;

    if not v_stale then
      v_peak := greatest(v_peak, coalesce(v_prev.peak_balance, 0));

      v_vault_delta := v_vault - coalesce(v_prev.vault, 0);
      v_bal_delta := v_bal - coalesce(v_prev.balance, 0);
      v_prev_wealth := coalesce(v_prev.balance, 0) + coalesce(v_prev.vault, 0);
      v_wealth := v_bal + v_vault;

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

  v_peak := least(greatest(v_peak, coalesce(v_prev.peak_balance, 0), v_bal + v_vault), v_max_balance);

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
    peak_balance = greatest(s.peak_balance, excluded.peak_balance, excluded.balance + coalesce(excluded.vault, 0)),
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

-- 2) Mines : un seul round open/resolved par joueur.
create unique index if not exists game_rounds_single_open_mines
  on public.game_rounds (profile_id)
  where game = 'mines' and state in ('open', 'resolved');

-- 3) ACCOUNT_OPENING : refuse tout profil déjà matérialisé dans player_scores
--    sans ledger, même si son état courant vaut zéro.
create or replace function public.open_account_if_needed()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ps public.player_scores%rowtype;
  v_has_ledger boolean;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Profil introuvable';
  end if;

  select exists(
    select 1 from public.wallet_ledger where profile_id = v_uid
  ) into v_has_ledger;

  select * into v_ps from public.player_scores where profile_id = v_uid;

  if v_has_ledger then
    return private.wallet_json(v_uid) || jsonb_build_object('status', 'exists');
  end if;

  if v_ps.profile_id is not null then
    raise exception 'Compte existant : migration ledger dédiée requise';
  end if;

  return private.apply_wallet_op(
    v_uid,
    'opening:' || v_uid::text,
    'ACCOUNT_OPENING',
    10000,
    0,
    null,
    null,
    null,
    jsonb_build_object('source', 'open_account_if_needed')
  ) || jsonb_build_object('status', 'opened');
end;
$$;

revoke all on function public.open_account_if_needed() from public;
grant execute on function public.open_account_if_needed() to authenticated, anon;

-- 4) Mines : re-check sous lock + message métier stable.
create or replace function public.mines_start(
  p_round_id uuid,
  p_stake integer,
  p_mines integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_round public.game_rounds%rowtype;
  v_mines integer;
  v_seed bytea;
  v_set integer[];
  v_op jsonb;
begin
  if p_round_id is null then
    raise exception 'round_id requis';
  end if;
  if p_stake is null or p_stake < 100 then
    raise exception 'Mise invalide';
  end if;
  v_mines := least(24, greatest(1, coalesce(p_mines, 3)));

  select * into v_round from public.game_rounds where id = p_round_id;
  if v_round.id is not null then
    if v_round.profile_id is distinct from v_uid or v_round.game <> 'mines' then
      raise exception 'Round introuvable';
    end if;
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status', 'duplicate',
      'round', private.mines_public_round(v_round)
    );
  end if;

  perform 1 from public.player_scores where profile_id = v_uid for update;

  if exists (
    select 1 from public.game_rounds
    where profile_id = v_uid and game = 'mines' and state in ('open', 'resolved')
  ) then
    raise exception 'Manche Mines déjà en cours';
  end if;

  v_seed := gen_random_bytes(32);
  v_set := private.mines_place(v_mines, v_seed);

  begin
    insert into public.game_rounds (
      id, profile_id, game, state, stake, payout, server_seed, server_state, result
    ) values (
      p_round_id,
      v_uid,
      'mines',
      'open',
      p_stake,
      0,
      v_seed,
      jsonb_build_object(
        'mines', v_mines,
        'mineSet', to_jsonb(v_set),
        'revealed', '[]'::jsonb,
        'grid', 25
      ),
      '{}'::jsonb
    )
    on conflict (id) do nothing
    returning * into v_round;
  exception
    when unique_violation then
      raise exception 'Manche Mines déjà en cours';
  end;

  if v_round.id is null then
    select * into v_round from public.game_rounds where id = p_round_id;
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status', 'duplicate',
      'round', private.mines_public_round(v_round)
    );
  end if;

  v_op := private.apply_wallet_op(
    v_uid,
    'mines:' || p_round_id::text || ':bet',
    'BET',
    -p_stake,
    0,
    'mines',
    p_round_id,
    null,
    jsonb_build_object('mines', v_mines)
  );

  return v_op || jsonb_build_object(
    'round', private.mines_public_round(v_round)
  );
end;
$$;

revoke all on function public.mines_start(uuid, integer, integer) from public;
grant execute on function public.mines_start(uuid, integer, integer) to authenticated, anon;
