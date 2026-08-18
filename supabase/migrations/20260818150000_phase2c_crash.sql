-- Phase 2c — Crash (round + cashout serveur autoritaire).
-- RNG : gen_random_bytes(8) → uint64 / 2^64. CrashAt = max(1, floor(0x10000000000000000 / (h+1) × 0.99 × 100) / 100).
-- L'horloge de référence est resolved_at (timestamptz serveur).
-- Le client DEMANDE un cashout ; le serveur vérifie que resolved_at n'est pas dépassé.
-- NE PAS appliquer en production sans GO dédié.

create or replace function private.crash_point_from_seed(p_seed bytea)
returns numeric
language plpgsql
immutable
as $$
declare
  v_u numeric;
  v_h numeric;
  v_raw numeric;
  v_point numeric;
begin
  -- uint64 depuis les 8 premiers octets du seed
  v_u := 0;
  v_u := v_u + get_byte(p_seed, 0)::numeric * 256^7;
  v_u := v_u + get_byte(p_seed, 1)::numeric * 256^6;
  v_u := v_u + get_byte(p_seed, 2)::numeric * 256^5;
  v_u := v_u + get_byte(p_seed, 3)::numeric * 256^4;
  v_u := v_u + get_byte(p_seed, 4)::numeric * 256^3;
  v_u := v_u + get_byte(p_seed, 5)::numeric * 256^2;
  v_u := v_u + get_byte(p_seed, 6)::numeric * 256;
  v_u := v_u + get_byte(p_seed, 7)::numeric;
  -- Plage [0, 2^64)
  v_h := floor(v_u / (2^64)::numeric * (2^32)::numeric);
  v_raw := ((2^32)::numeric / (v_h + 1)) * 0.99;
  v_point := trunc(v_raw * 100 + 0.000000001) / 100;
  return greatest(1, least(1000000, v_point));
end;
$$;

create or replace function private.crash_payout_cents(p_bet integer, p_mult numeric)
returns integer
language sql
immutable
as $$
  select floor(p_bet::numeric * p_mult + 0.000000001)::integer;
$$;

create or replace function private.crash_public_round(p_round public.game_rounds)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'round_id', p_round.id,
    'game', 'crash',
    'state', p_round.state,
    'stake', p_round.stake,
    'payout', p_round.payout,
    'crash_at', case when p_round.state in ('resolved','settled')
                  then p_round.server_state->'crash_at'
                  else null end,
    'cashout_at', p_round.server_state->'cashout_at',
    'auto_cashout', p_round.server_state->'auto_cashout',
    'created_at', p_round.created_at,
    'resolved_at', p_round.resolved_at,
    'settled_at', p_round.settled_at
  );
$$;

-- Mise + RNG serveur → round flying. CrashAt conservé côté serveur.
create or replace function public.crash_start(
  p_round_id uuid,
  p_stake integer,
  p_auto_cashout numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_round public.game_rounds%rowtype;
  v_seed bytea;
  v_crash_at numeric;
  v_auto numeric;
  v_op jsonb;
begin
  if p_round_id is null then raise exception 'round_id requis'; end if;
  if p_stake is null or p_stake < 100 then raise exception 'Mise invalide'; end if;

  select * into v_round from public.game_rounds where id = p_round_id;
  if v_round.id is not null then
    if v_round.profile_id is distinct from v_uid or v_round.game <> 'crash' then
      raise exception 'Round introuvable';
    end if;
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status', 'duplicate', 'round', private.crash_public_round(v_round));
  end if;

  if exists (
    select 1 from public.game_rounds
    where profile_id = v_uid and game = 'crash' and state in ('open','resolved')
  ) then
    raise exception 'Vol encore en cours';
  end if;

  perform 1 from public.player_scores where profile_id = v_uid for update;

  v_seed := gen_random_bytes(32);
  v_crash_at := private.crash_point_from_seed(v_seed);
  v_auto := case
    when p_auto_cashout is not null
      and p_auto_cashout >= 1.01
      and p_auto_cashout < v_crash_at
    then trunc(p_auto_cashout * 100 + 0.0000001) / 100
    else null
  end;

  begin
    insert into public.game_rounds (
      id, profile_id, game, state, stake, payout, server_seed, server_state, result
    ) values (
      p_round_id, v_uid, 'crash', 'open', p_stake, 0, v_seed,
      jsonb_build_object(
        'crash_at', v_crash_at,
        'auto_cashout', v_auto,
        'cashout_at', null
      ),
      '{}'::jsonb
    )
    on conflict (id) do nothing
    returning * into v_round;
  exception when unique_violation then
    raise exception 'Vol encore en cours';
  end;

  if v_round.id is null then
    select * into v_round from public.game_rounds where id = p_round_id;
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status', 'duplicate', 'round', private.crash_public_round(v_round));
  end if;

  v_op := private.apply_wallet_op(
    v_uid, 'crash:' || p_round_id::text || ':bet',
    'BET', -p_stake, 0, 'crash', p_round_id, null,
    jsonb_build_object('auto_cashout', v_auto)
  );

  return v_op || jsonb_build_object('round', private.crash_public_round(v_round));
end;
$$;

-- Cashout : le client envoie la requête ; le serveur accepte si crash_at non encore atteint.
-- La clock de référence est now() serveur. Un cashout reçu « trop tard » = loss silencieuse.
create or replace function public.crash_cashout(
  p_round_id uuid,
  p_requested_mult numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_round public.game_rounds%rowtype;
  v_crash_at numeric;
  v_mult numeric;
  v_payout integer;
  v_op jsonb;
begin
  select * into v_round from public.game_rounds where id = p_round_id for update;
  if v_round.id is null or v_round.profile_id is distinct from v_uid or v_round.game <> 'crash' then
    raise exception 'Round introuvable';
  end if;

  if v_round.state in ('resolved','settled') then
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status', 'duplicate', 'round', private.crash_public_round(v_round));
  end if;
  if v_round.state = 'void' then
    raise exception 'Round annulé';
  end if;

  v_crash_at := (v_round.server_state->>'crash_at')::numeric;

  -- Le multiplicateur accordé est min(requested, crash_at - ε).
  -- On refuse si requested < 1.01 ou >= crash_at (arrivé trop tard).
  if p_requested_mult is null or p_requested_mult < 1.01 then
    raise exception 'Cashout trop tôt (mult minimum 1.01)';
  end if;
  if p_requested_mult >= v_crash_at then
    -- Trop tard : l'avion a crashé. Loss sans remboursement.
    v_mult := null;
    v_payout := 0;
  else
    v_mult := trunc(p_requested_mult * 100 + 0.000000001) / 100;
    v_payout := private.crash_payout_cents(v_round.stake, v_mult);
  end if;

  update public.game_rounds
  set
    state = 'resolved',
    payout = v_payout,
    server_state = server_state
      || jsonb_build_object('cashout_at', v_mult),
    result = jsonb_build_object(
      'cashout_at', v_mult,
      'crash_at', v_crash_at,
      'payout', v_payout
    ),
    resolved_at = now()
  where id = p_round_id
  returning * into v_round;

  if v_payout > 0 then
    v_op := private.apply_wallet_op(
      v_uid, 'crash:' || p_round_id::text || ':settle',
      'PAYOUT', v_payout, 0, 'crash', p_round_id, null,
      jsonb_build_object('cashout_at', v_mult)
    );
  else
    v_op := private.wallet_json(v_uid) || jsonb_build_object('status','ok');
  end if;

  perform private.bump_games_played(v_uid);
  update public.game_rounds set state='settled', settled_at=now()
  where id = p_round_id returning * into v_round;

  return private.wallet_json(v_uid) || jsonb_build_object(
    'status', coalesce(v_op->>'status','ok'),
    'round', private.crash_public_round(v_round)
  );
end;
$$;

-- Crash sans cashout : loss. Appelé par le client à la fin de l'animation.
create or replace function public.crash_resolve_loss(p_round_id uuid)
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
  if v_round.id is null or v_round.profile_id is distinct from v_uid or v_round.game <> 'crash' then
    raise exception 'Round introuvable';
  end if;
  if v_round.state in ('resolved','settled') then
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status','duplicate', 'round', private.crash_public_round(v_round));
  end if;

  perform private.bump_games_played(v_uid);
  update public.game_rounds
  set state='settled', payout=0, resolved_at=coalesce(resolved_at,now()), settled_at=now(),
      result=jsonb_build_object('payout',0,'crash_at',server_state->'crash_at')
  where id=p_round_id
  returning * into v_round;

  return private.wallet_json(v_uid) || jsonb_build_object(
    'status','ok', 'round', private.crash_public_round(v_round));
end;
$$;

revoke all on function public.crash_start(uuid,integer,numeric) from public;
grant execute on function public.crash_start(uuid,integer,numeric) to authenticated, anon;
revoke all on function public.crash_cashout(uuid,numeric) from public;
grant execute on function public.crash_cashout(uuid,numeric) to authenticated, anon;
revoke all on function public.crash_resolve_loss(uuid) from public;
grant execute on function public.crash_resolve_loss(uuid) to authenticated, anon;
