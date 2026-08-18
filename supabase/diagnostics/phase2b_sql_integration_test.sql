-- Tests PostgreSQL Phase 2b (local uniquement — NE PAS exécuter en production).
begin;

do $$
declare
  v_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_c uuid := 'cccccccc-cccc-4ccc-8ccc-111111111111';
  v_circle uuid;
  v_res jsonb;
  v_r1 uuid := '11111111-1111-4111-8111-111111111111';
  v_r2 uuid := '22222222-2222-4222-8222-222222222222';
  v_r3 uuid := '33333333-3333-4333-8333-333333333333';
  v_r4 uuid := '44444444-4444-4444-8444-444444444444';
  v_tid uuid := '55555555-5555-4555-8555-555555555555';
  v_bal integer;
  v_vault integer;
  v_drift boolean;
  v_n integer;
  v_state text;
  v_payout integer;
  v_tile integer;
  v_mines integer[];
  v_opened jsonb;
begin
  insert into auth.users (id) values (v_a), (v_b) on conflict do nothing;
  insert into auth.users (id) values (v_c) on conflict do nothing;
  insert into public.circles (code, name) values ('NOC-P2B', 'Phase2b')
    on conflict (code) do nothing;
  select id into v_circle from public.circles where code = 'NOC-P2B';

  insert into public.profiles (id, nickname, circle_id)
  values (v_a, 'LedgerA', v_circle), (v_b, 'LedgerB', v_circle), (v_c, 'LegacyZero', v_circle)
  on conflict (id) do update set nickname = excluded.nickname, circle_id = excluded.circle_id;

  -- ACCOUNT_OPENING
  perform public.set_test_auth(v_a);
  v_opened := public.open_account_if_needed();
  if (v_opened->>'balance')::int <> 10000 then
    raise exception 'TEST FAIL opening balance=%', v_opened;
  end if;
  v_opened := public.open_account_if_needed();
  if v_opened->>'status' <> 'exists' then
    raise exception 'TEST FAIL opening retry status=%', v_opened;
  end if;
  select count(*) into v_n from public.wallet_ledger where profile_id = v_a and op_type = 'ACCOUNT_OPENING';
  if v_n <> 1 then
    raise exception 'TEST FAIL opening unique n=%', v_n;
  end if;

  -- Compte garni sans ledger : refuse
  perform public.set_test_auth(v_b);
  insert into public.player_scores (profile_id, balance, peak_balance, vault, games_played)
  values (v_b, 50000, 50000, 0, 3)
  on conflict (profile_id) do update set balance = 50000, peak_balance = 50000, games_played = 3;
  begin
    perform public.open_account_if_needed();
    raise exception 'TEST FAIL opening aurait dû refuser le compte garni';
  exception
    when others then
      if sqlerrm not like '%migration ledger%' then
        raise;
      end if;
  end;

  -- Compte ancien à zéro sans ledger : doit aussi refuser.
  insert into public.player_scores (profile_id, balance, peak_balance, vault, games_played)
  values (v_c, 0, 0, 0, 0)
  on conflict (profile_id) do update set balance = 0, peak_balance = 0, vault = 0, games_played = 0;
  perform public.set_test_auth(v_c);
  begin
    perform public.open_account_if_needed();
    raise exception 'TEST FAIL opening aurait dû refuser le compte legacy zéro';
  exception
    when others then
      if sqlerrm not like '%migration ledger%' then
        raise;
      end if;
  end;

  -- Plinko perte / gain / idempotence
  perform public.set_test_auth(v_a);
  v_res := public.plinko_drop(v_r1, 500, 8, 'low');
  if (v_res->>'balance')::int <> 9500 then
    raise exception 'TEST FAIL plinko bet balance=%', v_res;
  end if;
  if v_res->'round'->>'state' <> 'resolved' then
    raise exception 'TEST FAIL plinko state=%', v_res->'round';
  end if;
  -- même clé / round
  v_res := public.plinko_drop(v_r1, 500, 8, 'low');
  if v_res->>'status' <> 'duplicate' then
    raise exception 'TEST FAIL plinko drop duplicate status=%', v_res;
  end if;
  if (v_res->>'balance')::int <> 9500 then
    raise exception 'TEST FAIL plinko drop duplicate a redéhité';
  end if;
  select count(*) into v_n from public.wallet_ledger where profile_id = v_a and op_type = 'BET';
  if v_n <> 1 then
    raise exception 'TEST FAIL bet unique n=%', v_n;
  end if;

  v_payout := (v_res->'round'->>'payout')::int;
  v_res := public.plinko_settle(v_r1);
  if v_res->'round'->>'state' <> 'settled' then
    raise exception 'TEST FAIL settle state=%', v_res;
  end if;
  v_res := public.plinko_settle(v_r1);
  if v_res->>'status' <> 'duplicate' then
    raise exception 'TEST FAIL settle duplicate status=%', v_res;
  end if;
  select count(*) into v_n from public.wallet_ledger
  where profile_id = v_a and op_type = 'PAYOUT' and round_id = v_r1;
  if v_payout > 0 and v_n <> 1 then
    raise exception 'TEST FAIL payout unique n=% payout=%', v_n, v_payout;
  end if;
  if v_payout = 0 and v_n <> 0 then
    raise exception 'TEST FAIL payout à 0 ne doit pas écrire de ligne n=%', v_n;
  end if;

  -- Refresh : drop sans settle puis recover
  v_res := public.plinko_drop(v_r2, 200, 8, 'medium');
  perform public.recover_my_rounds();
  select state into v_state from public.game_rounds where id = v_r2;
  if v_state <> 'settled' then
    raise exception 'TEST FAIL recover plinko state=%', v_state;
  end if;

  -- Audit
  select drifted into v_drift from public.audit_wallet_ledger() where profile_id = v_a;
  if v_drift is distinct from false then
    raise exception 'TEST FAIL audit drift A';
  end if;

  -- Mines : start + reveal hors mine jusqu'à cashout ou bust
  -- Reset A à 10000 via… on ne reset pas prod-style. On joue avec le solde restant.
  v_res := public.mines_start(v_r3, 100, 3);
  if v_res->'round'->>'state' <> 'open' then
    raise exception 'TEST FAIL mines start state=%', v_res;
  end if;
  begin
    perform public.mines_start(gen_random_uuid(), 100, 3);
    raise exception 'TEST FAIL mines second start aurait dû refuser';
  exception
    when others then
      if sqlerrm not like '%déjà en cours%' then
        raise;
      end if;
  end;
  if jsonb_array_length(coalesce(v_res->'round'->'mine_set', '[]'::jsonb)) <> 0 then
    raise exception 'TEST FAIL mines mineSet leak %', v_res->'round'->'mine_set';
  end if;
  v_res := public.mines_start(v_r3, 100, 3);
  if v_res->>'status' <> 'duplicate' then
    raise exception 'TEST FAIL mines start duplicate';
  end if;

  select array_agg(x::int)
  into v_mines
  from jsonb_array_elements_text(
    (select server_state->'mineSet' from public.game_rounds where id = v_r3)
  ) t(x);

  -- Clique une case sûre
  v_tile := 0;
  while v_tile = any (v_mines) loop
    v_tile := v_tile + 1;
  end loop;
  v_res := public.mines_reveal(v_r3, v_tile);
  if v_res->'round'->>'state' <> 'open' then
    raise exception 'TEST FAIL mines reveal safe state=%', v_res;
  end if;
  v_res := public.mines_cashout(v_r3);
  if v_res->'round'->>'state' <> 'settled' then
    raise exception 'TEST FAIL mines cashout state=%', v_res;
  end if;
  if (v_res->'round'->>'payout')::int < 100 then
    raise exception 'TEST FAIL mines cashout payout=%', v_res;
  end if;
  v_res := public.mines_cashout(v_r3);
  if v_res->>'status' <> 'duplicate' then
    raise exception 'TEST FAIL mines cashout duplicate';
  end if;

  -- Mines bust : round neuf, révéler une mine
  v_res := public.mines_start(v_r4, 100, 24);
  select (jsonb_array_elements_text(server_state->'mineSet'))::int
  into v_tile
  from public.game_rounds where id = v_r4
  limit 1;
  v_res := public.mines_reveal(v_r4, v_tile);
  if v_res->'round'->>'state' <> 'settled' then
    raise exception 'TEST FAIL mines bust state=%', v_res;
  end if;
  if (v_res->'round'->>'payout')::int <> 0 then
    raise exception 'TEST FAIL mines bust payout=%', v_res;
  end if;
  if coalesce((v_res->'round'->>'hit_mine')::boolean, false) is not true then
    raise exception 'TEST FAIL mines bust hit_mine';
  end if;

  -- Surplus de test (pas un backfill prod) pour exercer le coffre.
  perform private.apply_wallet_op(
    v_a, 'test:vault-setup', 'PAYOUT', 20000, 0, null, null, null, '{}'::jsonb
  );

  -- Coffre
  v_res := public.ledger_deposit_vault(500, 'vault:deposit:test1');
  if (v_res->>'vault')::int <> 500 then
    raise exception 'TEST FAIL vault deposit %', v_res;
  end if;
  v_res := public.ledger_deposit_vault(500, 'vault:deposit:test1');
  if v_res->>'status' <> 'duplicate' then
    raise exception 'TEST FAIL vault deposit duplicate';
  end if;
  select balance into v_bal from public.player_scores where profile_id = v_a;
  begin
    perform public.ledger_deposit_vault(v_bal - 10000 + 1, 'vault:deposit:too-much');
    raise exception 'TEST FAIL vault floor aurait dû refuser';
  exception
    when others then
      if sqlerrm not like '%100 crédits%' then
        raise;
      end if;
  end;
  v_res := public.ledger_withdraw_vault(200, 'vault:withdraw:test1');
  if (v_res->>'vault')::int <> 300 then
    raise exception 'TEST FAIL vault withdraw %', v_res;
  end if;

  -- Transfert A → B (B a un score garni sans ledger : apply_wallet_op crédite vault)
  v_res := public.ledger_send_circle_vault('LedgerB', 100, v_tid);
  if v_res->>'status' not in ('ok', 'duplicate') then
    raise exception 'TEST FAIL transfer %', v_res;
  end if;
  v_res := public.ledger_send_circle_vault('LedgerB', 100, v_tid);
  if v_res->>'status' <> 'duplicate' then
    raise exception 'TEST FAIL transfer duplicate %', v_res;
  end if;

  select vault into v_vault from public.player_scores where profile_id = v_a;
  -- 300 - 100 = 200
  if v_vault <> 200 then
    raise exception 'TEST FAIL transfer from vault=%', v_vault;
  end if;

  select drifted into v_drift from public.audit_wallet_ledger() where profile_id = v_a;
  if v_drift is distinct from false then
    raise exception 'TEST FAIL audit final A';
  end if;

  raise notice 'PHASE2B SQL TESTS PASSED';
end;
$$;

commit;
