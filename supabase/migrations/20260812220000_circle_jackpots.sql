-- Jackpots progressifs par cercle (Stampede).
-- Mini / Major / Grand alimentés par 1 % des mises de base.

create table if not exists public.circle_jackpots (
  circle_id uuid primary key references public.circles (id) on delete cascade,
  mini integer not null default 5000 check (mini >= 0),
  major integer not null default 25000 check (major >= 0),
  grand integer not null default 100000 check (grand >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.circle_jackpot_hits (
  id bigserial primary key,
  circle_id uuid not null references public.circles (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  tier text not null check (tier in ('mini', 'major', 'grand')),
  amount integer not null check (amount > 0),
  bet integer not null check (bet > 0),
  created_at timestamptz not null default now()
);

create index if not exists circle_jackpot_hits_circle_created
  on public.circle_jackpot_hits (circle_id, created_at desc);

alter table public.circle_jackpots enable row level security;
alter table public.circle_jackpot_hits enable row level security;

-- Lecture via RPC uniquement.
revoke all on table public.circle_jackpots from public, anon, authenticated;
revoke all on table public.circle_jackpot_hits from public, anon, authenticated;

create or replace function public.ensure_circle_jackpots(p_circle uuid)
returns public.circle_jackpots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.circle_jackpots%rowtype;
begin
  insert into public.circle_jackpots (circle_id, mini, major, grand)
  values (p_circle, 5000, 25000, 100000)
  on conflict (circle_id) do nothing;

  select * into v_row from public.circle_jackpots where circle_id = p_circle for update;
  return v_row;
end;
$$;

create or replace function public.get_circle_jackpots()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_circle uuid;
  v_row public.circle_jackpots%rowtype;
  v_hits jsonb;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  select circle_id into v_circle from public.profiles where id = v_uid;
  if v_circle is null then
    return jsonb_build_object('ok', false, 'in_circle', false);
  end if;

  select * into v_row from public.circle_jackpots where circle_id = v_circle;
  if v_row.circle_id is null then
    v_row := public.ensure_circle_jackpots(v_circle);
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc), '[]'::jsonb)
  into v_hits
  from (
    select h.tier, h.amount, h.created_at, p.nickname
    from public.circle_jackpot_hits h
    join public.profiles p on p.id = h.profile_id
    where h.circle_id = v_circle
    order by h.created_at desc
    limit 8
  ) t;

  return jsonb_build_object(
    'ok', true,
    'in_circle', true,
    'mini', v_row.mini,
    'major', v_row.major,
    'grand', v_row.grand,
    'updated_at', v_row.updated_at,
    'hits', v_hits
  );
end;
$$;

revoke all on function public.get_circle_jackpots() from public;
grant execute on function public.get_circle_jackpots() to authenticated, anon;

create or replace function public.contribute_stampede_jackpot(p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_circle uuid;
  v_row public.circle_jackpots%rowtype;
  v_bet integer;
  v_mini_add integer;
  v_major_add integer;
  v_grand_add integer;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  v_bet := coalesce(p_bet, 0);
  if v_bet < 100 or v_bet > 5_000_000 then
    raise exception 'Mise invalide';
  end if;

  select circle_id into v_circle from public.profiles where id = v_uid;
  if v_circle is null then
    raise exception 'Rejoins un cercle d''abord';
  end if;

  v_row := public.ensure_circle_jackpots(v_circle);

  -- 0,5 % / 0,3 % / 0,2 % (arrondi bas).
  v_mini_add := greatest(1, (v_bet * 5) / 1000);
  v_major_add := greatest(1, (v_bet * 3) / 1000);
  v_grand_add := greatest(1, (v_bet * 2) / 1000);

  update public.circle_jackpots
  set
    mini = mini + v_mini_add,
    major = major + v_major_add,
    grand = grand + v_grand_add,
    updated_at = now()
  where circle_id = v_circle
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'mini', v_row.mini,
    'major', v_row.major,
    'grand', v_row.grand,
    'added', jsonb_build_object(
      'mini', v_mini_add,
      'major', v_major_add,
      'grand', v_grand_add
    )
  );
end;
$$;

revoke all on function public.contribute_stampede_jackpot(integer) from public;
grant execute on function public.contribute_stampede_jackpot(integer) to authenticated, anon;

create or replace function public.claim_stampede_jackpot(
  p_tier text,
  p_bet integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_circle uuid;
  v_row public.circle_jackpots%rowtype;
  v_score public.player_scores%rowtype;
  v_tier text;
  v_bet integer;
  v_amount integer;
  v_seed integer;
  v_max_claim constant integer := 5_000_000;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  v_tier := lower(trim(both from coalesce(p_tier, '')));
  if v_tier not in ('mini', 'major', 'grand') then
    raise exception 'Palier invalide';
  end if;

  v_bet := coalesce(p_bet, 0);
  if v_bet < 100 or v_bet > 5_000_000 then
    raise exception 'Mise invalide';
  end if;

  select circle_id into v_circle from public.profiles where id = v_uid;
  if v_circle is null then
    raise exception 'Rejoins un cercle d''abord';
  end if;

  v_row := public.ensure_circle_jackpots(v_circle);

  if v_tier = 'mini' then
    v_amount := v_row.mini;
    v_seed := 5000;
  elsif v_tier = 'major' then
    v_amount := v_row.major;
    v_seed := 25000;
  else
    v_amount := v_row.grand;
    v_seed := 100000;
  end if;

  if v_amount <= 0 then
    raise exception 'Jackpot vide';
  end if;
  if v_amount > v_max_claim then
    v_amount := v_max_claim;
  end if;

  if v_tier = 'mini' then
    update public.circle_jackpots
    set mini = v_seed, updated_at = now()
    where circle_id = v_circle;
  elsif v_tier = 'major' then
    update public.circle_jackpots
    set major = v_seed, updated_at = now()
    where circle_id = v_circle;
  else
    update public.circle_jackpots
    set grand = v_seed, updated_at = now()
    where circle_id = v_circle;
  end if;

  select * into v_score from public.player_scores where profile_id = v_uid for update;
  if v_score.profile_id is null then
    insert into public.player_scores (profile_id, balance, peak_balance, vault, updated_at)
    values (v_uid, v_amount, v_amount, 0, now())
    returning * into v_score;
  else
    update public.player_scores
    set
      balance = balance + v_amount,
      peak_balance = greatest(peak_balance, balance + v_amount),
      updated_at = now()
    where profile_id = v_uid
    returning * into v_score;
  end if;

  insert into public.credit_snapshots (profile_id, balance)
  values (v_uid, v_score.balance);

  insert into public.circle_jackpot_hits (circle_id, profile_id, tier, amount, bet)
  values (v_circle, v_uid, v_tier, v_amount, v_bet);

  select * into v_row from public.circle_jackpots where circle_id = v_circle;

  return jsonb_build_object(
    'ok', true,
    'tier', v_tier,
    'amount', v_amount,
    'balance', v_score.balance,
    'peak_balance', v_score.peak_balance,
    'mini', v_row.mini,
    'major', v_row.major,
    'grand', v_row.grand
  );
end;
$$;

revoke all on function public.claim_stampede_jackpot(text, integer) from public;
grant execute on function public.claim_stampede_jackpot(text, integer) to authenticated, anon;
