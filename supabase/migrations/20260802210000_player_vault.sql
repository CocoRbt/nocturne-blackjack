-- Coffre personnel (vault) visible dans le cercle d’amis.
-- Ne peut pas accueillir le solde de base côté client ; sync overwrite comme balance.

alter table public.player_scores
  add column if not exists vault integer not null default 0
  check (vault >= 0);

-- Nouvelle signature (+ p_vault).
drop function if exists public.sync_my_score(integer, integer, integer, integer, integer, text, integer, integer);

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
  v_max_balance constant integer := 50_000_000;
  v_allowed_tables text[] := array['emeraude', 'onyx', 'imperiale', 'privee'];
  v_last_snap integer;
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

  select * into v_prev from public.player_scores where profile_id = v_uid;

  if v_prev.profile_id is not null then
    if v_peak > v_prev.peak_balance
      and v_games <= coalesce(v_prev.games_played, 0)
      and coalesce(v_prev.games_played, 0) > 0
      and v_peak > v_prev.peak_balance + 50_000
    then
      v_peak := v_prev.peak_balance;
    end if;

    -- Anti-abus sur la richesse totale (solde + coffre), pas le solde seul :
    -- un retrait du coffre peut faire bondir le solde sans nouvelles parties.
    v_wealth := v_bal + v_vault;
    v_prev_wealth := coalesce(v_prev.balance, 0) + coalesce(v_prev.vault, 0);
    if v_wealth > v_prev_wealth + 100_000
      and v_games <= coalesce(v_prev.games_played, 0)
    then
      v_bal := v_prev.balance;
      v_vault := coalesce(v_prev.vault, 0);
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

create or replace function public.get_leaderboards()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_circle uuid;
  v_live jsonb;
  v_peak jsonb;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  select circle_id into v_circle from public.profiles where id = v_uid;
  if v_circle is null then
    return jsonb_build_object('live', '[]'::jsonb, 'peak', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.rank), '[]'::jsonb)
  into v_live
  from (
    select
      row_number() over (order by s.balance desc, s.updated_at asc) as rank,
      p.nickname,
      s.balance,
      s.peak_balance,
      s.vault,
      s.games_before_peak,
      s.updated_at,
      (p.id = v_uid) as is_me
    from public.player_scores s
    join public.profiles p on p.id = s.profile_id
    where p.circle_id = v_circle
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.rank), '[]'::jsonb)
  into v_peak
  from (
    select
      row_number() over (order by s.peak_balance desc, s.updated_at asc) as rank,
      p.nickname,
      s.balance,
      s.peak_balance,
      s.vault,
      s.games_before_peak,
      s.updated_at,
      (p.id = v_uid) as is_me
    from public.player_scores s
    join public.profiles p on p.id = s.profile_id
    where p.circle_id = v_circle
  ) t;

  return jsonb_build_object('live', v_live, 'peak', v_peak);
end;
$$;

revoke all on function public.get_leaderboards() from public;
grant execute on function public.get_leaderboards() to authenticated, anon;

create or replace function public.get_my_score()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.player_scores%rowtype;
  v_nick text;
  v_circle_id uuid;
  v_circle_code text;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  select p.nickname, p.circle_id, c.code
    into v_nick, v_circle_id, v_circle_code
  from public.profiles p
  left join public.circles c on c.id = p.circle_id
  where p.id = v_uid;

  select * into v_row from public.player_scores where profile_id = v_uid;

  if v_row.profile_id is null then
    return jsonb_build_object(
      'found', false,
      'nickname', v_nick,
      'circle_id', v_circle_id,
      'circle_code', v_circle_code,
      'in_circle', v_circle_id is not null
    );
  end if;

  return jsonb_build_object(
    'found', true,
    'nickname', v_nick,
    'circle_id', v_circle_id,
    'circle_code', v_circle_code,
    'in_circle', v_circle_id is not null,
    'balance', v_row.balance,
    'peak_balance', v_row.peak_balance,
    'vault', coalesce(v_row.vault, 0),
    'hands_played', v_row.hands_played,
    'blackjacks', v_row.blackjacks,
    'best_streak', v_row.best_streak,
    'highest_table', v_row.highest_table,
    'games_before_peak', coalesce(v_row.games_before_peak, 0),
    'games_played', coalesce(v_row.games_played, 0),
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.get_my_score() from public;
grant execute on function public.get_my_score() to anon, authenticated;
