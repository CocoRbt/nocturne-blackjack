-- Phase 2b — wallet_ledger (vérité comptable) + helper atomique/idempotent.
-- NE PAS appliquer en production sans GO dédié.
-- AUCUN backfill ACCOUNT_OPENING des joueurs existants.
-- AUCUN UPDATE de wallets joueurs existants.

create extension if not exists pgcrypto;

create table if not exists public.wallet_ledger (
  id              bigserial primary key,
  profile_id      uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text not null,
  op_type         text not null
    check (op_type in (
      'ACCOUNT_OPENING', 'BET', 'PAYOUT', 'REFUND',
      'VAULT_DEPOSIT', 'VAULT_WITHDRAW', 'TRANSFER'
    )),
  amount          integer not null,
  vault_delta     integer not null default 0,
  balance_after   integer not null,
  vault_after     integer not null,
  game            text,
  round_id        uuid,
  transfer_id     uuid,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint wallet_ledger_idempotency unique (profile_id, idempotency_key),
  constraint wallet_ledger_amount_check check (amount <> 0 or vault_delta <> 0 or op_type = 'ACCOUNT_OPENING'),
  constraint wallet_ledger_balance_nonneg check (balance_after >= 0),
  constraint wallet_ledger_vault_nonneg check (vault_after >= 0)
);

create index if not exists wallet_ledger_profile_time
  on public.wallet_ledger (profile_id, created_at desc);
create index if not exists wallet_ledger_round
  on public.wallet_ledger (round_id) where round_id is not null;
create index if not exists wallet_ledger_transfer
  on public.wallet_ledger (transfer_id) where transfer_id is not null;

alter table public.wallet_ledger enable row level security;

-- Lecture propre uniquement (audit UI). Écriture = security definer.
drop policy if exists "ledger read self" on public.wallet_ledger;
create policy "ledger read self"
  on public.wallet_ledger for select
  using (profile_id = auth.uid());

revoke insert, update, delete on public.wallet_ledger from public, anon, authenticated;
grant select on public.wallet_ledger to authenticated, anon;

create or replace function private.wallet_ledger_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'wallet_ledger immuable';
end;
$$;

drop trigger if exists trg_wallet_ledger_no_update on public.wallet_ledger;
create trigger trg_wallet_ledger_no_update
before update or delete on public.wallet_ledger
for each row execute function private.wallet_ledger_immutable();

-- ---------------------------------------------------------------------------
-- Mutation unique : lock scores → insert ledger (conflit = duplicate) → scores.
-- ---------------------------------------------------------------------------
create or replace function private.apply_wallet_op(
  p_uid uuid,
  p_idempotency_key text,
  p_op_type text,
  p_amount integer,
  p_vault_delta integer,
  p_game text default null,
  p_round_id uuid default null,
  p_transfer_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ps public.player_scores%rowtype;
  v_led public.wallet_ledger%rowtype;
  v_new_bal integer;
  v_new_vault integer;
  v_wealth integer;
  v_old_peak integer;
  v_max constant integer := 2_000_000_000;
begin
  if p_uid is null then
    raise exception 'Non authentifié';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 3 then
    raise exception 'Clé d''idempotence invalide';
  end if;

  select * into v_ps from public.player_scores where profile_id = p_uid for update;

  -- Duplicate AVANT toute mutation scores.
  select * into v_led
  from public.wallet_ledger
  where profile_id = p_uid and idempotency_key = p_idempotency_key;
  if v_led.id is not null then
    return jsonb_build_object(
      'status', 'duplicate',
      'ledger_id', v_led.id,
      'balance', v_led.balance_after,
      'vault', v_led.vault_after,
      'peak_balance', coalesce(v_ps.peak_balance, v_led.balance_after + v_led.vault_after),
      'games_played', coalesce(v_ps.games_played, 0),
      'games_before_peak', coalesce(v_ps.games_before_peak, 0)
    );
  end if;

  if v_ps.profile_id is null then
    if p_op_type <> 'ACCOUNT_OPENING' then
      raise exception 'Score introuvable — ouverture de compte requise';
    end if;
    insert into public.player_scores (profile_id, balance, peak_balance, vault, updated_at)
    values (p_uid, 0, 0, 0, now())
    returning * into v_ps;
  end if;

  v_new_bal := coalesce(v_ps.balance, 0) + coalesce(p_amount, 0);
  v_new_vault := coalesce(v_ps.vault, 0) + coalesce(p_vault_delta, 0);
  if v_new_bal < 0 then
    raise exception 'Solde insuffisant';
  end if;
  if v_new_vault < 0 then
    raise exception 'Coffre insuffisant';
  end if;
  if v_new_bal > v_max or v_new_vault > v_max then
    raise exception 'Plafond atteint';
  end if;

  insert into public.wallet_ledger (
    profile_id, idempotency_key, op_type, amount, vault_delta,
    balance_after, vault_after, game, round_id, transfer_id, metadata
  ) values (
    p_uid, p_idempotency_key, p_op_type, coalesce(p_amount, 0), coalesce(p_vault_delta, 0),
    v_new_bal, v_new_vault, p_game, p_round_id, p_transfer_id, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (profile_id, idempotency_key) do nothing
  returning * into v_led;

  if v_led.id is null then
    select * into v_led
    from public.wallet_ledger
    where profile_id = p_uid and idempotency_key = p_idempotency_key;
    return jsonb_build_object(
      'status', 'duplicate',
      'ledger_id', v_led.id,
      'balance', v_led.balance_after,
      'vault', v_led.vault_after,
      'peak_balance', coalesce(v_ps.peak_balance, v_led.balance_after + v_led.vault_after),
      'games_played', coalesce(v_ps.games_played, 0),
      'games_before_peak', coalesce(v_ps.games_before_peak, 0)
    );
  end if;

  v_wealth := v_new_bal + v_new_vault;
  v_old_peak := coalesce(v_ps.peak_balance, 0);

  update public.player_scores
  set
    balance = v_new_bal,
    vault = v_new_vault,
    peak_balance = greatest(peak_balance, v_wealth),
    games_before_peak = case
      when v_wealth > v_old_peak then games_played
      else games_before_peak
    end,
    updated_at = now()
  where profile_id = p_uid
  returning * into v_ps;

  insert into public.credit_snapshots (profile_id, balance)
  values (p_uid, v_new_bal);

  return jsonb_build_object(
    'status', 'ok',
    'ledger_id', v_led.id,
    'balance', v_ps.balance,
    'vault', v_ps.vault,
    'peak_balance', v_ps.peak_balance,
    'games_played', v_ps.games_played,
    'games_before_peak', v_ps.games_before_peak
  );
end;
$$;

create or replace function private.require_circle_uid()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.circle_id is not null) then
    raise exception 'Rejoins un cercle d''abord';
  end if;
  return v_uid;
end;
$$;

create or replace function private.wallet_json(p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ps public.player_scores%rowtype;
begin
  select * into v_ps from public.player_scores where profile_id = p_uid;
  return jsonb_build_object(
    'balance', coalesce(v_ps.balance, 0),
    'vault', coalesce(v_ps.vault, 0),
    'peak_balance', coalesce(v_ps.peak_balance, 0),
    'games_played', coalesce(v_ps.games_played, 0),
    'games_before_peak', coalesce(v_ps.games_before_peak, 0)
  );
end;
$$;

-- 100 crédits de départ, une fois par profil. Refuse les comptes déjà garnis
-- sans ledger (joueurs prod) — pas de backfill silencieux.
create or replace function public.open_account_if_needed()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ps public.player_scores%rowtype;
  v_has_ledger boolean;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Profil introuvable';
  end if;

  select exists(
    select 1 from public.wallet_ledger where profile_id = v_uid
  ) into v_has_ledger;

  select * into v_ps from public.player_scores where profile_id = v_uid;

  if v_has_ledger then
    return private.wallet_json(v_uid) || jsonb_build_object('status', 'exists');
  end if;

  if v_ps.profile_id is not null
     and (
       coalesce(v_ps.balance, 0) <> 0
       or coalesce(v_ps.vault, 0) <> 0
       or coalesce(v_ps.games_played, 0) <> 0
       or coalesce(v_ps.peak_balance, 0) <> 0
     )
  then
    raise exception 'Compte existant : migration ledger dédiée requise';
  end if;

  return private.apply_wallet_op(
    v_uid,
    'opening:' || v_uid::text,
    'ACCOUNT_OPENING',
    10000,
    0,
    null,
    null,
    null,
    jsonb_build_object('source', 'open_account_if_needed')
  ) || jsonb_build_object('status', 'opened');
end;
$$;

revoke all on function public.open_account_if_needed() from public;
grant execute on function public.open_account_if_needed() to authenticated, anon;

-- Audit lecture : SUM(ledger) vs player_scores.
create or replace function public.audit_wallet_ledger()
returns table (
  profile_id uuid,
  balance integer,
  vault integer,
  ledger_balance integer,
  ledger_vault integer,
  drifted boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.profile_id,
    s.balance,
    s.vault,
    coalesce(l.bal, 0) as ledger_balance,
    coalesce(l.vault, 0) as ledger_vault,
    (s.balance is distinct from coalesce(l.bal, 0)
      or s.vault is distinct from coalesce(l.vault, 0)) as drifted
  from public.player_scores s
  left join (
    select
      w.profile_id,
      sum(w.amount)::integer as bal,
      sum(w.vault_delta)::integer as vault
    from public.wallet_ledger w
    group by w.profile_id
  ) l on l.profile_id = s.profile_id
  where s.profile_id = auth.uid()
     or auth.role() = 'service_role';
$$;

revoke all on function public.audit_wallet_ledger() from public;
grant execute on function public.audit_wallet_ledger() to authenticated, anon;
