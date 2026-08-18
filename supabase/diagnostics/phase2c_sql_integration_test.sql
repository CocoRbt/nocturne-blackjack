-- Tests PostgreSQL Phase 2c (local uniquement — NE PAS exécuter en production).
begin;

do $$
declare
  v_a uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccc2c';
  v_b uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddd2c';
  v_circle uuid;
  v_res jsonb;
  v_round_id uuid;
  v_state text;
  v_payout integer;
  v_bal integer;
  v_bets integer;
  v_n integer;
  v_ended boolean;
begin
  insert into auth.users (id) values (v_a), (v_b) on conflict do nothing;
  insert into public.circles (code, name) values ('NOC-2C', 'Phase2c') on conflict (code) do nothing;
  select id into v_circle from public.circles where code = 'NOC-2C';
  insert into public.profiles (id, nickname, circle_id)
  values (v_a, 'Player2C', v_circle), (v_b, 'Player2CB', v_circle)
  on conflict (id) do update set nickname = excluded.nickname, circle_id = excluded.circle_id;

  perform public.set_test_auth(v_a);
  perform public.open_account_if_needed();

  -- === CRASH ===
  v_round_id := gen_random_uuid();
  v_res := public.crash_start(v_round_id, 500, null);
  if (v_res->>'balance')::int <> 9500 then
    raise exception 'TEST FAIL crash start balance=%', v_res;
  end if;
  if (v_res->'round'->>'state') <> 'open' then
    raise exception 'TEST FAIL crash open state=%', v_res->'round';
  end if;
  if jsonb_array_length(coalesce(v_res->'round'->'stops','[]'::jsonb)) = 5 then
    raise exception 'TEST FAIL crash round should not have stops';
  end if;
  -- Duplicate start
  v_res := public.crash_start(v_round_id, 500, null);
  if v_res->>'status' <> 'duplicate' then raise exception 'TEST FAIL crash dup start'; end if;
  -- Cashout avant crash
  v_res := public.crash_cashout(v_round_id, 1.5);
  if v_res->'round'->>'state' <> 'settled' then
    raise exception 'TEST FAIL crash cashout state=%', v_res->'round';
  end if;
  -- Duplicate settle
  v_res := public.crash_cashout(v_round_id, 1.5);
  if v_res->>'status' <> 'duplicate' then raise exception 'TEST FAIL crash dup cashout'; end if;
  -- Loss
  v_round_id := gen_random_uuid();
  v_res := public.crash_start(v_round_id, 300, null);
  v_res := public.crash_resolve_loss(v_round_id);
  if (v_res->'round'->>'state') <> 'settled' then
    raise exception 'TEST FAIL crash loss state=%', v_res->'round';
  end if;
  if (v_res->'round'->>'payout')::int <> 0 then raise exception 'TEST FAIL crash loss payout!=0'; end if;
  -- Audit après crash
  select drifted into v_ended from public.audit_wallet_ledger() where profile_id = v_a;
  if v_ended is distinct from false then raise exception 'TEST FAIL crash audit drift'; end if;

  -- === SLOTS ===
  v_round_id := gen_random_uuid();
  v_res := public.slots_spin(v_round_id, 200, 0, 0, 'base');
  if (v_res->'round'->>'state') <> 'open' then
    raise exception 'TEST FAIL slots open state=%', v_res->'round';
  end if;
  if jsonb_array_length(coalesce(v_res->'round'->'stops','[]'::jsonb)) <> 5 then
    raise exception 'TEST FAIL slots stops len=%', v_res->'round'->'stops';
  end if;
  -- Duplicate spin
  v_res := public.slots_spin(v_round_id, 200, 0, 0, 'base');
  if v_res->>'status' <> 'duplicate' then raise exception 'TEST FAIL slots dup spin'; end if;
  -- Settle
  v_res := public.slots_settle(v_round_id, 0.5);
  if (v_res->'round'->>'state') <> 'settled' then
    raise exception 'TEST FAIL slots settle state=%', v_res->'round';
  end if;
  -- Duplicate settle
  v_res := public.slots_settle(v_round_id, 0.5);
  if v_res->>'status' <> 'duplicate' then raise exception 'TEST FAIL slots dup settle'; end if;
  -- Free spin (pas de BET) — créditer d'abord le solde serveur
  v_bal := (select balance from public.player_scores where profile_id = v_a);
  perform private.credit_free_spins(v_a, 3);
  v_round_id := gen_random_uuid();
  v_res := public.slots_spin(v_round_id, 200, 3, 0, 'free');
  if (v_res->>'balance')::int <> v_bal then
    raise exception 'TEST FAIL free spin debited balance was % now %', v_bal, (v_res->>'balance')::int;
  end if;

  -- === CRAPS ===
  v_round_id := gen_random_uuid();
  v_res := public.craps_place_bet(v_round_id, 400);
  if (v_res->'round'->>'phase') <> 'come_out' then
    raise exception 'TEST FAIL craps come_out phase=%', v_res->'round';
  end if;
  -- Roll jusqu'à la fin (max 20 jets pour éviter boucle infinie)
  v_n := 0;
  loop
    v_res := public.craps_roll(v_round_id);
    v_ended := coalesce((v_res->>'ended')::boolean, false);
    v_n := v_n + 1;
    exit when v_ended or v_n >= 20;
  end loop;
  if (v_res->'round'->>'state') <> 'settled' then
    raise exception 'TEST FAIL craps not settled after %jets', v_n;
  end if;
  -- Take back : nouvelle manche non encore lancée
  v_round_id := gen_random_uuid();
  v_res := public.craps_place_bet(v_round_id, 200);
  v_res := public.craps_take_back(v_round_id);
  if (v_res->'round'->>'state') <> 'settled' then raise exception 'TEST FAIL craps take_back'; end if;

  -- === BLACKJACK ===
  v_round_id := gen_random_uuid();
  v_res := public.bj_deal(v_round_id, 300);
  if v_res->'round'->'player_cards' is null then
    raise exception 'TEST FAIL bj deal no player_cards';
  end if;
  if v_res->'round'->'dealer_cards' is null and (v_res->'round'->>'state') = 'settled' then
    null; -- BJ naturel immédiat
  elsif (v_res->'round'->>'state') not in ('open','settled') then
    raise exception 'TEST FAIL bj deal state=%', v_res->'round'->>'state';
  end if;
  -- Duplicate deal
  v_res := public.bj_deal(v_round_id, 300);
  if v_res->>'status' <> 'duplicate' then raise exception 'TEST FAIL bj dup deal'; end if;
  -- Actions si encore ouvert
  if (select state from public.game_rounds where id = v_round_id) = 'open' then
    v_res := public.bj_action(v_round_id, 'stand');
    if (v_res->'round'->>'state') <> 'settled' then
      raise exception 'TEST FAIL bj stand not settled';
    end if;
  end if;
  -- Duplicate settle
  v_res := public.bj_settle(v_round_id);
  if v_res->>'status' <> 'duplicate' then raise exception 'TEST FAIL bj dup settle'; end if;
  -- Audit final
  select drifted into v_ended from public.audit_wallet_ledger() where profile_id = v_a;
  if v_ended is distinct from false then raise exception 'TEST FAIL phase2c audit drift'; end if;
  -- Interdire action sur round d'un autre joueur
  perform public.set_test_auth(v_b);
  perform public.open_account_if_needed();
  begin
    perform public.bj_settle(v_round_id);
    raise exception 'TEST FAIL bj autre joueur aurait dû refuser';
  exception
    when others then
      if sqlerrm not like '%introuvable%' then raise; end if;
  end;

  raise notice 'PHASE2C SQL TESTS PASSED';
end;
$$;

commit;
