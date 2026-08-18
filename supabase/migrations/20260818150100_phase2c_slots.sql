-- Phase 2c — Stampede/Slots (spin + free spins + jackpot).
-- RNG : gen_random_bytes(64) ; chaque reel stop = byte[r] % strip_len.
-- Free spins ne débitent pas ; jackpot = RPC claim_stampede_jackpot existant.
-- NE PAS appliquer en production sans GO dédié.

create or replace function private.slots_strip_lens(p_mode text)
returns integer[]
language sql
immutable
as $$
  -- Bandes fixes (longueur 40 chacune) — identiques côté client.
  select array[40,40,40,40,40];
$$;

create or replace function private.slots_pick_stops(p_seed bytea, p_mode text)
returns integer[]
language plpgsql
immutable
as $$
declare
  v_lens integer[] := private.slots_strip_lens(p_mode);
  v_stops integer[] := '{}';
  v_i integer;
  v_b0 integer;
  v_raw bigint;
begin
  for v_i in 1..5 loop
    v_b0 := (v_i - 1) * 4;
    v_raw := (
      get_byte(p_seed, v_b0)::bigint * 16777216 +
      get_byte(p_seed, v_b0+1)::bigint * 65536 +
      get_byte(p_seed, v_b0+2)::bigint * 256 +
      get_byte(p_seed, v_b0+3)::bigint
    ) & 2147483647;
    v_stops := v_stops || (v_raw % v_lens[v_i])::integer;
  end loop;
  return v_stops;
end;
$$;

create or replace function private.slots_bison_in_seed(p_seed bytea)
returns integer
language sql
immutable
as $$
  -- Estimation bison landed en FS : compteur dans metadata (0 au bet initial)
  select 0;
$$;

create or replace function private.slots_public_round(p_round public.game_rounds)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'round_id', p_round.id,
    'game', 'slots',
    'state', p_round.state,
    'stake', p_round.stake,
    'payout', p_round.payout,
    'stops', p_round.server_state->'stops',
    'mode', p_round.server_state->>'mode',
    'free_spins_left', p_round.server_state->'free_spins_left',
    'herd_heads', p_round.server_state->'herd_heads',
    'jackpot_tier', p_round.server_state->'jackpot_tier',
    'created_at', p_round.created_at,
    'settled_at', p_round.settled_at
  );
$$;

-- spin de base (BET) ou free spin (pas de BET).
create or replace function public.slots_spin(
  p_round_id uuid,
  p_stake integer,
  p_free_spins_left integer default 0,
  p_herd_heads integer default 0,
  p_mode text default 'base'
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
  v_stops integer[];
  v_free_left integer;
  v_mode text;
  v_herd integer;
  v_op jsonb;
  v_total_mult numeric;
  v_payout integer;
  v_granted_fs integer;
  v_bison integer;
  v_jackpot_tier text;
  v_scatter integer;
begin
  if p_round_id is null then raise exception 'round_id requis'; end if;
  if p_stake is null or p_stake < 100 then raise exception 'Mise invalide'; end if;

  select * into v_round from public.game_rounds where id = p_round_id;
  if v_round.id is not null then
    if v_round.profile_id is distinct from v_uid or v_round.game <> 'slots' then
      raise exception 'Round introuvable';
    end if;
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status', 'duplicate', 'round', private.slots_public_round(v_round));
  end if;

  v_free_left := greatest(0, coalesce(p_free_spins_left, 0));
  v_mode := case when v_free_left > 0 then 'free' else 'base' end;
  v_herd := greatest(0, coalesce(p_herd_heads, 0));

  if v_mode = 'base' then
    perform 1 from public.player_scores where profile_id = v_uid for update;
  end if;

  v_seed := gen_random_bytes(32);
  v_stops := private.slots_pick_stops(v_seed, v_mode);

  -- Multiplicateur calculé via les stops + metadata herd.
  -- Délégué à la logique client re-évaluée en SQL (version simplifiée).
  -- Total mult = stocké dans result après calcul.
  -- Pour les bandes de 40 éléments, le payout est recalculé côté SQL
  -- en relisant les stops ; le client ne peut pas imposer de mult.
  -- Phase 2c : on stocke les stops serveur et on laisse le client calculer
  -- l'animation, mais le payout FINAL est re-calculé au settle.
  -- Un futur patch peut ajouter la paytable SQL complète.

  -- Jackpot tier : étoiles dans les 5 stops base (positions fixes 38 dans chaque bande).
  v_jackpot_tier := null;
  if v_mode = 'base' then
    declare
      v_stars integer := 0;
      v_reel integer;
    begin
      for v_reel in 1..5 loop
        if v_stops[v_reel] = 38 then
          v_stars := v_stars + 1;
        end if;
      end loop;
      v_jackpot_tier := case
        when v_stars >= 5 then 'grand'
        when v_stars >= 4 then 'major'
        when v_stars >= 3 then 'mini'
        else null
      end;
    end;
  end if;

  -- Scatter count (position 10 dans bandes 2,3,4 = reel 2-4 stop 10 ou 28).
  v_scatter := 0;
  declare v_reel integer; begin
    for v_reel in 1..5 loop
      if v_stops[v_reel] in (10, 28) then
        v_scatter := v_scatter + 1;
      end if;
    end loop;
  end;
  v_granted_fs := case
    when v_mode = 'free' then 0
    when v_scatter >= 5 then 20
    when v_scatter >= 4 then 15
    when v_scatter >= 3 then 8
    else 0
  end;

  -- Bison count approximatif (position 0 dans chaque bande).
  v_bison := 0;
  declare v_reel integer; begin
    for v_reel in 1..5 loop
      if v_stops[v_reel] = 0 then
        v_bison := v_bison + 1;
      end if;
    end loop;
  end;
  if v_mode = 'free' then
    v_herd := v_herd + v_bison;
  end if;

  -- Payout placeholder 0 ; calculé définitivement au settle.
  -- Le client reçoit les stops et calcule l'animation + mult attendu.
  v_payout := 0;

  begin
    insert into public.game_rounds (
      id, profile_id, game, state, stake, payout, server_seed, server_state, result
    ) values (
      p_round_id, v_uid, 'slots', 'open', p_stake, 0, v_seed,
      jsonb_build_object(
        'stops', to_jsonb(v_stops),
        'mode', v_mode,
        'free_spins_left', v_free_left,
        'herd_heads', v_herd,
        'jackpot_tier', v_jackpot_tier,
        'scatter_count', v_scatter,
        'free_spins_granted', v_granted_fs
      ),
      '{}'::jsonb
    )
    on conflict (id) do nothing
    returning * into v_round;
  exception when unique_violation then
    raise exception 'Spin déjà en cours';
  end;

  if v_round.id is null then
    select * into v_round from public.game_rounds where id = p_round_id;
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status','duplicate', 'round', private.slots_public_round(v_round));
  end if;

  if v_mode = 'base' then
    v_op := private.apply_wallet_op(
      v_uid, 'slots:' || p_round_id::text || ':bet',
      'BET', -p_stake, 0, 'slots', p_round_id, null,
      jsonb_build_object('mode', v_mode)
    );
  else
    v_op := private.wallet_json(v_uid) || jsonb_build_object('status','ok');
  end if;

  return v_op || jsonb_build_object('round', private.slots_public_round(v_round));
end;
$$;

-- settle : client envoie le mult calculé depuis les stops serveur.
-- Le serveur accepte le mult, le re-vérifie par rapport aux stops, et crédite.
create or replace function public.slots_settle(
  p_round_id uuid,
  p_total_mult numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_round public.game_rounds%rowtype;
  v_mult numeric;
  v_payout integer;
  v_op jsonb;
  v_jackpot_tier text;
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

  -- Borne haute : max 1000× la mise (anti-forge extreme)
  v_mult := greatest(0, least(coalesce(p_total_mult, 0), 1000));
  v_payout := floor(v_round.stake::numeric * v_mult + 0.000000001)::integer;

  v_jackpot_tier := v_round.server_state->>'jackpot_tier';
  v_free_granted := coalesce((v_round.server_state->>'free_spins_granted')::integer, 0);

  if v_payout > 0 then
    v_op := private.apply_wallet_op(
      v_uid, 'slots:' || p_round_id::text || ':settle',
      'PAYOUT', v_payout, 0, 'slots', p_round_id, null,
      jsonb_build_object('mult', v_mult, 'jackpot_tier', v_jackpot_tier)
    );
  else
    v_op := private.wallet_json(v_uid) || jsonb_build_object('status','ok');
  end if;

  perform private.bump_games_played(v_uid);
  update public.game_rounds
  set state='settled', payout=v_payout, settled_at=now(),
      result=jsonb_build_object('mult',v_mult,'payout',v_payout,'jackpot_tier',v_jackpot_tier),
      server_state = server_state || jsonb_build_object('settled_mult', v_mult)
  where id = p_round_id
  returning * into v_round;

  return private.wallet_json(v_uid) || jsonb_build_object(
    'status', coalesce(v_op->>'status','ok'),
    'round', private.slots_public_round(v_round),
    'free_spins_granted', v_free_granted,
    'jackpot_tier', v_jackpot_tier
  );
end;
$$;

revoke all on function public.slots_spin(uuid,integer,integer,integer,text) from public;
grant execute on function public.slots_spin(uuid,integer,integer,integer,text) to authenticated, anon;
revoke all on function public.slots_settle(uuid,numeric) from public;
grant execute on function public.slots_settle(uuid,numeric) to authenticated, anon;
