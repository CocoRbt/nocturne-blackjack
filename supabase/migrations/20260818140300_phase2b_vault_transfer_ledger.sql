-- Phase 2b — coffre + transfert via ledger (SQL isolé, UI legacy inchangée).
-- NE PAS appliquer en production sans GO dédié.
-- N'écrase PAS deposit_my_vault / withdraw_my_vault / send_circle_vault.

create or replace function public.ledger_deposit_vault(p_amount integer, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_ps public.player_scores%rowtype;
  v_amount integer;
  v_starting constant integer := 10000;
begin
  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  select * into v_ps from public.player_scores where profile_id = v_uid for update;
  if v_ps.profile_id is null then
    raise exception 'Score introuvable — ouverture de compte requise';
  end if;
  if coalesce(v_ps.balance, 0) - v_amount < v_starting then
    raise exception 'Minimum 100 crédits jouables';
  end if;

  return private.apply_wallet_op(
    v_uid,
    coalesce(nullif(p_idempotency_key, ''), 'vault:deposit:' || gen_random_uuid()::text),
    'VAULT_DEPOSIT',
    -v_amount,
    v_amount,
    null, null, null,
    jsonb_build_object('amount', v_amount)
  );
end;
$$;

create or replace function public.ledger_withdraw_vault(p_amount integer, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_amount integer;
begin
  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  perform 1 from public.player_scores where profile_id = v_uid for update;

  return private.apply_wallet_op(
    v_uid,
    coalesce(nullif(p_idempotency_key, ''), 'vault:withdraw:' || gen_random_uuid()::text),
    'VAULT_WITHDRAW',
    v_amount,
    -v_amount,
    null, null, null,
    jsonb_build_object('amount', v_amount)
  );
end;
$$;

create or replace function public.ledger_send_circle_vault(
  p_to_nickname text,
  p_amount integer,
  p_transfer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_circle uuid;
  v_to_id uuid;
  v_amount integer;
  v_first uuid;
  v_second uuid;
  v_from_op jsonb;
  v_to_op jsonb;
  v_existing bigint;
begin
  if p_transfer_id is null then
    raise exception 'transfer_id requis';
  end if;
  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  select circle_id into v_circle from public.profiles where id = v_uid;
  select p.id into v_to_id
  from public.profiles p
  where p.circle_id = v_circle
    and lower(p.nickname) = lower(trim(p_to_nickname))
  limit 1;
  if v_to_id is null then
    raise exception 'Pote introuvable dans ton cercle';
  end if;
  if v_to_id = v_uid then
    raise exception 'Tu ne peux pas t''envoyer des crédits';
  end if;

  select id into v_existing
  from public.wallet_ledger
  where profile_id = v_uid
    and idempotency_key = 'transfer:' || p_transfer_id::text
  limit 1;
  if v_existing is not null then
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status', 'duplicate',
      'transfer_id', p_transfer_id
    );
  end if;

  if v_uid < v_to_id then
    v_first := v_uid; v_second := v_to_id;
  else
    v_first := v_to_id; v_second := v_uid;
  end if;
  perform 1 from public.player_scores where profile_id = v_first for update;
  perform 1 from public.player_scores where profile_id = v_second for update;

  if not exists (select 1 from public.player_scores where profile_id = v_to_id) then
    insert into public.player_scores (profile_id, balance, peak_balance, vault, updated_at)
    values (v_to_id, 0, 0, 0, now());
  end if;

  v_from_op := private.apply_wallet_op(
    v_uid,
    'transfer:' || p_transfer_id::text,
    'TRANSFER',
    0,
    -v_amount,
    null, null, p_transfer_id,
    jsonb_build_object('direction', 'from', 'peer', v_to_id)
  );
  v_to_op := private.apply_wallet_op(
    v_to_id,
    'transfer:' || p_transfer_id::text,
    'TRANSFER',
    0,
    v_amount,
    null, null, p_transfer_id,
    jsonb_build_object('direction', 'to', 'peer', v_uid)
  );

  return jsonb_build_object(
    'status', coalesce(v_from_op->>'status', 'ok'),
    'transfer_id', p_transfer_id,
    'from', v_from_op,
    'to', v_to_op
  );
end;
$$;

revoke all on function public.ledger_deposit_vault(integer, text) from public;
grant execute on function public.ledger_deposit_vault(integer, text) to authenticated, anon;
revoke all on function public.ledger_withdraw_vault(integer, text) from public;
grant execute on function public.ledger_withdraw_vault(integer, text) to authenticated, anon;
revoke all on function public.ledger_send_circle_vault(text, integer, uuid) from public;
grant execute on function public.ledger_send_circle_vault(text, integer, uuid) to authenticated, anon;
