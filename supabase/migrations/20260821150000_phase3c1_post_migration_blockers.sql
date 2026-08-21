-- Phase 3C.1 — bloque les écritures wallet legacy pour profils ledger
-- et qualifie le RNG pgcrypto utilisé par les jeux serveur-authoritative.

-- Conserver les implémentations legacy pour les seuls profils non-ledger,
-- hors du schéma exposé et sans droit d'exécution direct.
alter function public.deposit_my_vault(integer)
  rename to legacy_deposit_my_vault_unchecked;
alter function public.legacy_deposit_my_vault_unchecked(integer)
  set schema private;

alter function public.withdraw_my_vault(integer)
  rename to legacy_withdraw_my_vault_unchecked;
alter function public.legacy_withdraw_my_vault_unchecked(integer)
  set schema private;

alter function public.send_circle_vault(text, integer)
  rename to legacy_send_circle_vault_unchecked;
alter function public.legacy_send_circle_vault_unchecked(text, integer)
  set schema private;

alter function public.claim_stampede_jackpot(text, integer)
  rename to legacy_claim_stampede_jackpot_unchecked;
alter function public.legacy_claim_stampede_jackpot_unchecked(text, integer)
  set schema private;

revoke all on function private.legacy_deposit_my_vault_unchecked(integer)
  from public, anon, authenticated;
revoke all on function private.legacy_withdraw_my_vault_unchecked(integer)
  from public, anon, authenticated;
revoke all on function private.legacy_send_circle_vault_unchecked(text, integer)
  from public, anon, authenticated;
revoke all on function private.legacy_claim_stampede_jackpot_unchecked(text, integer)
  from public, anon, authenticated;

create function public.deposit_my_vault(p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Non authentifié'; end if;
  if exists (select 1 from public.wallet_ledger where profile_id = v_uid) then
    raise exception 'Profil ledger : utiliser ledger_deposit_vault';
  end if;
  return private.legacy_deposit_my_vault_unchecked(p_amount);
end;
$$;

create function public.withdraw_my_vault(p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Non authentifié'; end if;
  if exists (select 1 from public.wallet_ledger where profile_id = v_uid) then
    raise exception 'Profil ledger : utiliser ledger_withdraw_vault';
  end if;
  return private.legacy_withdraw_my_vault_unchecked(p_amount);
end;
$$;

create function public.send_circle_vault(p_to_nickname text, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_circle uuid;
  v_to_uid uuid;
begin
  if v_uid is null then raise exception 'Non authentifié'; end if;
  if exists (select 1 from public.wallet_ledger where profile_id = v_uid) then
    raise exception 'Profil ledger : utiliser ledger_send_circle_vault';
  end if;

  select circle_id into v_circle from public.profiles where id = v_uid;
  select id into v_to_uid
  from public.profiles
  where circle_id = v_circle
    and lower(nickname) = lower(trim(both from coalesce(p_to_nickname, '')))
  limit 1;

  if v_to_uid is not null
     and exists (select 1 from public.wallet_ledger where profile_id = v_to_uid) then
    raise exception 'Destinataire ledger : utiliser ledger_send_circle_vault';
  end if;

  return private.legacy_send_circle_vault_unchecked(p_to_nickname, p_amount);
end;
$$;

create function public.claim_stampede_jackpot(p_tier text, p_bet integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Non authentifié'; end if;
  if exists (select 1 from public.wallet_ledger where profile_id = v_uid) then
    raise exception 'Profil ledger : utiliser claim_jackpot_ledger avec le round du spin';
  end if;
  return private.legacy_claim_stampede_jackpot_unchecked(p_tier, p_bet);
end;
$$;

revoke all on function public.deposit_my_vault(integer) from public;
grant execute on function public.deposit_my_vault(integer) to authenticated, anon;
revoke all on function public.withdraw_my_vault(integer) from public;
grant execute on function public.withdraw_my_vault(integer) to authenticated, anon;
revoke all on function public.send_circle_vault(text, integer) from public;
grant execute on function public.send_circle_vault(text, integer) to authenticated, anon;
revoke all on function public.claim_stampede_jackpot(text, integer) from public;
grant execute on function public.claim_stampede_jackpot(text, integer) to authenticated, anon;

-- pgcrypto est installé dans `extensions` sur le projet hébergé.
-- Modifier les définitions actives évite d'élargir leur search_path.
do $rng_patch$
declare
  v_oid regprocedure;
  v_def text;
  v_signature text;
  v_signatures text[] := array[
    'public.plinko_drop(uuid,integer,integer,text)',
    'public.mines_start(uuid,integer,integer)',
    'public.crash_start(uuid,integer,numeric)',
    'public.slots_spin(uuid,integer,integer,integer,text)',
    'public.craps_place_bet(uuid,integer)',
    'public.craps_roll(uuid)'
  ];
begin
  foreach v_signature in array v_signatures loop
    v_oid := to_regprocedure(v_signature);
    if v_oid is null then
      raise exception 'Phase3C.1 RNG : fonction absente %', v_signature;
    end if;
    select pg_get_functiondef(v_oid) into v_def;
    if position('extensions.gen_random_bytes(' in v_def) = 0 then
      if position('gen_random_bytes(' in v_def) = 0 then
        raise exception 'Phase3C.1 RNG : appel absent %', v_signature;
      end if;
      v_def := replace(v_def, 'gen_random_bytes(', 'extensions.gen_random_bytes(');
      execute v_def;
    end if;
  end loop;
end;
$rng_patch$;

-- Contrôles bloquants avant validation de la migration.
do $phase3c1_guard$
declare
  v_signature text;
  v_def text;
  v_signatures text[] := array[
    'public.plinko_drop(uuid,integer,integer,text)',
    'public.mines_start(uuid,integer,integer)',
    'public.crash_start(uuid,integer,numeric)',
    'public.slots_spin(uuid,integer,integer,integer,text)',
    'public.craps_place_bet(uuid,integer)',
    'public.craps_roll(uuid)'
  ];
begin
  foreach v_signature in array v_signatures loop
    select pg_get_functiondef(to_regprocedure(v_signature)) into v_def;
    if position('extensions.gen_random_bytes(' in v_def) = 0 then
      raise exception 'Phase3C.1 RNG non qualifié : %', v_signature;
    end if;
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private')
      and (p.proname like 'bj_%' or p.proname = 'blackjack_start')
  ) then
    raise exception 'Phase3C.1 : Blackjack ne doit pas être exposé';
  end if;
end;
$phase3c1_guard$;
