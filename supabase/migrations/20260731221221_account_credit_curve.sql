-- Compte email + courbe d'évolution des crédits du cercle
-- 1) Lecture de son propre score (pull multi-device)
-- 2) Snapshots à chaque sync (si le solde a changé)
-- 3) Série temporelle pour le graphique classement

-- ---------------------------------------------------------------------------
-- Table snapshots
-- ---------------------------------------------------------------------------

create table if not exists public.credit_snapshots (
  id bigserial primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  balance integer not null check (balance >= 0),
  recorded_at timestamptz not null default now()
);

create index if not exists credit_snapshots_profile_time_idx
  on public.credit_snapshots (profile_id, recorded_at desc);

create index if not exists credit_snapshots_circle_time_idx
  on public.credit_snapshots (recorded_at desc);

alter table public.credit_snapshots enable row level security;

drop policy if exists "snapshots read same circle" on public.credit_snapshots;
create policy "snapshots read same circle"
  on public.credit_snapshots for select
  using (
    profile_id = auth.uid()
    or exists (
      select 1
      from public.profiles me
      join public.profiles other on other.id = credit_snapshots.profile_id
      where me.id = auth.uid()
        and me.circle_id is not null
        and me.circle_id = other.circle_id
    )
  );

-- ---------------------------------------------------------------------------
-- Lire son score (même hors cercle — pour sync PC / téléphone)
-- ---------------------------------------------------------------------------

drop policy if exists "scores read self" on public.player_scores;
create policy "scores read self"
  on public.player_scores for select
  using (profile_id = auth.uid());

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
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  select nickname into v_nick from public.profiles where id = v_uid;
  select * into v_row from public.player_scores where profile_id = v_uid;

  if v_row.profile_id is null then
    return jsonb_build_object(
      'found', false,
      'nickname', v_nick
    );
  end if;

  return jsonb_build_object(
    'found', true,
    'nickname', v_nick,
    'balance', v_row.balance,
    'peak_balance', v_row.peak_balance,
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

-- ---------------------------------------------------------------------------
-- Patch sync_my_score : enregistrer un point de courbe si le solde change
-- (garde la logique d'intégrité existante)
-- ---------------------------------------------------------------------------

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
    if v_peak > v_prev.peak_balance
      and v_games <= coalesce(v_prev.games_played, 0)
      and coalesce(v_prev.games_played, 0) > 0
      and v_peak > v_prev.peak_balance + 50_000
    then
      v_peak := v_prev.peak_balance;
    end if;
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

  -- Point de courbe si le solde a bougé (ou premier snapshot)
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
    'games_before_peak', v_row.games_before_peak,
    'games_played', v_row.games_played,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.sync_my_score(integer, integer, integer, integer, integer, text, integer, integer) from public;
grant execute on function public.sync_my_score(integer, integer, integer, integer, integer, text, integer, integer) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Série du cercle (48 h par défaut) pour le graphique
-- ---------------------------------------------------------------------------

create or replace function public.get_circle_credit_series(p_hours integer default 48)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_circle uuid;
  v_hours integer := greatest(1, least(coalesce(p_hours, 48), 168));
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  select circle_id into v_circle from public.profiles where id = v_uid;
  if v_circle is null then
    raise exception 'Rejoins un cercle d''abord';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'nickname', p.nickname,
          'balance', cs.balance,
          't', cs.recorded_at,
          'is_me', (p.id = v_uid)
        )
        order by cs.recorded_at asc
      )
      from public.credit_snapshots cs
      join public.profiles p on p.id = cs.profile_id
      where p.circle_id = v_circle
        and cs.recorded_at >= now() - make_interval(hours => v_hours)
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_circle_credit_series(integer) from public;
grant execute on function public.get_circle_credit_series(integer) to anon, authenticated;
