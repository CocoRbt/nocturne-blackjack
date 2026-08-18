-- Phase 2b — game_rounds + Plinko (premier jeu autoritaire).
-- NE PAS appliquer en production sans GO dédié.

create table if not exists public.game_rounds (
  id              uuid primary key,
  profile_id      uuid not null references public.profiles(id) on delete restrict,
  game            text not null
    check (game in ('plinko', 'mines', 'crash', 'slots', 'craps', 'blackjack')),
  state           text not null
    check (state in ('open', 'resolved', 'settled', 'void')),
  stake           integer not null check (stake > 0),
  payout          integer not null default 0 check (payout >= 0),
  server_seed     bytea not null,
  server_state    jsonb not null default '{}'::jsonb,
  result          jsonb,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  settled_at      timestamptz
);

create index if not exists game_rounds_profile_open
  on public.game_rounds (profile_id, state)
  where state in ('open', 'resolved');

create index if not exists game_rounds_profile_created
  on public.game_rounds (profile_id, created_at desc);

alter table public.game_rounds enable row level security;

-- Pas de SELECT client : mines.server_state.mineSet ne doit pas fuiter.
revoke all on public.game_rounds from public, anon, authenticated;

create or replace function private.plinko_paytable(p_rows integer, p_risk text)
returns numeric[]
language plpgsql
immutable
as $$
begin
  if p_rows = 8 and p_risk = 'low' then
    return array[5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6]::numeric[];
  elsif p_rows = 8 and p_risk = 'medium' then
    return array[13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13]::numeric[];
  elsif p_rows = 8 and p_risk = 'high' then
    return array[29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29]::numeric[];
  elsif p_rows = 12 and p_risk = 'low' then
    return array[10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10]::numeric[];
  elsif p_rows = 12 and p_risk = 'medium' then
    return array[33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33]::numeric[];
  elsif p_rows = 12 and p_risk = 'high' then
    return array[170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170]::numeric[];
  elsif p_rows = 16 and p_risk = 'low' then
    return array[16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16]::numeric[];
  elsif p_rows = 16 and p_risk = 'medium' then
    return array[110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110]::numeric[];
  elsif p_rows = 16 and p_risk = 'high' then
    return array[1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000]::numeric[];
  end if;
  raise exception 'Config Plinko invalide';
end;
$$;

create or replace function private.plinko_payout_cents(p_bet integer, p_mult numeric)
returns integer
language sql
immutable
as $$
  select floor(p_bet::numeric * p_mult + 0.000000001)::integer;
$$;

create or replace function private.plinko_public_round(p_round public.game_rounds)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'round_id', p_round.id,
    'game', p_round.game,
    'state', p_round.state,
    'stake', p_round.stake,
    'payout', p_round.payout,
    'rows', p_round.server_state->'rows',
    'risk', p_round.server_state->'risk',
    'path', p_round.server_state->'path',
    'slot', p_round.server_state->'slot',
    'multiplier', p_round.server_state->'multiplier',
    'created_at', p_round.created_at,
    'resolved_at', p_round.resolved_at,
    'settled_at', p_round.settled_at
  );
$$;

create or replace function private.bump_games_played(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.player_scores
  set
    games_played = coalesce(games_played, 0) + 1,
    updated_at = now()
  where profile_id = p_uid;
end;
$$;

-- Drop : BET + RNG serveur + resolve. Payout connu, pas encore crédité.
create or replace function public.plinko_drop(
  p_round_id uuid,
  p_stake integer,
  p_rows integer,
  p_risk text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_rows integer;
  v_risk text;
  v_round public.game_rounds%rowtype;
  v_seed bytea;
  v_path boolean[];
  v_slot integer := 0;
  v_table numeric[];
  v_mult numeric;
  v_payout integer;
  v_i integer;
  v_op jsonb;
  v_wallet jsonb;
begin
  if p_round_id is null then
    raise exception 'round_id requis';
  end if;
  v_rows := case
    when p_rows <= 8 then 8
    when p_rows <= 12 then 12
    else 16
  end;
  v_risk := lower(coalesce(p_risk, 'medium'));
  if v_risk not in ('low', 'medium', 'high') then
    raise exception 'Risque Plinko invalide';
  end if;
  if p_stake is null or p_stake < 100 then
    raise exception 'Mise invalide';
  end if;

  select * into v_round from public.game_rounds where id = p_round_id;
  if v_round.id is not null then
    if v_round.profile_id is distinct from v_uid or v_round.game <> 'plinko' then
      raise exception 'Round introuvable';
    end if;
    v_wallet := private.wallet_json(v_uid);
    return v_wallet || jsonb_build_object(
      'status', 'duplicate',
      'round', private.plinko_public_round(v_round)
    );
  end if;

  -- Lock wallet avant insert round (concurrence mises).
  perform 1 from public.player_scores where profile_id = v_uid for update;

  v_seed := gen_random_bytes(32);
  v_path := array[]::boolean[];
  for v_i in 0 .. v_rows - 1 loop
    v_path := v_path || array[(get_byte(v_seed, v_i) & 1) = 1];
    if (get_byte(v_seed, v_i) & 1) = 1 then
      v_slot := v_slot + 1;
    end if;
  end loop;

  v_table := private.plinko_paytable(v_rows, v_risk);
  v_mult := v_table[v_slot + 1];
  v_payout := private.plinko_payout_cents(p_stake, v_mult);

  insert into public.game_rounds (
    id, profile_id, game, state, stake, payout, server_seed, server_state, result, resolved_at
  ) values (
    p_round_id,
    v_uid,
    'plinko',
    'resolved',
    p_stake,
    v_payout,
    v_seed,
    jsonb_build_object(
      'rows', v_rows,
      'risk', v_risk,
      'path', to_jsonb(v_path),
      'slot', v_slot,
      'multiplier', v_mult
    ),
    jsonb_build_object('slot', v_slot, 'multiplier', v_mult, 'payout', v_payout),
    now()
  )
  on conflict (id) do nothing
  returning * into v_round;

  if v_round.id is null then
    select * into v_round from public.game_rounds where id = p_round_id;
    if v_round.profile_id is distinct from v_uid or v_round.game <> 'plinko' then
      raise exception 'Round introuvable';
    end if;
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status', 'duplicate',
      'round', private.plinko_public_round(v_round)
    );
  end if;

  v_op := private.apply_wallet_op(
    v_uid,
    'plinko:' || p_round_id::text || ':bet',
    'BET',
    -p_stake,
    0,
    'plinko',
    p_round_id,
    null,
    jsonb_build_object('rows', v_rows, 'risk', v_risk)
  );

  if v_op->>'status' = 'duplicate' then
    select * into v_round from public.game_rounds where id = p_round_id;
  end if;

  return v_op || jsonb_build_object(
    'round', private.plinko_public_round(v_round)
  );
end;
$$;

create or replace function public.plinko_settle(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_round public.game_rounds%rowtype;
  v_op jsonb;
  v_wallet jsonb;
begin
  if p_round_id is null then
    raise exception 'round_id requis';
  end if;

  select * into v_round from public.game_rounds where id = p_round_id for update;
  if v_round.id is null or v_round.profile_id is distinct from v_uid or v_round.game <> 'plinko' then
    raise exception 'Round introuvable';
  end if;

  if v_round.state = 'settled' then
    v_wallet := private.wallet_json(v_uid);
    return v_wallet || jsonb_build_object(
      'status', 'duplicate',
      'round', private.plinko_public_round(v_round)
    );
  end if;

  if v_round.state = 'void' then
    raise exception 'Round annulé';
  end if;

  if v_round.state = 'open' then
    -- Instantané : le drop aurait dû résoudre. Recalcule depuis server_state.
    v_round.state := 'resolved';
    v_round.resolved_at := coalesce(v_round.resolved_at, now());
  end if;

  if coalesce(v_round.payout, 0) > 0 then
    v_op := private.apply_wallet_op(
      v_uid,
      'plinko:' || p_round_id::text || ':settle',
      'PAYOUT',
      v_round.payout,
      0,
      'plinko',
      p_round_id,
      null,
      jsonb_build_object('slot', v_round.server_state->'slot')
    );
  else
    v_op := private.wallet_json(v_uid) || jsonb_build_object('status', 'ok');
  end if;

  if v_round.state is distinct from 'settled' then
    perform private.bump_games_played(v_uid);
    update public.game_rounds
    set state = 'settled', settled_at = now()
    where id = p_round_id
    returning * into v_round;
  end if;

  v_wallet := private.wallet_json(v_uid);
  return v_wallet || jsonb_build_object(
    'status', coalesce(v_op->>'status', 'ok'),
    'round', private.plinko_public_round(v_round)
  );
end;
$$;

revoke all on function public.plinko_drop(uuid, integer, integer, text) from public;
grant execute on function public.plinko_drop(uuid, integer, integer, text) to authenticated, anon;
revoke all on function public.plinko_settle(uuid) from public;
grant execute on function public.plinko_settle(uuid) to authenticated, anon;

create or replace function private.round_public(p_round public.game_rounds)
returns jsonb
language plpgsql
immutable
as $$
begin
  if p_round.game = 'plinko' then
    return private.plinko_public_round(p_round);
  end if;
  return jsonb_build_object(
    'round_id', p_round.id,
    'game', p_round.game,
    'state', p_round.state,
    'stake', p_round.stake,
    'payout', p_round.payout
  );
end;
$$;

-- Récupération refresh : rounds open/resolved du joueur (sanitized).
create or replace function public.get_my_open_rounds()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_out jsonb;
begin
  select coalesce(jsonb_agg(private.round_public(r) order by r.created_at), '[]'::jsonb)
  into v_out
  from public.game_rounds r
  where r.profile_id = v_uid
    and r.state in ('open', 'resolved');
  return jsonb_build_object('rounds', coalesce(v_out, '[]'::jsonb));
end;
$$;

revoke all on function public.get_my_open_rounds() from public;
grant execute on function public.get_my_open_rounds() to authenticated, anon;

-- Auto-settle Plinko resolved (gain non perdu après refresh).
create or replace function public.recover_my_rounds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_r public.game_rounds%rowtype;
  v_settled integer := 0;
  v_last jsonb := '{}'::jsonb;
begin
  for v_r in
    select * from public.game_rounds
    where profile_id = v_uid
      and game = 'plinko'
      and state = 'resolved'
    order by created_at
    for update
  loop
    v_last := public.plinko_settle(v_r.id);
    v_settled := v_settled + 1;
  end loop;

  return private.wallet_json(v_uid) || jsonb_build_object(
    'settled_plinko', v_settled,
    'open', public.get_my_open_rounds()->'rounds'
  );
end;
$$;

revoke all on function public.recover_my_rounds() from public;
grant execute on function public.recover_my_rounds() to authenticated, anon;
