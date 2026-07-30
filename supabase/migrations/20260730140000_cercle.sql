-- NOCTURNE cercle — schema + RPCs
-- Projet : Nocturne_Blackjack
-- Auth : anonyme (pas de compte email) + pseudo + code cercle
-- Classements : crédit actuel (live) + record personnel (peak)

create extension if not exists "pgcrypto";

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.circles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default 'Cercle Nocturne',
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  circle_id uuid references public.circles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint profiles_nickname_len check (char_length(nickname) between 2 and 16)
);

-- Pseudo unique dans un même cercle (pas globalement)
create unique index if not exists profiles_circle_nickname_uidx
  on public.profiles (circle_id, lower(nickname))
  where circle_id is not null;

create table if not exists public.player_scores (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  peak_balance integer not null default 0 check (peak_balance >= 0),
  hands_played integer not null default 0,
  blackjacks integer not null default 0,
  best_streak integer not null default 0,
  highest_table text not null default 'emeraude',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.circles enable row level security;
alter table public.profiles enable row level security;
alter table public.player_scores enable row level security;

drop policy if exists "circles read members" on public.circles;
create policy "circles read members"
  on public.circles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.circle_id = circles.id
    )
  );

drop policy if exists "profiles read same circle" on public.profiles;
create policy "profiles read same circle"
  on public.profiles for select
  using (
    id = auth.uid()
    or (
      circle_id is not null
      and circle_id = (select p.circle_id from public.profiles p where p.id = auth.uid())
    )
  );

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "scores read same circle" on public.player_scores;
create policy "scores read same circle"
  on public.player_scores for select
  using (
    exists (
      select 1
      from public.profiles me
      join public.profiles other on other.id = player_scores.profile_id
      where me.id = auth.uid()
        and me.circle_id is not null
        and me.circle_id = other.circle_id
    )
  );

drop policy if exists "scores update self" on public.player_scores;
create policy "scores update self"
  on public.player_scores for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Inserts passent par les RPC security definer (pas de policy insert publique).

-- ---------------------------------------------------------------------------
-- Helpers privés
-- ---------------------------------------------------------------------------

create or replace function private.normalize_code(p_code text)
returns text
language sql
immutable
as $$
  select upper(nullif(trim(p_code), ''));
$$;

create or replace function private.normalize_nickname(p_nickname text)
returns text
language sql
immutable
as $$
  select nullif(trim(p_nickname), '');
$$;

-- ---------------------------------------------------------------------------
-- RPC : rejoindre / créer un cercle (auth anonyme déjà connectée)
-- ---------------------------------------------------------------------------

create or replace function public.join_circle(p_nickname text, p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nick text := private.normalize_nickname(p_nickname);
  v_code text := private.normalize_code(p_code);
  v_circle public.circles%rowtype;
  v_profile public.profiles%rowtype;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;
  if v_nick is null or char_length(v_nick) < 2 or char_length(v_nick) > 16 then
    raise exception 'Pseudo invalide (2–16 caractères)';
  end if;

  if v_code is null then
    -- Créer un nouveau cercle
    loop
      v_code := 'NOC-';
      for i in 1..4 loop
        v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      end loop;
      exit when not exists (select 1 from public.circles c where c.code = v_code);
    end loop;
    insert into public.circles (code, name)
    values (v_code, 'Cercle ' || v_nick)
    returning * into v_circle;
  else
    select * into v_circle from public.circles where code = v_code;
    if not found then
      raise exception 'Code cercle introuvable — vérifie bien les lettres (ex. EVJ ≠ EJV)';
    end if;
  end if;

  -- Pseudo déjà pris dans ce cercle par quelqu'un d'autre ?
  if exists (
    select 1 from public.profiles p
    where p.circle_id = v_circle.id
      and lower(p.nickname) = lower(v_nick)
      and p.id <> v_uid
  ) then
    raise exception 'Pseudo déjà pris dans ce cercle';
  end if;

  insert into public.profiles (id, nickname, circle_id)
  values (v_uid, v_nick, v_circle.id)
  on conflict (id) do update
    set nickname = excluded.nickname,
        circle_id = excluded.circle_id
  returning * into v_profile;

  insert into public.player_scores (profile_id)
  values (v_uid)
  on conflict (profile_id) do nothing;

  return jsonb_build_object(
    'profile_id', v_profile.id,
    'nickname', v_profile.nickname,
    'circle_id', v_circle.id,
    'circle_code', v_circle.code,
    'circle_name', v_circle.name
  );
end;
$$;

revoke all on function public.join_circle(text, text) from public;
grant execute on function public.join_circle(text, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- RPC : synchroniser mon score (live + record)
-- ---------------------------------------------------------------------------

create or replace function public.sync_my_score(
  p_balance integer,
  p_peak_balance integer,
  p_hands_played integer default 0,
  p_blackjacks integer default 0,
  p_best_streak integer default 0,
  p_highest_table text default 'emeraude'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.player_scores%rowtype;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;
  if p_balance is null or p_balance < 0 or p_peak_balance is null or p_peak_balance < 0 then
    raise exception 'Scores invalides';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.circle_id is not null) then
    raise exception 'Rejoins un cercle d''abord';
  end if;

  insert into public.player_scores as s (
    profile_id, balance, peak_balance, hands_played, blackjacks, best_streak, highest_table, updated_at
  ) values (
    v_uid, p_balance, p_peak_balance, p_hands_played, p_blackjacks, p_best_streak, coalesce(p_highest_table, 'emeraude'), now()
  )
  on conflict (profile_id) do update set
    balance = excluded.balance,
    peak_balance = greatest(s.peak_balance, excluded.peak_balance, excluded.balance),
    hands_played = greatest(s.hands_played, excluded.hands_played),
    blackjacks = greatest(s.blackjacks, excluded.blackjacks),
    best_streak = greatest(s.best_streak, excluded.best_streak),
    highest_table = excluded.highest_table,
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'balance', v_row.balance,
    'peak_balance', v_row.peak_balance,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.sync_my_score(integer, integer, integer, integer, integer, text) from public;
grant execute on function public.sync_my_score(integer, integer, integer, integer, integer, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- RPC : classements du cercle courant
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- RPC : quitter le cercle (retire profil + scores du cloud)
-- ---------------------------------------------------------------------------

create or replace function public.leave_circle()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  delete from public.player_scores where profile_id = v_uid;
  update public.profiles
    set circle_id = null
  where id = v_uid;
end;
$$;

revoke all on function public.leave_circle() from public;
grant execute on function public.leave_circle() to authenticated, anon;

-- Realtime (optionnel) : activer dans le dashboard pour public.player_scores
-- comment: Dashboard → Database → Replication → player_scores
