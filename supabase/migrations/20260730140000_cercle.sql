-- NOCTURNE cercle — schema initial (Supabase)
-- À appliquer quand le projet Supabase est connecté.
-- Cercle privé 3–4 amis : pseudo, code, scores, saisons.

create extension if not exists "pgcrypto";

create table if not exists public.circles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default 'Cercle Nocturne',
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null unique,
  circle_id uuid references public.circles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.player_scores (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  balance integer not null default 0,
  peak_balance integer not null default 0,
  hands_played integer not null default 0,
  blackjacks integer not null default 0,
  best_streak integer not null default 0,
  highest_table text not null default 'emeraude',
  updated_at timestamptz not null default now()
);

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  name text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  starting_balance integer not null default 10000
);

create table if not exists public.season_scores (
  season_id uuid references public.seasons (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade,
  peak_balance integer not null default 0,
  net integer not null default 0,
  primary key (season_id, profile_id)
);

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  challenger_id uuid not null references public.profiles (id) on delete cascade,
  opponent_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('race_to', 'survive')),
  target integer not null,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  winner_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.circles enable row level security;
alter table public.profiles enable row level security;
alter table public.player_scores enable row level security;
alter table public.seasons enable row level security;
alter table public.season_scores enable row level security;
alter table public.challenges enable row level security;

-- Membres du même cercle peuvent lire les scores ; chacun écrit le sien.
create policy "profiles read same circle"
  on public.profiles for select
  using (
    circle_id is not null
    and circle_id = (select p.circle_id from public.profiles p where p.id = auth.uid())
    or id = auth.uid()
  );

create policy "profiles upsert self"
  on public.profiles for all
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "scores read same circle"
  on public.player_scores for select
  using (
    exists (
      select 1 from public.profiles me
      join public.profiles other on other.id = player_scores.profile_id
      where me.id = auth.uid() and me.circle_id is not null and me.circle_id = other.circle_id
    )
  );

create policy "scores write self"
  on public.player_scores for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
