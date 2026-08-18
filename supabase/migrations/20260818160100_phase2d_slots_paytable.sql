-- Phase 2d — Slots paytable SQL complète.
-- Traduit exactement evaluateSpin / evaluateWays / WAY_PAY depuis src/slots/math.ts.
-- Le client NE FOURNIT PLUS de multiplicateur : slots_settle calcule tout depuis les stops serveur.
-- NE PAS appliquer en production sans GO dédié.

-- ─────────────────────────────────────────────────────────
-- Bandes (indexées 0-based, longueur 40)
-- ─────────────────────────────────────────────────────────
create or replace function private.slots_strip(p_reel integer, p_mode text)
returns text[]
language plpgsql
immutable
as $$
begin
  if p_mode = 'free' then
    return case p_reel
      when 1 then array['bison','J','eagle','Q','wolf','K','cougar','A','elk','J','wolf','Q','bison','K','eagle','A','J','cougar','Q','elk','K','wolf','A','eagle','J','Q','cougar','K','bison','A','elk','J','wolf','Q','eagle','K','A','J','cougar','Q']
      when 2 then array['wild','J','eagle','Q','wolf','K','bison','A','elk','J','cougar','Q','eagle','K','bison','A','wolf','J','Q','elk','K','cougar','A','bison','J','eagle','Q','wolf','K','A','elk','J','bison','Q','cougar','K','eagle','A','J','wolf']
      when 3 then array['J','wild','eagle','Q','bison','K','wolf','A','elk','J','cougar','Q','eagle','K','A','wolf','J','bison','Q','elk','K','cougar','A','eagle','J','Q','wolf','K','bison','A','J','elk','Q','cougar','K','eagle','A','J','wolf','Q']
      when 4 then array['J','eagle','wild','Q','wolf','K','bison','A','elk','J','cougar','Q','eagle','K','A','wolf','J','bison','Q','elk','K','A','cougar','J','eagle','Q','wolf','K','A','bison','J','elk','Q','cougar','K','eagle','A','J','wolf','Q']
      when 5 then array['J','eagle','Q','wolf','K','bison','A','elk','J','cougar','Q','eagle','K','wolf','A','bison','J','Q','elk','K','cougar','A','eagle','J','wolf','Q','bison','K','elk','A','cougar','J','eagle','Q','wolf','K','A','J','elk','Q']
      else null
    end;
  else
    return case p_reel
      when 1 then array['bison','J','eagle','Q','wolf','K','cougar','A','elk','J','scatter','Q','wolf','K','eagle','A','bison','J','cougar','Q','elk','K','wolf','A','eagle','J','Q','cougar','K','bison','A','elk','J','wolf','Q','eagle','K','cougar','star','J']
      when 2 then array['wild','J','eagle','Q','wolf','K','bison','A','elk','J','cougar','Q','scatter','K','eagle','A','wolf','J','bison','Q','elk','K','cougar','A','wild','J','eagle','Q','wolf','K','A','elk','J','bison','Q','cougar','K','eagle','star','J']
      when 3 then array['J','wild','eagle','Q','bison','K','wolf','A','elk','J','cougar','Q','eagle','K','scatter','A','wolf','J','bison','Q','wild','K','elk','A','cougar','J','eagle','Q','wolf','K','bison','A','J','elk','Q','cougar','K','eagle','star','J']
      when 4 then array['J','eagle','wild','Q','wolf','K','bison','A','elk','J','cougar','Q','eagle','K','wolf','A','scatter','J','bison','Q','elk','K','wild','A','cougar','J','eagle','Q','wolf','K','A','bison','J','elk','Q','cougar','K','eagle','star','J']
      when 5 then array['J','eagle','Q','wolf','K','bison','A','elk','J','cougar','Q','eagle','K','wolf','A','bison','J','scatter','Q','elk','K','cougar','A','eagle','J','wolf','Q','bison','K','elk','A','cougar','J','eagle','Q','wolf','K','A','star','elk']
      else null
    end;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────
-- Grille 5 reels × 4 rows depuis stops
-- ─────────────────────────────────────────────────────────
create or replace function private.slots_grid_from_stops(p_stops integer[], p_mode text)
returns text[][]
language plpgsql
immutable
as $$
declare
  v_grid text[][] := array[]::text[][];
  v_reel integer;
  v_stop integer;
  v_strip text[];
  v_col text[] := '{}';
  v_row integer;
  v_len integer;
begin
  for v_reel in 1..5 loop
    v_strip := private.slots_strip(v_reel, p_mode);
    v_len := array_length(v_strip, 1);
    v_stop := ((p_stops[v_reel] % v_len) + v_len) % v_len;
    v_col := '{}';
    for v_row in 0..3 loop
      v_col := v_col || v_strip[(v_stop + v_row) % v_len + 1];
    end loop;
    if v_reel = 1 then v_grid := array[v_col];
    else v_grid := v_grid || array[v_col];
    end if;
  end loop;
  return v_grid;
end;
$$;

-- ─────────────────────────────────────────────────────────
-- WAY_PAY table (traduit de src/slots/math.ts)
-- ─────────────────────────────────────────────────────────
create or replace function private.slots_way_pay(p_sym text, p_len integer)
returns integer
language sql
immutable
as $$
  select case p_sym
    when 'bison'  then case p_len when 3 then 60 when 4 then 240 else 650 end
    when 'eagle'  then case p_len when 3 then 45 when 4 then 170 else 450 end
    when 'cougar' then case p_len when 3 then 36 when 4 then 140 else 360 end
    when 'wolf'   then case p_len when 3 then 28 when 4 then 110 else 280 end
    when 'elk'    then case p_len when 3 then 24 when 4 then 90  else 230 end
    when 'A'      then case p_len when 3 then 18 when 4 then 65  else 160 end
    when 'K'      then case p_len when 3 then 15 when 4 then 55  else 140 end
    when 'Q'      then case p_len when 3 then 12 when 4 then 45  else 115 end
    when 'J'      then case p_len when 3 then 10 when 4 then 38  else 95  end
    else 0
  end;
$$;

create or replace function private.slots_is_pay_symbol(p_sym text)
returns boolean
language sql
immutable
as $$
  select p_sym not in ('wild','scatter','star');
$$;

-- ─────────────────────────────────────────────────────────
-- evaluateWays : 1024 chemins (4^5)
-- ─────────────────────────────────────────────────────────
do $$ begin
  create type private.way_win_row as (
    symbol text, length integer, ways integer, multiplier numeric
  );
exception when duplicate_object then null;
end $$;

create or replace function private.slots_evaluate_ways(p_grid text[][])
returns private.way_win_row[]
language plpgsql
immutable
as $$
declare
  v_wins private.way_win_row[] := '{}';
  v_agg jsonb := '{}'::jsonb;
  v_a integer; v_b integer; v_c integer; v_d integer; v_e integer;
  v_cells text[];
  v_pay_sym text := null;
  v_len integer;
  v_cell text;
  v_key text;
  v_prev_ways integer;
  v_prev_mult numeric;
  v_pay integer;
  v_new_ways integer;
  v_row private.way_win_row;
begin
  for v_a in 1..4 loop
    for v_b in 1..4 loop
      for v_c in 1..4 loop
        for v_d in 1..4 loop
          for v_e in 1..4 loop
            v_cells := array[
              p_grid[1][v_a], p_grid[2][v_b], p_grid[3][v_c], p_grid[4][v_d], p_grid[5][v_e]
            ];
            v_pay_sym := null;
            v_len := 0;
            foreach v_cell in array v_cells loop
              if v_cell in ('scatter','star') then exit; end if;
              if v_cell = 'wild' then v_len := v_len + 1; continue; end if;
              if not private.slots_is_pay_symbol(v_cell) then exit; end if;
              if v_pay_sym is null then
                v_pay_sym := v_cell; v_len := v_len + 1; continue;
              end if;
              if v_cell <> v_pay_sym then exit; end if;
              v_len := v_len + 1;
            end loop;
            if v_pay_sym is null or v_len < 3 then continue; end if;
            v_len := least(v_len, 5);
            v_key := v_pay_sym || ':' || v_len::text;
            if v_agg ? v_key then
              v_prev_ways := (v_agg->v_key->>'ways')::integer;
              v_new_ways := v_prev_ways + 1;
              v_pay := private.slots_way_pay(v_pay_sym, v_len);
              v_agg := jsonb_set(v_agg, array[v_key], jsonb_build_object(
                'symbol', v_pay_sym,
                'length', v_len,
                'ways', v_new_ways,
                'multiplier', (v_pay::numeric * v_new_ways) / 1024
              ));
            else
              v_pay := private.slots_way_pay(v_pay_sym, v_len);
              v_agg := v_agg || jsonb_build_object(v_key, jsonb_build_object(
                'symbol', v_pay_sym,
                'length', v_len,
                'ways', 1,
                'multiplier', v_pay::numeric / 1024
              ));
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;

  for v_key in select jsonb_object_keys(v_agg) loop
    v_row.symbol := v_agg->v_key->>'symbol';
    v_row.length := (v_agg->v_key->>'length')::integer;
    v_row.ways   := (v_agg->v_key->>'ways')::integer;
    v_row.multiplier := (v_agg->v_key->>'multiplier')::numeric;
    v_wins := v_wins || v_row;
  end loop;
  return v_wins;
end;
$$;

-- ─────────────────────────────────────────────────────────
-- evaluateSpin SQL — retourne totalMult, freeSpins, jackpotTier
-- ─────────────────────────────────────────────────────────
do $$ begin
  create type private.spin_eval_result as (
    total_mult numeric, ways_mult numeric, scatter_mult numeric,
    wild_product integer, herd_mult numeric, scatter_count integer,
    free_spins integer, bison_landed integer, star_count integer,
    jackpot_tier text, way_wins jsonb
  );
exception when duplicate_object then null;
end $$;

create or replace function private.slots_evaluate_spin(
  p_stops integer[],
  p_mode text,
  p_herd_heads integer,
  p_wild_seed bytea default null
)
returns private.spin_eval_result
language plpgsql
immutable
as $$
declare
  v_grid text[][];
  v_wins private.way_win_row[];
  v_win private.way_win_row;
  v_ways_mult numeric := 0;
  v_scatter_count integer := 0;
  v_scatter_mult numeric := 0;
  v_star_count integer := 0;
  v_bison_landed integer := 0;
  v_heads_after integer;
  v_wild_product integer := 1;
  v_herd_mult numeric := 1;
  v_free_spins integer := 0;
  v_jackpot_tier text := null;
  v_total_mult numeric;
  v_free_spins_retrigger_min constant integer := 2;
  v_reel integer;
  v_row integer;
  v_sym text;
  v_way_wins_json jsonb := '[]'::jsonb;
  v_result private.spin_eval_result;
  v_wild_count integer := 0;
begin
  v_grid := private.slots_grid_from_stops(p_stops, p_mode);

  -- Compter bisons, scatters, stars, wilds
  for v_reel in 1..5 loop
    for v_row in 1..4 loop
      v_sym := v_grid[v_reel][v_row];
      if v_sym = 'bison'   then v_bison_landed := v_bison_landed + 1; end if;
      if v_sym = 'scatter' then v_scatter_count := v_scatter_count + 1; end if;
      if v_sym = 'star'    then v_star_count := v_star_count + 1; end if;
      if v_sym = 'wild'    then v_wild_count := v_wild_count + 1; end if;
    end loop;
  end loop;

  -- Herd mechanics (FS only)
  v_heads_after := case when p_mode = 'free' then p_herd_heads + v_bison_landed else p_herd_heads end;

  -- Ways
  v_wins := private.slots_evaluate_ways(v_grid);
  foreach v_win in array v_wins loop
    v_ways_mult := v_ways_mult + v_win.multiplier;
    v_way_wins_json := v_way_wins_json || to_jsonb(v_win);
  end loop;

  -- Scatter mult
  v_scatter_mult := case
    when v_scatter_count >= 5 then 20
    when v_scatter_count >= 4 then 5
    when v_scatter_count >= 3 then 1.2
    else 0
  end;

  -- Wild product (FS) : 2 premiers wilds, chacun 2× ou 3×, max product 9×
  if p_mode = 'free' then
    declare
      v_i integer := 0;
      v_mults integer[] := '{}';
      v_byte_idx integer := 0;
      v_b integer;
    begin
      if v_wild_count > 0 then
        for v_i in 1..least(v_wild_count, 2) loop
          v_b := case when p_wild_seed is not null
            then get_byte(p_wild_seed, v_byte_idx % octet_length(p_wild_seed))
            else 64 -- fallback 64/255 > 0.65 → 2×
          end;
          v_mults := v_mults || case when v_b::float / 255 < 0.65 then 2 else 3 end;
          v_byte_idx := v_byte_idx + 1;
        end loop;
        v_wild_product := least(9, v_mults[1] * coalesce(v_mults[2], 1));
      end if;
    end;
    v_herd_mult := case
      when v_heads_after >= 15 then 3
      when v_heads_after >= 13 then 2.5
      when v_heads_after >= 7  then 2
      when v_heads_after >= 4  then 1.5
      else 1
    end;
  end if;

  -- Total mult
  v_total_mult := v_ways_mult * v_wild_product * v_herd_mult + v_scatter_mult;

  -- Free spins
  if p_mode <> 'free' then
    v_free_spins := case
      when v_scatter_count >= 5 then 20
      when v_scatter_count >= 4 then 15
      when v_scatter_count >= 3 then 8
      else 0
    end;
  elsif v_scatter_count >= v_free_spins_retrigger_min then
    v_free_spins := 5;
  end if;

  -- Jackpot (base uniquement)
  if p_mode <> 'free' then
    v_jackpot_tier := case
      when v_star_count >= 5 then 'grand'
      when v_star_count >= 4 then 'major'
      when v_star_count >= 3 then 'mini'
      else null
    end;
  end if;

  v_result.total_mult := v_total_mult;
  v_result.ways_mult := v_ways_mult;
  v_result.scatter_mult := v_scatter_mult;
  v_result.wild_product := v_wild_product;
  v_result.herd_mult := v_herd_mult;
  v_result.scatter_count := v_scatter_count;
  v_result.free_spins := v_free_spins;
  v_result.bison_landed := v_bison_landed;
  v_result.star_count := v_star_count;
  v_result.jackpot_tier := v_jackpot_tier;
  v_result.way_wins := v_way_wins_json;
  return v_result;
end;
$$;

-- ─────────────────────────────────────────────────────────
-- slots_settle v3 : payout 100% serveur, plus aucun mult client
-- ─────────────────────────────────────────────────────────
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

  -- Extraire stops depuis server_state
  select array_agg(x::integer order by ordinality)
  into v_stops
  from jsonb_array_elements_text(v_round.server_state->'stops') with ordinality as t(x, ordinality);

  v_mode := coalesce(v_round.server_state->>'mode', 'base');
  v_herd_heads := coalesce((v_round.server_state->>'herd_heads')::integer, 0);

  -- Wild seed = 8 derniers bytes du server_seed (séparés du RNG stops)
  v_wild_seed := substring(v_round.server_seed from 25);

  v_eval := private.slots_evaluate_spin(v_stops, v_mode, v_herd_heads, v_wild_seed);

  v_payout := floor(v_round.stake::numeric * v_eval.total_mult + 0.000000001)::integer;
  v_free_granted := v_eval.free_spins;

  -- Créditer free spins accordés (base uniquement)
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
        'mult', v_eval.total_mult,
        'ways_mult', v_eval.ways_mult,
        'scatter_mult', v_eval.scatter_mult,
        'wild_product', v_eval.wild_product,
        'herd_mult', v_eval.herd_mult,
        'payout', v_payout,
        'jackpot_tier', v_eval.jackpot_tier,
        'free_spins', v_free_granted,
        'bison_landed', v_eval.bison_landed,
        'way_wins', v_eval.way_wins
      ),
      server_state = server_state || jsonb_build_object(
        'settled_mult', v_eval.total_mult,
        'herd_heads_after', v_herd_heads + v_eval.bison_landed
      )
  where id = p_round_id
  returning * into v_round;

  return private.wallet_json(v_uid) || jsonb_build_object(
    'status', coalesce(v_op->>'status','ok'),
    'round', private.slots_public_round(v_round),
    'eval', jsonb_build_object(
      'total_mult', v_eval.total_mult,
      'ways_mult', v_eval.ways_mult,
      'scatter_mult', v_eval.scatter_mult,
      'wild_product', v_eval.wild_product,
      'herd_mult', v_eval.herd_mult,
      'free_spins', v_free_granted,
      'jackpot_tier', v_eval.jackpot_tier,
      'bison_landed', v_eval.bison_landed
    ),
    'free_spins_granted', v_free_granted,
    'jackpot_tier', v_eval.jackpot_tier
  );
end;
$$;

-- Supprimer l'ancienne signature avec p_total_mult client
drop function if exists public.slots_settle(uuid, numeric);
revoke all on function public.slots_settle(uuid) from public;
grant execute on function public.slots_settle(uuid) to authenticated, anon;
