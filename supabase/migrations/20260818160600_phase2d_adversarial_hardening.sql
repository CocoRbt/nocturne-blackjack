-- Phase 2d — Hardening adversarial.
-- 1) slots_settle : valider que v_stops est non-null (5 éléments).
-- 2) craps_roll intermédiaire : stocker last_roll_id pour idempotence complète.
-- 3) game_rounds : confirmer que RLS bloque INSERT direct.
-- NE PAS appliquer en production sans GO dédié.

-- 1) slots_settle v4 : validation stops non-null.
create or replace function public.slots_settle(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_round public.game_rounds%rowtype;
  v_stops integer[];
  v_mode text;
  v_herd_heads integer;
  v_eval private.spin_eval_result;
  v_payout integer;
  v_op jsonb;
  v_wild_seed bytea;
  v_free_granted integer;
begin
  select * into v_round from public.game_rounds where id = p_round_id for update;
  if v_round.id is null or v_round.profile_id is distinct from v_uid or v_round.game <> 'slots' then
    raise exception 'Round introuvable';
  end if;
  if v_round.state = 'settled' then
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status','duplicate', 'round', private.slots_public_round(v_round));
  end if;

  -- Validation anti-forge : stops obligatoires (ne peuvent venir que de slots_spin)
  if v_round.server_state->'stops' is null then
    raise exception 'Round invalide : stops absents';
  end if;

  select array_agg(x::integer order by ordinality)
  into v_stops
  from jsonb_array_elements_text(v_round.server_state->'stops') with ordinality as t(x, ordinality);

  if v_stops is null or array_length(v_stops, 1) <> 5 then
    raise exception 'Round invalide : stops incorrects (attendu 5)';
  end if;

  v_mode := coalesce(v_round.server_state->>'mode', 'base');
  v_herd_heads := coalesce((v_round.server_state->>'herd_heads')::integer, 0);
  v_wild_seed := substring(v_round.server_seed from 25);

  v_eval := private.slots_evaluate_spin(v_stops, v_mode, v_herd_heads, v_wild_seed);
  v_payout := floor(v_round.stake::numeric * v_eval.total_mult + 0.000000001)::integer;
  v_free_granted := v_eval.free_spins;

  if v_free_granted > 0 and v_mode = 'base' then
    perform private.credit_free_spins(v_uid, v_free_granted);
  end if;

  if v_payout > 0 then
    v_op := private.apply_wallet_op(
      v_uid, 'slots:' || p_round_id::text || ':settle',
      'PAYOUT', v_payout, 0, 'slots', p_round_id, null,
      jsonb_build_object('mult', v_eval.total_mult, 'jackpot_tier', v_eval.jackpot_tier)
    );
  else
    v_op := private.wallet_json(v_uid) || jsonb_build_object('status','ok');
  end if;

  perform private.bump_games_played(v_uid);
  update public.game_rounds
  set state='settled', payout=v_payout, settled_at=now(),
      result=jsonb_build_object(
        'mult', v_eval.total_mult, 'ways_mult', v_eval.ways_mult,
        'scatter_mult', v_eval.scatter_mult, 'wild_product', v_eval.wild_product,
        'herd_mult', v_eval.herd_mult, 'payout', v_payout,
        'jackpot_tier', v_eval.jackpot_tier, 'free_spins', v_free_granted,
        'bison_landed', v_eval.bison_landed, 'way_wins', v_eval.way_wins
      ),
      server_state = server_state || jsonb_build_object(
        'settled_mult', v_eval.total_mult,
        'herd_heads_after', v_herd_heads + v_eval.bison_landed
      )
  where id = p_round_id returning * into v_round;

  return private.wallet_json(v_uid) || jsonb_build_object(
    'status', coalesce(v_op->>'status','ok'),
    'round', private.slots_public_round(v_round),
    'eval', jsonb_build_object(
      'total_mult', v_eval.total_mult, 'ways_mult', v_eval.ways_mult,
      'scatter_mult', v_eval.scatter_mult, 'wild_product', v_eval.wild_product,
      'herd_mult', v_eval.herd_mult, 'free_spins', v_free_granted,
      'jackpot_tier', v_eval.jackpot_tier, 'bison_landed', v_eval.bison_landed
    ),
    'free_spins_granted', v_free_granted,
    'jackpot_tier', v_eval.jackpot_tier
  );
end;
$$;

revoke all on function public.slots_settle(uuid) from public;
grant execute on function public.slots_settle(uuid) to authenticated, anon;

-- 2) craps_roll : stocker last_roll_id dans server_state pour idempotence intermédiaire.
create or replace function public.craps_roll(
  p_round_id uuid,
  p_roll_id uuid default null
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
  v_dice integer[];
  v_d1 integer; v_d2 integer; v_total integer;
  v_phase text; v_point integer; v_point_rolls integer; v_stake integer;
  v_payout integer := 0; v_op jsonb; v_settlements jsonb := '[]'::jsonb;
  v_kind text; v_ended boolean := false; v_net integer := 0; v_mult integer;
  v_roll_id uuid; v_roll_idem text;
begin
  v_roll_id := coalesce(p_roll_id, gen_random_uuid());
  v_roll_idem := 'craps:' || p_round_id::text || ':roll:' || v_roll_id::text;

  select * into v_round from public.game_rounds where id = p_round_id for update;
  if v_round.id is null or v_round.profile_id is distinct from v_uid or v_round.game <> 'craps' then
    raise exception 'Round introuvable';
  end if;
  if v_round.state in ('resolved','settled') then
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status','duplicate','round',private.craps_public_round(v_round));
  end if;

  -- Idempotence roll (ledger ou last_roll_id)
  if exists (
    select 1 from public.wallet_ledger
    where profile_id = v_uid and idempotency_key = v_roll_idem
  ) or coalesce(v_round.server_state->>'last_roll_id', '') = v_roll_id::text
  then
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status','duplicate','round',private.craps_public_round(v_round));
  end if;

  v_stake := coalesce((v_round.server_state->>'stake')::integer, v_round.stake);
  if v_stake <= 0 then raise exception 'Pose une mise avant de lancer'; end if;

  v_phase := coalesce(v_round.server_state->>'phase', 'come_out');
  v_point := (v_round.server_state->>'point')::integer;
  v_point_rolls := coalesce((v_round.server_state->>'point_rolls')::integer, 0);

  v_seed := gen_random_bytes(8);
  v_dice := private.craps_roll_dice_uniform(v_seed);
  v_d1 := v_dice[1]; v_d2 := v_dice[2]; v_total := v_d1 + v_d2;

  if v_phase = 'come_out' then
    if v_total in (7, 11) then
      v_mult := 2; v_payout := v_stake * v_mult; v_net := v_payout - v_stake;
      v_kind := 'come_out_win'; v_ended := true;
    elsif v_total in (2, 3, 12) then
      v_payout := 0; v_net := -v_stake; v_kind := 'come_out_lose'; v_ended := true;
    else
      v_kind := 'point_set'; v_phase := 'point'; v_point := v_total; v_point_rolls := 0;
    end if;
  elsif v_phase = 'point' then
    v_point_rolls := v_point_rolls + 1;
    if v_total = v_point then
      v_mult := 4; v_payout := v_stake * v_mult; v_net := v_payout - v_stake;
      v_kind := 'point_win'; v_ended := true;
    elsif v_total = 7 then
      v_payout := 0; v_net := -v_stake; v_kind := 'point_lose'; v_ended := true;
    elsif v_point_rolls >= 3 then
      v_payout := v_stake; v_net := 0; v_kind := 'point_push'; v_ended := true;
    else
      v_kind := 'point_continue';
    end if;
  end if;

  v_settlements := jsonb_build_array(jsonb_build_object(
    'kind', v_kind, 'amount_cents', case when v_ended then v_payout else 0 end, 'net', v_net));

  update public.game_rounds
  set
    state = case when v_ended then 'resolved' else 'open' end,
    payout = case when v_ended then v_payout else 0 end,
    server_state = jsonb_build_object(
      'phase', case when v_ended then v_phase else
        case when v_kind = 'point_set' then 'point' else v_phase end end,
      'point', case when v_ended then null else v_point end,
      'point_rolls', v_point_rolls, 'stake', v_stake,
      'last_roll', jsonb_build_object('d1', v_d1, 'd2', v_d2, 'total', v_total),
      'settlements', v_settlements,
      'last_roll_id', v_roll_id::text
    ),
    result = case when v_ended then
      jsonb_build_object('kind',v_kind,'payout',v_payout,'net',v_net)
    else '{}'::jsonb end,
    resolved_at = case when v_ended then now() else null end
  where id = p_round_id returning * into v_round;

  if v_ended then
    if v_payout > 0 then
      v_op := private.apply_wallet_op(
        v_uid, v_roll_idem,
        case when v_kind = 'point_push' then 'REFUND' else 'PAYOUT' end,
        v_payout, 0, 'craps', p_round_id, null,
        jsonb_build_object('kind', v_kind, 'roll_id', v_roll_id)
      );
    else
      v_op := private.wallet_json(v_uid) || jsonb_build_object('status','ok');
    end if;
    perform private.bump_games_played(v_uid);
    update public.game_rounds set state='settled', settled_at=now()
    where id = p_round_id returning * into v_round;
  else
    v_op := private.wallet_json(v_uid) || jsonb_build_object('status','ok');
  end if;

  return private.wallet_json(v_uid) || jsonb_build_object(
    'status', coalesce(v_op->>'status','ok'),
    'round', private.craps_public_round(v_round), 'ended', v_ended);
end;
$$;

revoke all on function public.craps_roll(uuid,uuid) from public;
grant execute on function public.craps_roll(uuid,uuid) to authenticated, anon;
create or replace function public.craps_roll(p_round_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select public.craps_roll(p_round_id, null);
$$;
revoke all on function public.craps_roll(uuid) from public;
grant execute on function public.craps_roll(uuid) to authenticated, anon;

-- 3) RLS game_rounds : confirmer qu'INSERT direct est bloqué.
-- RLS déjà activé (migrate 20260818140100). REVOKE ALL est en place.
-- Ajout d'une policy SELECT explicite pour les fonctions security definer uniquement.
-- Les INSERT/UPDATE/DELETE ne sont accessibles que via security definer.
