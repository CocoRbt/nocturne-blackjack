-- Phase 3A — autoriser explicitement MIGRATION_OPENING dans wallet_ledger.
-- NE PAS appliquer en production sans GO dédié.

alter table public.wallet_ledger
  drop constraint if exists wallet_ledger_op_type_check;

alter table public.wallet_ledger
  add constraint wallet_ledger_op_type_check
    check (op_type in (
      'ACCOUNT_OPENING',
      'MIGRATION_OPENING',
      'BET',
      'PAYOUT',
      'REFUND',
      'VAULT_DEPOSIT',
      'VAULT_WITHDRAW',
      'TRANSFER'
    ));
