-- Phase 2d — Crash : cashout par temps serveur (sans multiplicateur client).
-- La clé : crash_start stocke started_at.
-- crash_cashout() — sans paramètre mult — calcule elapsed, mult courant, vérifie crash.
-- Formule : mult = exp(LN2 / 3500 × elapsed_ms)   (identique au client).
-- NE PAS appliquer en production sans GO dédié.

-- Ajouter started_at si absent (rétrocompat).
alter table public.game_rounds
  add column if not exists started_at timestamptz;

-- Constantes Crash alignées sur src/crash/math.ts
-- CRASH_DOUBLE_MS = 3500  → CRASH_GROWTH = ln(2)/3500
-- mult = exp(CRASH_GROWTH × elapsed_ms)

create or replace function private.crash_mult_at(p_started_at timestamptz)
returns numeric
language sql
stable
as $$
  select trunc(exp(
    ln(2)::numeric / 3500 * extract(epoch from (now() - p_started_at)) * 1000
    + 0.0000000001
  ) * 100 + 0.0000000001) / 100;
$$;

-- crash_start v2 : stocke started_at = now().
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
  v_start timestamptz;
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
  v_start := now();

  begin
    insert into public.game_rounds (
      id, profile_id, game, state, stake, payout, server_seed, server_state, result, started_at
    ) values (
      p_round_id, v_uid, 'crash', 'open', p_stake, 0, v_seed,
      jsonb_build_object(
        'crash_at', v_crash_at,
        'auto_cashout', v_auto,
        'cashout_at', null
      ),
      '{}'::jsonb,
      v_start
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

-- crash_cashout v2 : PAS de mult client. Le serveur calcule lui-même.
-- Signal du client = "je veux encaisser maintenant".
create or replace function public.crash_cashout(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_round public.game_rounds%rowtype;
  v_crash_at numeric;
  v_mult_now numeric;
  v_started_at timestamptz;
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
  if v_round.state = 'void' then raise exception 'Round annulé'; end if;

  v_crash_at := (v_round.server_state->>'crash_at')::numeric;
  v_started_at := coalesce(v_round.started_at, v_round.created_at);
  v_mult_now := private.crash_mult_at(v_started_at);

  -- L'avion a déjà crashé : loss.
  if v_mult_now >= v_crash_at then
    v_mult_now := null;
    v_payout := 0;
  else
    -- Floorer à 2 décimales (aligné client).
    v_mult_now := trunc(v_mult_now * 100 + 0.0000000001) / 100;
    if v_mult_now < 1.01 then
      raise exception 'Cashout trop tôt (multiplicateur minimum 1.01×)';
    end if;
    v_payout := private.crash_payout_cents(v_round.stake, v_mult_now);
  end if;

  update public.game_rounds
  set
    state = 'resolved',
    payout = v_payout,
    server_state = server_state || jsonb_build_object('cashout_at', v_mult_now),
    result = jsonb_build_object(
      'cashout_at', v_mult_now,
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
      jsonb_build_object('cashout_at', v_mult_now)
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

revoke all on function public.crash_start(uuid,integer,numeric) from public;
grant execute on function public.crash_start(uuid,integer,numeric) to authenticated, anon;
revoke all on function public.crash_cashout(uuid) from public;
grant execute on function public.crash_cashout(uuid) to authenticated, anon;

-- Supprimer l'ancienne signature avec multiplicateur client.
drop function if exists public.crash_cashout(uuid, numeric);
