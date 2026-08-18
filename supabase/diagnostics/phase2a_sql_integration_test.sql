-- Tests d'intégration PostgreSQL Phase 2a (local/staging uniquement).
-- Prérequis : migrations appliquées + bootstrap auth (phase2a_local_pg_bootstrap.sql).

begin;

do $$
declare
  v_uid uuid := '11111111-1111-4111-8111-111111111111';
  v_circle uuid;
  v_res jsonb;
  v_bal integer;
  v_peak integer;
  v_games integer;
begin
  perform public.set_test_auth(v_uid);

  insert into public.circles (code, name)
  values ('NOC-TEST', 'Phase2a test')
  on conflict (code) do nothing;

  select id into v_circle from public.circles where code = 'NOC-TEST';

  insert into auth.users (id) values (v_uid) on conflict do nothing;

  insert into public.profiles (id, nickname, circle_id)
  values (v_uid, 'Tester', v_circle)
  on conflict (id) do update set nickname = excluded.nickname, circle_id = excluded.circle_id;

  insert into public.player_scores (
    profile_id, balance, peak_balance, vault, games_played, updated_at
  ) values (
    v_uid, 10000, 10000, 0, 5, now()
  )
  on conflict (profile_id) do update set
    balance = 10000,
    peak_balance = 10000,
    vault = 0,
    games_played = 5,
    updated_at = now();

  -- 1) Perte mid-mise : games_played inchangé, balance 50 cr
  v_res := public.sync_my_score(
    5000, 10000, 0, 0, 0, 'emeraude', 0, 5, 0
  );
  v_bal := (v_res->>'balance')::integer;
  if v_bal <> 5000 then
    raise exception 'TEST FAIL perte mid-mise: balance=% attendu=5000 res=%', v_bal, v_res;
  end if;

  select balance, peak_balance, games_played
  into v_bal, v_peak, v_games
  from public.player_scores where profile_id = v_uid;

  if v_bal <> 5000 or v_peak <> 10000 or v_games <> 5 then
    raise exception 'TEST FAIL row après perte mid-mise: bal=% peak=% games=%', v_bal, v_peak, v_games;
  end if;

  -- 2) All-in à 0, games toujours 5 (mid-mise)
  v_res := public.sync_my_score(0, 10000, 0, 0, 0, 'emeraude', 0, 5, 0);
  v_bal := (v_res->>'balance')::integer;
  if v_bal <> 0 then
    raise exception 'TEST FAIL all-in mid-mise: balance=%', v_bal;
  end if;

  select balance, peak_balance into v_bal, v_peak
  from public.player_scores where profile_id = v_uid;
  if v_bal <> 0 or v_peak <> 10000 then
    raise exception 'TEST FAIL all-in row: bal=% peak=%', v_bal, v_peak;
  end if;

  -- 3) Sync suivante après settlement (games+1) : perte confirmée
  v_res := public.sync_my_score(0, 10000, 0, 0, 0, 'emeraude', 0, 6, 0);
  v_bal := (v_res->>'balance')::integer;
  if v_bal <> 0 or (v_res->>'games_played')::integer <> 6 then
    raise exception 'TEST FAIL settlement: %', v_res;
  end if;

  -- 4) Record > balance, balance faible : peak ne descend pas, pas de recollage
  update public.player_scores
  set balance = 5000, peak_balance = 100000, vault = 0, games_played = 10
  where profile_id = v_uid;

  v_res := public.sync_my_score(2500, 100000, 0, 0, 0, 'emeraude', 0, 10, 0);
  v_bal := (v_res->>'balance')::integer;
  v_peak := (v_res->>'peak_balance')::integer;
  if v_bal <> 2500 then
    raise exception 'TEST FAIL balance faible: bal=%', v_bal;
  end if;
  if v_peak < 100000 then
    raise exception 'TEST FAIL peak descendu: peak=%', v_peak;
  end if;

  -- 5) Trigger direct : pas de restore OLD sur wealth < 1 cr
  update public.player_scores
  set balance = 0, vault = 0, peak_balance = 100000, games_played = 10
  where profile_id = v_uid;

  select balance, peak_balance into v_bal, v_peak
  from public.player_scores where profile_id = v_uid;
  if v_bal <> 0 or v_peak <> 100000 then
    raise exception 'TEST FAIL trigger restore: bal=% peak=%', v_bal, v_peak;
  end if;

  -- 6) ensure_circle_membership ne recolle pas millionnaire
  perform public.ensure_circle_membership('Tester', 'NOC-TEST');
  select balance, peak_balance into v_bal, v_peak
  from public.player_scores where profile_id = v_uid;
  if v_bal <> 0 then
    raise exception 'TEST FAIL ensure_circle_membership restore: bal=%', v_bal;
  end if;

  raise notice 'PHASE2A SQL INTEGRATION: ALL TESTS PASSED';
end;
$$;

rollback;
