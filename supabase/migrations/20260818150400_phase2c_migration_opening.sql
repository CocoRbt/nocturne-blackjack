-- Phase 2c — MIGRATION_OPENING : ancrage ledger pour wallets historiques.
-- NE PAS appliquer en production sans GO dédié.
-- NE PAS exécuter pour des joueurs existants sans validation manuelle des montants.

create or replace function private.ledger_migration_opening(
  p_uid uuid,
  p_balance integer,
  p_vault integer,
  p_authorized_by text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ps public.player_scores%rowtype;
  v_has_ledger boolean;
  v_op_bal jsonb;
  v_op_vault jsonb;
begin
  if p_uid is null then raise exception 'uid requis'; end if;
  if p_balance is null or p_balance < 0 then raise exception 'balance invalide'; end if;
  if p_vault is null or p_vault < 0 then raise exception 'vault invalide'; end if;

  select exists(
    select 1 from public.wallet_ledger where profile_id = p_uid
      and op_type in ('ACCOUNT_OPENING','MIGRATION_OPENING')
  ) into v_has_ledger;

  if v_has_ledger then
    return private.wallet_json(p_uid) || jsonb_build_object(
      'status','exists',
      'message','Profil déjà ancré dans le ledger'
    );
  end if;

  select * into v_ps from public.player_scores where profile_id = p_uid for update;
  if v_ps.profile_id is null then
    raise exception 'Joueur introuvable dans player_scores';
  end if;

  -- Balance d'ancrage
  if p_balance > 0 then
    insert into public.wallet_ledger (
      profile_id, idempotency_key, op_type, amount, vault_delta,
      balance_after, vault_after, metadata
    ) values (
      p_uid, 'migration:balance:' || p_uid::text,
      'MIGRATION_OPENING',
      p_balance, 0,
      p_balance, 0,
      jsonb_build_object(
        'authorized_by', p_authorized_by,
        'note', 'Ancrage ledger — solde validé manuellement',
        'balance_before_migration', v_ps.balance
      )
    );
  end if;

  -- Vault d'ancrage
  if p_vault > 0 then
    insert into public.wallet_ledger (
      profile_id, idempotency_key, op_type, amount, vault_delta,
      balance_after, vault_after, metadata
    ) values (
      p_uid, 'migration:vault:' || p_uid::text,
      'MIGRATION_OPENING',
      0, p_vault,
      p_balance, p_vault,
      jsonb_build_object(
        'authorized_by', p_authorized_by,
        'note', 'Ancrage ledger — coffre validé manuellement',
        'vault_before_migration', v_ps.vault
      )
    );
  end if;

  -- Met à jour player_scores avec les valeurs d'ancrage validées.
  update public.player_scores
  set balance = p_balance, vault = p_vault, updated_at = now()
  where profile_id = p_uid;

  return private.wallet_json(p_uid) || jsonb_build_object(
    'status', 'migrated',
    'balance', p_balance,
    'vault', p_vault
  );
end;
$$;

-- check_migration constraint : MIGRATION_OPENING ne peut pas modifier peak_balance
-- (le pic sera restauré séparément via la phase restauration).
alter table public.wallet_ledger
  drop constraint if exists wallet_ledger_amount_check;
alter table public.wallet_ledger
  add constraint wallet_ledger_amount_check
    check (
      amount <> 0
      or vault_delta <> 0
      or op_type in ('ACCOUNT_OPENING','MIGRATION_OPENING')
    );

comment on constraint wallet_ledger_amount_check on public.wallet_ledger
  is 'Zéro delta autorisé uniquement pour ACCOUNT_OPENING et MIGRATION_OPENING';
