-- Phase 2d — Craps idempotence propre + parité fonctionnelle.
-- L'ancienne idempotency key utilisait clock_timestamp() → pas stable entre retries.
-- Solution : bet_id UUID fourni par le client (stable entre retries).
-- Parité : craps NOCTURNE = 1 mise, come-out × 2, point × 4, push après 3 jets.
-- NE PAS appliquer en production sans GO dédié.

-- craps_place_bet v2 : bet_id stable fourni par le client
create or replace function public.craps_place_bet(
  p_round_id uuid,
  p_stake integer,
  p_bet_id uuid default null   -- stable pour le retry ; si null, gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_round public.game_rounds%rowtype;
  v_op jsonb;
  v_bid uuid;
  v_idem_key text;
  v_existing_amount integer;
begin
  if p_round_id is null then raise exception 'round_id requis'; end if;
  if p_stake is null or p_stake < 100 then raise exception 'Mise invalide'; end if;
  v_bid := coalesce(p_bet_id, gen_random_uuid());
  v_idem_key := 'craps:' || p_round_id::text || ':bet:' || v_bid::text;

  -- Idempotence : si ce bet_id a déjà été traité, retourner duplicate.
  if exists (
    select 1 from public.wallet_ledger
    where profile_id = v_uid and idempotency_key = v_idem_key
  ) then
    select * into v_round from public.game_rounds where id = p_round_id;
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status','duplicate', 'round', private.craps_public_round(v_round));
  end if;

  select * into v_round from public.game_rounds where id = p_round_id;
  if v_round.id is not null then
    if v_round.profile_id is distinct from v_uid or v_round.game <> 'craps' then
      raise exception 'Round introuvable';
    end if;
    if (v_round.server_state->>'phase') = 'point' then
      raise exception 'Attends la fin de la cible pour remiser';
    end if;
    if v_round.state in ('resolved','settled') then
      return private.wallet_json(v_uid) || jsonb_build_object(
        'status','duplicate','round',private.craps_public_round(v_round));
    end if;
  end if;

  perform 1 from public.player_scores where profile_id = v_uid for update;

  if v_round.id is null then
    begin
      insert into public.game_rounds (
        id, profile_id, game, state, stake, payout, server_seed, server_state, result
      ) values (
        p_round_id, v_uid, 'craps', 'open', p_stake, 0,
        gen_random_bytes(1),
        jsonb_build_object(
          'phase', 'come_out',
          'point', null,
          'point_rolls', 0,
          'stake', p_stake,
          'last_roll', null,
          'settlements', '[]'::jsonb
        ),
        '{}'::jsonb
      )
      on conflict (id) do nothing
      returning * into v_round;
    exception when unique_violation then
      raise exception 'Round déjà en cours';
    end;
    if v_round.id is null then
      select * into v_round from public.game_rounds where id = p_round_id;
    end if;
  else
    v_existing_amount := coalesce((v_round.server_state->>'stake')::integer, v_round.stake);
    update public.game_rounds
    set stake = stake + p_stake,
        server_state = jsonb_set(server_state, '{stake}',
          to_jsonb(v_existing_amount + p_stake))
    where id = p_round_id
    returning * into v_round;
  end if;

  v_op := private.apply_wallet_op(
    v_uid, v_idem_key, 'BET', -p_stake, 0, 'craps', p_round_id, null,
    jsonb_build_object('bet_id', v_bid, 'phase', 'come_out')
  );

  return v_op || jsonb_build_object('round', private.craps_public_round(v_round));
end;
$$;

revoke all on function public.craps_place_bet(uuid,integer,uuid) from public;
grant execute on function public.craps_place_bet(uuid,integer,uuid) to authenticated, anon;
-- Ancienne signature sans p_bet_id conservée comme wrapper.
create or replace function public.craps_place_bet(p_round_id uuid, p_stake integer)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.craps_place_bet(p_round_id, p_stake, null);
$$;
revoke all on function public.craps_place_bet(uuid,integer) from public;
grant execute on function public.craps_place_bet(uuid,integer) to authenticated, anon;

-- craps_roll v2 : idempotency par roll_id stable (uuid client)
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
  v_d1 integer;
  v_d2 integer;
  v_total integer;
  v_phase text;
  v_point integer;
  v_point_rolls integer;
  v_stake integer;
  v_payout integer := 0;
  v_op jsonb;
  v_settlements jsonb := '[]'::jsonb;
  v_kind text;
  v_ended boolean := false;
  v_net integer := 0;
  v_mult integer;
  v_roll_id uuid;
  v_roll_idem text;
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

  -- Idempotence roll
  if exists (
    select 1 from public.wallet_ledger
    where profile_id = v_uid and idempotency_key = v_roll_idem
  ) then
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
  v_d1 := v_dice[1]; v_d2 := v_dice[2];
  v_total := v_d1 + v_d2;

  if v_phase = 'come_out' then
    if v_total in (7, 11) then
      v_mult := 2;
      v_payout := v_stake * v_mult;
      v_net := v_payout - v_stake;
      v_kind := 'come_out_win';
      v_ended := true;
    elsif v_total in (2, 3, 12) then
      v_payout := 0;
      v_net := -v_stake;
      v_kind := 'come_out_lose';
      v_ended := true;
    else
      v_kind := 'point_set';
      v_phase := 'point';
      v_point := v_total;
      v_point_rolls := 0;
    end if;
  elsif v_phase = 'point' then
    v_point_rolls := v_point_rolls + 1;
    if v_total = v_point then
      v_mult := 4;
      v_payout := v_stake * v_mult;
      v_net := v_payout - v_stake;
      v_kind := 'point_win';
      v_ended := true;
    elsif v_total = 7 then
      v_payout := 0;
      v_net := -v_stake;
      v_kind := 'point_lose';
      v_ended := true;
    elsif v_point_rolls >= 3 then
      v_payout := v_stake;
      v_net := 0;
      v_kind := 'point_push';
      v_ended := true;
    else
      v_kind := 'point_continue';
    end if;
  end if;

  v_settlements := jsonb_build_array(jsonb_build_object(
    'kind', v_kind,
    'amount_cents', case when v_ended then v_payout else 0 end,
    'net', v_net
  ));

  update public.game_rounds
  set
    state = case when v_ended then 'resolved' else 'open' end,
    payout = case when v_ended then v_payout else 0 end,
    server_state = jsonb_build_object(
      'phase', case when v_ended then v_phase else
        case when v_kind = 'point_set' then 'point' else v_phase end end,
      'point', case when v_ended then null else v_point end,
      'point_rolls', v_point_rolls,
      'stake', v_stake,
      'last_roll', jsonb_build_object('d1', v_d1, 'd2', v_d2, 'total', v_total),
      'settlements', v_settlements
    ),
    result = case when v_ended then
      jsonb_build_object('kind',v_kind,'payout',v_payout,'net',v_net)
    else '{}'::jsonb end,
    resolved_at = case when v_ended then now() else null end
  where id = p_round_id
  returning * into v_round;

  if v_ended then
    if v_payout > 0 then
      v_op := private.apply_wallet_op(
        v_uid, 'craps:' || p_round_id::text || ':settle:' || v_roll_id::text,
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
    'round', private.craps_public_round(v_round),
    'ended', v_ended
  );
end;
$$;

revoke all on function public.craps_roll(uuid,uuid) from public;
grant execute on function public.craps_roll(uuid,uuid) to authenticated, anon;
create or replace function public.craps_roll(p_round_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.craps_roll(p_round_id, null);
$$;
revoke all on function public.craps_roll(uuid) from public;
grant execute on function public.craps_roll(uuid) to authenticated, anon;
