-- Phase 2b — Mines (round progressif, RNG + payout serveur).
-- NE PAS appliquer en production sans GO dédié.

create or replace function private.mines_multiplier(p_revealed integer, p_mines integer)
returns numeric
language plpgsql
immutable
as $$
declare
  v_acc numeric := 1;
  v_i integer;
  v_tiles constant integer := 25;
begin
  if p_revealed is null or p_revealed <= 0 then
    return 1;
  end if;
  if p_mines < 1 or p_mines > 24 then
    return 0;
  end if;
  if p_revealed > v_tiles - p_mines then
    return 0;
  end if;
  for v_i in 0 .. p_revealed - 1 loop
    v_acc := v_acc * (v_tiles - v_i)::numeric / (v_tiles - p_mines - v_i)::numeric;
  end loop;
  return trunc(v_acc * 0.99 * 100 + 0.000000001) / 100;
end;
$$;

create or replace function private.mines_place(p_mines integer, p_seed bytea)
returns integer[]
language plpgsql
immutable
as $$
declare
  v_idx integer[] := array[
    0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24
  ];
  v_i integer;
  v_j integer;
  v_tmp integer;
  v_out integer[] := '{}';
  v_mines integer;
begin
  v_mines := least(24, greatest(1, p_mines));
  for v_i in reverse 24 .. 1 loop
    v_j := get_byte(p_seed, v_i % 32) % (v_i + 1);
    v_tmp := v_idx[v_i + 1];
    v_idx[v_i + 1] := v_idx[v_j + 1];
    v_idx[v_j + 1] := v_tmp;
  end loop;
  for v_i in 1 .. v_mines loop
    v_out := v_out || v_idx[v_i];
  end loop;
  return v_out;
end;
$$;

create or replace function private.mines_public_round(p_round public.game_rounds)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_revealed jsonb;
  v_mines integer;
  v_gems integer;
  v_mult numeric;
  v_next numeric;
  v_ended boolean;
  v_set jsonb := '[]'::jsonb;
begin
  v_revealed := coalesce(p_round.server_state->'revealed', '[]'::jsonb);
  v_mines := coalesce((p_round.server_state->>'mines')::integer, 1);
  v_gems := jsonb_array_length(v_revealed);
  v_ended := p_round.state in ('resolved', 'settled', 'void');
  v_mult := case
    when v_ended and coalesce(p_round.payout, 0) = 0 and v_gems > 0
      then 0
    else private.mines_multiplier(v_gems, v_mines)
  end;
  v_next := case
    when v_ended then v_mult
    else private.mines_multiplier(v_gems + 1, v_mines)
  end;
  if v_ended then
    v_set := coalesce(p_round.server_state->'mineSet', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'round_id', p_round.id,
    'game', 'mines',
    'state', p_round.state,
    'stake', p_round.stake,
    'payout', p_round.payout,
    'mines', v_mines,
    'revealed', v_revealed,
    'multiplier', v_mult,
    'next_multiplier', v_next,
    'mine_set', v_set,
    'hit_mine', coalesce((p_round.result->>'hit_mine')::boolean, false),
    'created_at', p_round.created_at,
    'resolved_at', p_round.resolved_at,
    'settled_at', p_round.settled_at
  );
end;
$$;

create or replace function private.round_public(p_round public.game_rounds)
returns jsonb
language plpgsql
immutable
as $$
begin
  if p_round.game = 'plinko' then
    return private.plinko_public_round(p_round);
  end if;
  if p_round.game = 'mines' then
    return private.mines_public_round(p_round);
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

create or replace function private.mines_settle_internal(p_round public.game_rounds)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op jsonb;
  v_round public.game_rounds%rowtype := p_round;
begin
  if v_round.state = 'settled' then
    return private.wallet_json(v_round.profile_id) || jsonb_build_object(
      'status', 'duplicate',
      'round', private.mines_public_round(v_round)
    );
  end if;

  if coalesce(v_round.payout, 0) > 0 then
    v_op := private.apply_wallet_op(
      v_round.profile_id,
      'mines:' || v_round.id::text || ':settle',
      'PAYOUT',
      v_round.payout,
      0,
      'mines',
      v_round.id,
      null,
      jsonb_build_object('revealed', v_round.server_state->'revealed')
    );
  else
    v_op := private.wallet_json(v_round.profile_id) || jsonb_build_object('status', 'ok');
  end if;

  if v_round.state is distinct from 'settled' then
    perform private.bump_games_played(v_round.profile_id);
    update public.game_rounds
    set state = 'settled', settled_at = now()
    where id = v_round.id
    returning * into v_round;
  end if;

  return private.wallet_json(v_round.profile_id) || jsonb_build_object(
    'status', coalesce(v_op->>'status', 'ok'),
    'round', private.mines_public_round(v_round)
  );
end;
$$;

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

  -- Un seul round Mines open/resolved à la fois.
  if exists (
    select 1 from public.game_rounds
    where profile_id = v_uid and game = 'mines' and state in ('open', 'resolved')
  ) then
    raise exception 'Manche Mines déjà en cours';
  end if;

  perform 1 from public.player_scores where profile_id = v_uid for update;

  v_seed := gen_random_bytes(32);
  v_set := private.mines_place(v_mines, v_seed);

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

create or replace function public.mines_reveal(p_round_id uuid, p_tile integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_round public.game_rounds%rowtype;
  v_revealed integer[];
  v_set integer[];
  v_mines integer;
  v_hit boolean := false;
  v_auto boolean := false;
  v_mult numeric;
  v_payout integer := 0;
  v_elem integer;
begin
  if p_tile is null or p_tile < 0 or p_tile > 24 then
    raise exception 'Case invalide';
  end if;

  select * into v_round from public.game_rounds where id = p_round_id for update;
  if v_round.id is null or v_round.profile_id is distinct from v_uid or v_round.game <> 'mines' then
    raise exception 'Round introuvable';
  end if;
  if v_round.state <> 'open' then
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status', 'duplicate',
      'round', private.mines_public_round(v_round)
    );
  end if;

  select array_agg(x::integer)
  into v_revealed
  from jsonb_array_elements_text(coalesce(v_round.server_state->'revealed', '[]'::jsonb)) as t(x);
  v_revealed := coalesce(v_revealed, '{}');

  if p_tile = any (v_revealed) then
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status', 'duplicate',
      'round', private.mines_public_round(v_round)
    );
  end if;

  select array_agg(x::integer)
  into v_set
  from jsonb_array_elements_text(v_round.server_state->'mineSet') as t(x);
  v_set := coalesce(v_set, '{}');
  v_mines := coalesce((v_round.server_state->>'mines')::integer, 1);

  v_revealed := v_revealed || p_tile;

  if p_tile = any (v_set) then
    v_hit := true;
    v_payout := 0;
    update public.game_rounds
    set
      state = 'resolved',
      payout = 0,
      server_state = jsonb_set(server_state, '{revealed}', to_jsonb(v_revealed)),
      result = jsonb_build_object('hit_mine', true, 'payout', 0),
      resolved_at = now()
    where id = p_round_id
    returning * into v_round;
    return private.mines_settle_internal(v_round);
  end if;

  v_mult := private.mines_multiplier(array_length(v_revealed, 1), v_mines);
  v_auto := array_length(v_revealed, 1) >= (25 - v_mines);
  if v_auto then
    v_payout := private.plinko_payout_cents(v_round.stake, v_mult);
    update public.game_rounds
    set
      state = 'resolved',
      payout = v_payout,
      server_state = jsonb_set(server_state, '{revealed}', to_jsonb(v_revealed)),
      result = jsonb_build_object('hit_mine', false, 'auto_cash', true, 'payout', v_payout, 'multiplier', v_mult),
      resolved_at = now()
    where id = p_round_id
    returning * into v_round;
    return private.mines_settle_internal(v_round);
  end if;

  update public.game_rounds
  set server_state = jsonb_set(server_state, '{revealed}', to_jsonb(v_revealed))
  where id = p_round_id
  returning * into v_round;

  return private.wallet_json(v_uid) || jsonb_build_object(
    'status', 'ok',
    'round', private.mines_public_round(v_round)
  );
end;
$$;

create or replace function public.mines_cashout(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_round public.game_rounds%rowtype;
  v_gems integer;
  v_mines integer;
  v_mult numeric;
  v_payout integer;
begin
  select * into v_round from public.game_rounds where id = p_round_id for update;
  if v_round.id is null or v_round.profile_id is distinct from v_uid or v_round.game <> 'mines' then
    raise exception 'Round introuvable';
  end if;

  if v_round.state in ('resolved', 'settled') then
    return private.mines_settle_internal(v_round);
  end if;
  if v_round.state <> 'open' then
    raise exception 'Manche Mines inactive';
  end if;

  v_gems := jsonb_array_length(coalesce(v_round.server_state->'revealed', '[]'::jsonb));
  if v_gems < 1 then
    raise exception 'Révéle au moins un diamant avant d''encaisser';
  end if;

  v_mines := coalesce((v_round.server_state->>'mines')::integer, 1);
  v_mult := private.mines_multiplier(v_gems, v_mines);
  v_payout := private.plinko_payout_cents(v_round.stake, v_mult);

  update public.game_rounds
  set
    state = 'resolved',
    payout = v_payout,
    result = jsonb_build_object('hit_mine', false, 'auto_cash', false, 'payout', v_payout, 'multiplier', v_mult),
    resolved_at = now()
  where id = p_round_id
  returning * into v_round;

  return private.mines_settle_internal(v_round);
end;
$$;

create or replace function public.mines_settle(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_round public.game_rounds%rowtype;
begin
  select * into v_round from public.game_rounds where id = p_round_id for update;
  if v_round.id is null or v_round.profile_id is distinct from v_uid or v_round.game <> 'mines' then
    raise exception 'Round introuvable';
  end if;
  if v_round.state = 'open' then
    raise exception 'Manche encore ouverte';
  end if;
  return private.mines_settle_internal(v_round);
end;
$$;

revoke all on function public.mines_start(uuid, integer, integer) from public;
grant execute on function public.mines_start(uuid, integer, integer) to authenticated, anon;
revoke all on function public.mines_reveal(uuid, integer) from public;
grant execute on function public.mines_reveal(uuid, integer) to authenticated, anon;
revoke all on function public.mines_cashout(uuid) from public;
grant execute on function public.mines_cashout(uuid) to authenticated, anon;
revoke all on function public.mines_settle(uuid) from public;
grant execute on function public.mines_settle(uuid) to authenticated, anon;

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
begin
  for v_r in
    select * from public.game_rounds
    where profile_id = v_uid
      and state = 'resolved'
    order by created_at
    for update
  loop
    if v_r.game = 'plinko' then
      perform public.plinko_settle(v_r.id);
      v_settled := v_settled + 1;
    elsif v_r.game = 'mines' then
      perform public.mines_settle(v_r.id);
      v_settled := v_settled + 1;
    end if;
  end loop;

  return private.wallet_json(v_uid) || jsonb_build_object(
    'settled', v_settled,
    'open', public.get_my_open_rounds()->'rounds'
  );
end;
$$;
