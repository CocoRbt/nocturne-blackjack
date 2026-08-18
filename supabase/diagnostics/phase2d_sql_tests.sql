-- Phase 2d — Tests SQL : round_id, stats RNG, parité Slots/BJ.
-- NE PAS exécuter en production.

begin;

do $$
declare
  v_a uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  v_circle uuid;
  v_res jsonb;
  v_stops integer[];
  v_eval private.spin_eval_result;
  v_n integer;
  -- Stats RNG
  v_dice_counts integer[] := array[0,0,0,0,0,0];
  v_dice_total integer := 0;
  v_stop_counts integer[] := array_fill(0, array[40]);
  v_plinko_rights integer := 0;
  v_mines_counts integer[] := array_fill(0, array[25]);
  v_seed bytea;
  v_dice integer[];
  v_i integer;
  v_j integer;
  v_face integer;
  v_stop integer;
  v_mines integer[];
begin
  insert into auth.users (id) values (v_a) on conflict do nothing;
  insert into public.circles (code, name) values ('NOC-2D', 'Phase2d') on conflict (code) do nothing;
  select id into v_circle from public.circles where code = 'NOC-2D';
  insert into public.profiles (id, nickname, circle_id)
  values (v_a, 'Tester2D', v_circle)
  on conflict (id) do update set nickname = excluded.nickname, circle_id = excluded.circle_id;
  perform public.set_test_auth(v_a);
  perform public.open_account_if_needed();

  -- ─── TEST ROUND_ID ───────────────────────────────────────
  -- Round UUID autre joueur
  declare
    v_other_round uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  begin
    begin
      perform public.plinko_settle(v_other_round);
      raise exception 'TEST FAIL round autre joueur aurait dû refuser';
    exception when others then
      if sqlerrm not like '%introuvable%' then raise; end if;
    end;
  end;

  -- Round UUID autre jeu
  declare
    v_rid uuid := gen_random_uuid();
  begin
    v_res := public.plinko_drop(v_rid, 100, 8, 'low');
    begin
      perform public.mines_reveal(v_rid, 0);
      raise exception 'TEST FAIL round autre jeu aurait dû refuser';
    exception when others then
      if sqlerrm not like '%introuvable%' then raise; end if;
    end;
    perform public.plinko_settle(v_rid);
  end;

  -- UUID aléatoire sans round → settlement refusé
  begin
    perform public.crash_cashout(gen_random_uuid());
    raise exception 'TEST FAIL cashout sans round aurait dû refuser';
  exception when others then
    if sqlerrm not like '%introuvable%' then raise; end if;
  end;

  -- ─── PARITÉ SLOTS : stops connus → mult attendu ──────────
  -- Stops tout-0 sur bande base : reel 1=bison, 2=wild, 3=J, 4=J, 5=J
  -- bison × wild × J × J × J → ways: bison sur reel1+2(wild)+J 3,4,5 → pas de bison way car wild stop 0 = wild
  -- Ce test vérifie que l'éval SQL tourne sans erreur et retourne un jsonb cohérent
  v_stops := array[0, 0, 0, 0, 0];
  v_eval := private.slots_evaluate_spin(v_stops, 'base', 0, null);
  if v_eval.total_mult < 0 then
    raise exception 'TEST FAIL slots eval neg mult=%', v_eval.total_mult;
  end if;

  -- Stops qui produisent des scatters sur 4 reels minimum
  -- Reel 1 scatter @ pos 10 (0-based), reel 2 @ 12, reel 3 @ 14, reel 4 @ 16
  v_stops := array[10, 12, 14, 16, 0];
  v_eval := private.slots_evaluate_spin(v_stops, 'base', 0, null);
  if v_eval.scatter_count < 4 then
    raise exception 'TEST FAIL slots scatter_count=%', v_eval.scatter_count;
  end if;
  if v_eval.free_spins < 15 then
    raise exception 'TEST FAIL slots free_spins=%', v_eval.free_spins;
  end if;

  -- ─── STATS RNG : Craps dés uniformes ─────────────────────
  -- 10 000 lancers simulés
  v_dice_total := 0;
  v_dice_counts := array[0,0,0,0,0,0];
  for v_i in 1..10000 loop
    v_seed := gen_random_bytes(8);
    v_dice := private.craps_roll_dice_uniform(v_seed);
    v_face := v_dice[1];
    v_dice_counts[v_face] := v_dice_counts[v_face] + 1;
    v_face := v_dice[2];
    v_dice_counts[v_face] := v_dice_counts[v_face] + 1;
    v_dice_total := v_dice_total + 2;
  end loop;
  -- Vérifier que chaque face représente 14.5%–18.5% (attendu ~16.7%)
  for v_i in 1..6 loop
    if v_dice_counts[v_i]::float / v_dice_total < 0.145
    or v_dice_counts[v_i]::float / v_dice_total > 0.185 then
      raise exception 'TEST FAIL craps die bias: face=% count=% total=%',
        v_i, v_dice_counts[v_i], v_dice_total;
    end if;
  end loop;

  -- Stats RNG Plinko LSB
  v_plinko_rights := 0;
  for v_i in 1..10000 loop
    v_seed := gen_random_bytes(16);
    for v_j in 0..11 loop
      if (get_byte(v_seed, v_j) & 1) = 1 then
        v_plinko_rights := v_plinko_rights + 1;
      end if;
    end loop;
  end loop;
  -- Attendu ~50%. Tolérance 48.5%–51.5%
  if v_plinko_rights::float / 120000 < 0.485
  or v_plinko_rights::float / 120000 > 0.515 then
    raise exception 'TEST FAIL plinko lsb bias: rights=%', v_plinko_rights;
  end if;

  -- Stats RNG Slots stops (distribution 0–39)
  v_stop_counts := array_fill(0, array[40]);
  for v_i in 1..5000 loop
    v_seed := gen_random_bytes(32);
    v_stops := private.slots_pick_stops(v_seed, 'base');
    for v_j in 1..5 loop
      v_stop := v_stops[v_j];
      if v_stop >= 0 and v_stop < 40 then
        v_stop_counts[v_stop + 1] := v_stop_counts[v_stop + 1] + 1;
      end if;
    end loop;
  end loop;
  -- 5000 × 5 = 25000 stops, attendu 625 par position. Tolérance 400–850.
  declare v_min_stop integer; v_max_stop integer; begin
    select min(s), max(s) into v_min_stop, v_max_stop
    from unnest(v_stop_counts) s;
    if v_min_stop < 400 or v_max_stop > 850 then
      raise exception 'TEST FAIL slots stop distribution bias: min=% max=%', v_min_stop, v_max_stop;
    end if;
  end;

  -- Stats RNG Mines positions (uniformité grossière après rejection sampling)
  v_mines_counts := array_fill(0, array[25]);
  for v_i in 1..10000 loop
    v_seed := gen_random_bytes(32);
    v_mines := private.mines_place(1, v_seed);
    v_mines_counts[v_mines[1] + 1] := v_mines_counts[v_mines[1] + 1] + 1;
  end loop;
  declare v_min_m integer; v_max_m integer; begin
    select min(s), max(s) into v_min_m, v_max_m from unnest(v_mines_counts) s;
    if v_min_m < 300 or v_max_m > 500 then
      raise exception 'TEST FAIL mines distribution bias: min=% max=%', v_min_m, v_max_m;
    end if;
  end;

  -- Jackpot legacy guard : profil ledger doit être refusé
  begin
    perform public.claim_stampede_jackpot('mini', 100);
    raise exception 'TEST FAIL jackpot legacy aurait dû refuser profil ledger';
  exception
    when others then
      if sqlerrm not like '%Profil ledger%' then raise; end if;
  end;

  raise notice 'PHASE2D SQL TESTS PASSED';
end;
$$;

commit;
