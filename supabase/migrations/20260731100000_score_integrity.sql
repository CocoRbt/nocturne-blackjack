-- Intérité classement : scores uniquement via RPC (parties), pas d’UPDATE client direct.
-- Les RPC security definer (join/leave/sync) contournent le RLS.

drop policy if exists "scores update self" on public.player_scores;

-- Plus d’UPDATE profil côté client (circle_id / nickname via RPC uniquement).
drop policy if exists "profiles update self" on public.profiles;

-- Garde-fous sync anti-abus grossiers (edit localStorage / fetch manuel).
create or replace function public.sync_my_score(
  p_balance integer,
  p_peak_balance integer,
  p_hands_played integer default 0,
  p_blackjacks integer default 0,
  p_best_streak integer default 0,
  p_highest_table text default 'emeraude',
  p_games_before_peak integer default 0,
  p_games_played integer default 0
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
  v_games integer;
  v_max_balance constant integer := 50_000_000; -- 500 000 crédits
  v_allowed_tables text[] := array['emeraude', 'onyx', 'imperiale', 'privee'];
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;
  if p_balance is null or p_balance < 0 or p_peak_balance is null or p_peak_balance < 0 then
    raise exception 'Scores invalides';
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
  v_peak := least(greatest(p_peak_balance, p_balance), v_max_balance);
  v_games := p_games_played;

  select * into v_prev from public.player_scores where profile_id = v_uid;

  if v_prev.profile_id is not null then
    -- Pic qui bondit sans nouvelles parties → ignorer le pic gonflé
    if v_peak > v_prev.peak_balance
      and v_games <= coalesce(v_prev.games_played, 0)
      and coalesce(v_prev.games_played, 0) > 0
      and v_peak > v_prev.peak_balance + 50_000
    then
      v_peak := v_prev.peak_balance;
    end if;
    -- Live qui bondit sans nouvelles parties → garder l’ancien solde
    if v_bal > v_prev.balance + 100_000
      and v_games <= coalesce(v_prev.games_played, 0)
    then
      v_bal := v_prev.balance;
    end if;
  end if;

  insert into public.player_scores as s (
    profile_id, balance, peak_balance, hands_played, blackjacks, best_streak,
    highest_table, games_before_peak, games_played, updated_at
  ) values (
    v_uid, v_bal, v_peak, p_hands_played, p_blackjacks, p_best_streak,
    coalesce(p_highest_table, 'emeraude'), p_games_before_peak, v_games, now()
  )
  on conflict (profile_id) do update set
    balance = excluded.balance,
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

  return jsonb_build_object(
    'balance', v_row.balance,
    'peak_balance', v_row.peak_balance,
    'games_before_peak', v_row.games_before_peak,
    'games_played', v_row.games_played,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.sync_my_score(integer, integer, integer, integer, integer, text, integer, integer) from public;
grant execute on function public.sync_my_score(integer, integer, integer, integer, integer, text, integer, integer) to authenticated, anon;
