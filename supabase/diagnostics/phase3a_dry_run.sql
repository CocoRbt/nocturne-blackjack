-- Phase 3A — dry-run local complet migration/restauration wallets.
-- AUCUN WRITE production. Ce script cible une DB locale de simulation.

begin;

do $$
declare
  v_circle uuid := gen_random_uuid();
  v_res jsonb;
  v_bal integer;
  v_vault integer;
  v_drift boolean;
  v_t record;
begin
  -- Cercle principal simulé
  insert into public.circles (id, code, name)
  values (v_circle, 'NOC-EJV7', 'Cercle principal dry-run')
  on conflict (code) do nothing;

  create temp table tmp_targets (
    profile_id uuid primary key,
    nickname text not null,
    current_balance integer,
    current_vault integer,
    current_peak integer,
    current_updated_at timestamptz,
    target_balance integer,
    target_vault integer,
    target_peak integer,
    decision text not null,
    note text
  ) on commit drop;

  insert into tmp_targets values
    ('a30d8791-5fa5-4a7c-89d6-7f459095b0f6','KikiLoki',1304569500,0,1904569500,'2026-08-17 20:21:30.701574+00',121100000,0,121100000,'MANUAL FINAL','valeurs définitives validées manuellement'),
    ('3afdb4e8-33ff-4148-9c26-17a3ea8cfbe3','Vincent',10000,0,910536621,'2026-08-17 20:13:09.875+00',100000,0,null,'MANUAL PEAK REQUIRED','balance définitive 1000 cr, peak inconnu'),
    ('7997ace8-c050-49f1-afd8-e4bb9c817cc3','Selmex',10000,50000000,50010000,'2026-08-18 07:24:16.837329+00',10000,0,2060512,'SNAPSHOT VALIDATED','profil actif cercle principal'),
    ('12a585fb-bff6-4748-8e95-14ce2d3022b9','ZaaariX',3299602,50000000,53299602,'2026-08-17 22:47:31.553416+00',3299602,0,3299602,'SNAPSHOT VALIDATED','snapshot <= T0'),
    ('d1609022-3303-4259-b563-2c38f5b9022d','Lea',9262,50000000,50009262,'2026-08-17 20:51:49.713883+00',9262,0,3170654,'SNAPSHOT VALIDATED','snapshot <= T0'),
    ('9596457a-0fd3-4db7-a34c-ce0a3d745463','Lea2',250,100000000,100000250,'2026-08-18 08:16:37.180686+00',250,0,28000,'SNAPSHOT VALIDATED','snapshot <= T0'),
    ('018a50d7-4d53-46ab-a176-f6d37710f135','Lofty',10000,0,16612,'2026-08-13 19:04:31.090978+00',10000,0,16612,'SAFE CURRENT / SNAPSHOT','updated_at < T0'),
    ('08846d54-1d68-4ed2-ba0d-c58e25825638','I2S',10000,0,10000,'2026-07-30 19:32:33.418672+00',10000,0,10000,'SAFE CURRENT VALUE','updated_at < T0, aucun snapshot contradictoire'),
    ('aff69e30-69c6-480d-9cf0-80384dafac1b','Aubin',9000,0,48000,'2026-08-17 18:36:25.649843+00',null,null,null,'MANUAL DECISION REQUIRED','aucune preuve <= T0');

  -- Profils + scores corrompus de départ (simulation proche prod)
  insert into auth.users (id)
  select profile_id from tmp_targets
  on conflict do nothing;

  insert into public.profiles (id, nickname, circle_id)
  select profile_id, nickname, v_circle
  from tmp_targets
  on conflict (id) do update set nickname = excluded.nickname, circle_id = excluded.circle_id;

  insert into public.player_scores (
    profile_id, balance, peak_balance, vault, games_played, hands_played,
    blackjacks, best_streak, highest_table, games_before_peak, updated_at
  )
  select
    profile_id,
    coalesce(current_balance, 0),
    coalesce(current_peak, greatest(coalesce(current_balance,0), coalesce(current_vault,0))),
    coalesce(current_vault, 0),
    0, 0, 0, 0, 'emeraude', 0,
    current_updated_at
  from tmp_targets
  on conflict (profile_id) do update set
    balance = excluded.balance,
    peak_balance = excluded.peak_balance,
    vault = excluded.vault,
    updated_at = excluded.updated_at;

  -- Ancrage MIGRATION_OPENING pour tous les profils sauf Aubin (manuel requis).
  for v_t in
    select profile_id, target_balance, target_vault
    from tmp_targets
    where target_balance is not null and target_vault is not null
  loop
    perform private.ledger_migration_opening(
      v_t.profile_id,
      v_t.target_balance,
      v_t.target_vault,
      'phase3a-dry-run'
    );
  end loop;

  -- Peak cible séparé (jamais dérivé automatiquement depuis migration opening)
  update public.player_scores s
  set peak_balance = case
      when t.target_peak is not null then t.target_peak
      when t.nickname = 'Vincent' then t.target_balance -- placeholder dry-run uniquement
      else s.peak_balance
    end
  from tmp_targets t
  where s.profile_id = t.profile_id
    and t.target_balance is not null;

  -- Audit ledger == player_scores sur profils migrés
  for v_t in
    select profile_id
    from tmp_targets
    where target_balance is not null and target_vault is not null
  loop
    select
      (
        s.balance is distinct from coalesce(l.bal, 0)
        or s.vault is distinct from coalesce(l.vault, 0)
      )
    into v_drift
    from public.player_scores s
    left join (
      select profile_id, sum(amount)::integer as bal, sum(vault_delta)::integer as vault
      from public.wallet_ledger
      where profile_id = v_t.profile_id
      group by profile_id
    ) l on l.profile_id = s.profile_id
    where s.profile_id = v_t.profile_id;
    if v_drift is distinct from false then
      raise exception 'DRY-RUN FAIL drift ledger/profile_id=%', v_t.profile_id;
    end if;
  end loop;

  -- Proof: sync_my_score ne peut plus réécrire le wallet d'un profil ledger
  perform public.set_test_auth('a30d8791-5fa5-4a7c-89d6-7f459095b0f6');
  v_res := public.sync_my_score(5000, 5000, 0, 0, 0, 'emeraude', 0, 0, 0);
  if (v_res->>'balance')::integer <> 121100000 then
    raise exception 'DRY-RUN FAIL sync_my_score rewrote Kiki wallet';
  end if;

  -- Tests vrais profils simulés
  -- KikiLoki : départ exact 1 211 000 cr, perte plinko, coffre, retrait, transfert, refresh-safe
  v_bal := (select balance from public.player_scores where profile_id = 'a30d8791-5fa5-4a7c-89d6-7f459095b0f6');
  if v_bal <> 121100000 then
    raise exception 'DRY-RUN FAIL Kiki start=% attendu=121100000', v_bal;
  end if;
  v_res := public.plinko_drop(gen_random_uuid(), 10000, 8, 'low');
  v_res := public.plinko_settle((v_res->'round'->>'round_id')::uuid);
  v_res := public.ledger_deposit_vault(10000, 'dry:kiki:dep1');
  v_res := public.ledger_withdraw_vault(5000, 'dry:kiki:wdr1');
  v_res := public.ledger_send_circle_vault('Vincent', 2500, gen_random_uuid());
  v_res := public.recover_my_rounds();

  -- Vincent : départ exact 1 000 cr
  perform public.set_test_auth('3afdb4e8-33ff-4148-9c26-17a3ea8cfbe3');
  v_bal := (select balance from public.player_scores where profile_id = '3afdb4e8-33ff-4148-9c26-17a3ea8cfbe3');
  if v_bal <> 100000 then
    raise exception 'DRY-RUN FAIL Vincent start=% attendu=100000', v_bal;
  end if;
  v_res := public.plinko_drop(gen_random_uuid(), 1000, 8, 'medium');
  v_res := public.plinko_settle((v_res->'round'->>'round_id')::uuid);
  v_res := public.ledger_deposit_vault(5000, 'dry:vincent:dep1');
  v_res := public.ledger_withdraw_vault(2500, 'dry:vincent:wdr1');
  v_res := public.recover_my_rounds();

  -- Lea2 : petit wallet 2,50 cr, aucune recréditation accidentelle à 100
  perform public.set_test_auth('9596457a-0fd3-4db7-a34c-ce0a3d745463');
  v_bal := (select balance from public.player_scores where profile_id = '9596457a-0fd3-4db7-a34c-ce0a3d745463');
  if v_bal <> 250 then
    raise exception 'DRY-RUN FAIL Lea2 start=% attendu=250', v_bal;
  end if;
  begin
    perform public.crash_start(gen_random_uuid(), 500, null);
    raise exception 'DRY-RUN FAIL Lea2 overbet should fail';
  exception
    when others then
      if sqlerrm not like '%Mise invalide%' and sqlerrm not like '%Solde insuffisant%' then
        raise;
      end if;
  end;
  if (select count(*) from public.wallet_ledger where profile_id = '9596457a-0fd3-4db7-a34c-ce0a3d745463' and op_type = 'ACCOUNT_OPENING') <> 0 then
    raise exception 'DRY-RUN FAIL Lea2 got ACCOUNT_OPENING accidentally';
  end if;
  if (select balance from public.player_scores where profile_id = '9596457a-0fd3-4db7-a34c-ce0a3d745463') <> 250 then
    raise exception 'DRY-RUN FAIL Lea2 balance changed unexpectedly';
  end if;

  raise notice 'PHASE3A DRY-RUN PASSED';
end;
$$;

commit;
