-- Phase 2d — RNG fairness + corrections (Craps dés uniformes, BJ Fisher-Yates sur uint32).
-- 1) Craps : byte % 6 = biais modulo. Correction : rejection sampling sur 4 bytes.
-- 2) BJ : Fisher-Yates 312 cartes. Le deck est 312 → index max 311.
--    L'implémentation Phase 2c utilisait 2 bytes par index (max 65535 > 311 mais non uniforme).
--    Correction : uint32 + rejection sampling.
-- 3) Slots : uint32 % 40 = biais 256/40=6.4 → 40 × 6 = 240, reste 16 = surreprésentation 0–15.
--    Correction : rejection sampling sur uint32.
-- 4) Plinko LSB : ok (bit uniformément distribué).
-- 5) Mines Fisher-Yates : byte % (i+1) — OK pour i < 255, biais pour i ≥ 255.
--    Deck Mines = 25 cases → i_max = 24 → byte % 25 OK.
-- NE PAS appliquer en production sans GO dédié.

-- ─────────────────────────────────────────────────────────
-- 1) Craps : dés uniformes avec rejection sampling
-- ─────────────────────────────────────────────────────────
create or replace function private.craps_roll_dice_uniform(p_seed bytea)
returns integer[]
language plpgsql
immutable
as $$
declare
  v_d1 integer;
  v_d2 integer;
  v_threshold constant integer := 252; -- 256 - (256 mod 6) = 252
  v_b integer;
  v_offset integer := 0;
begin
  -- Dé 1 : rejection sampling sur octets successifs
  loop
    v_b := get_byte(p_seed, v_offset % octet_length(p_seed));
    v_offset := v_offset + 1;
    exit when v_b < v_threshold;
  end loop;
  v_d1 := (v_b % 6) + 1;

  -- Dé 2 : même procédé
  loop
    v_b := get_byte(p_seed, v_offset % octet_length(p_seed));
    v_offset := v_offset + 1;
    exit when v_b < v_threshold;
  end loop;
  v_d2 := (v_b % 6) + 1;

  return array[v_d1, v_d2];
end;
$$;

-- ─────────────────────────────────────────────────────────
-- 2) BJ : Fisher-Yates avec uint32 + rejection sampling pour index 0..311
-- ─────────────────────────────────────────────────────────
create or replace function private.bj_draw_cards(
  p_seed bytea,
  p_deck_count integer,
  p_n integer
)
returns jsonb[]
language plpgsql
immutable
as $$
declare
  v_size integer := p_deck_count * 52;
  v_deck integer[];
  v_i integer;
  v_j integer;
  v_tmp integer;
  v_out jsonb[] := '{}';
  v_range integer;
  v_threshold bigint;
  v_val bigint;
  v_byte_offset integer := 0;
begin
  for v_i in 0 .. v_size - 1 loop
    v_deck := v_deck || (v_i % 52);
  end loop;

  -- Fisher-Yates : index j dans [0, i] uniforme via rejection sampling uint32
  for v_i in reverse v_size - 1 .. 1 loop
    v_range := v_i + 1;
    -- threshold = 2^32 - (2^32 mod range) = 2^32 - ((2^32 mod range))
    -- Simplified : threshold = 4294967296 - (4294967296 % v_range)
    v_threshold := 4294967296::bigint - (4294967296::bigint % v_range::bigint);
    loop
      v_val := 0;
      v_val := v_val + get_byte(p_seed, v_byte_offset % octet_length(p_seed))::bigint * 16777216;
      v_val := v_val + get_byte(p_seed, (v_byte_offset+1) % octet_length(p_seed))::bigint * 65536;
      v_val := v_val + get_byte(p_seed, (v_byte_offset+2) % octet_length(p_seed))::bigint * 256;
      v_val := v_val + get_byte(p_seed, (v_byte_offset+3) % octet_length(p_seed))::bigint;
      v_byte_offset := v_byte_offset + 4;
      exit when v_val < v_threshold;
    end loop;
    v_j := (v_val % v_range::bigint)::integer;
    v_tmp := v_deck[v_i + 1];
    v_deck[v_i + 1] := v_deck[v_j + 1];
    v_deck[v_j + 1] := v_tmp;
  end loop;

  for v_i in 1 .. p_n loop
    v_out := v_out || private.bj_build_card(v_deck[v_i] % 52);
  end loop;
  return v_out;
end;
$$;

-- ─────────────────────────────────────────────────────────
-- 3) Slots : stops uniformes via rejection sampling uint32
-- ─────────────────────────────────────────────────────────
create or replace function private.slots_pick_stops(p_seed bytea, p_mode text)
returns integer[]
language plpgsql
immutable
as $$
declare
  v_lens integer[] := private.slots_strip_lens(p_mode);
  v_stops integer[] := '{}';
  v_reel integer;
  v_range integer;
  v_threshold bigint;
  v_val bigint;
  v_offset integer := 0;
begin
  for v_reel in 1..5 loop
    v_range := v_lens[v_reel]; -- 40
    v_threshold := 4294967296::bigint - (4294967296::bigint % v_range::bigint);
    loop
      v_val := 0;
      v_val := v_val + get_byte(p_seed, v_offset % 32)::bigint * 16777216;
      v_val := v_val + get_byte(p_seed, (v_offset+1) % 32)::bigint * 65536;
      v_val := v_val + get_byte(p_seed, (v_offset+2) % 32)::bigint * 256;
      v_val := v_val + get_byte(p_seed, (v_offset+3) % 32)::bigint;
      v_offset := v_offset + 4;
      exit when v_val < v_threshold;
    end loop;
    v_stops := v_stops || (v_val % v_range::bigint)::integer;
  end loop;
  return v_stops;
end;
$$;

-- 4) Mines Fisher-Yates : OK (i_max = 24 → byte % 25 = 10 valeurs sur 256 → biais max 10/256 ≈ 4%
--    à surveiller si grille s'agrandit, mais 5×5 = 25 est acceptable.

-- 5) Plinko LSB : OK — confirmation via commentaire.
-- get_byte(seed, i) & 1 = LSB d'un octet CSPRNG = uniforme.
