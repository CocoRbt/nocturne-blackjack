import { STARTING_BALANCE } from './persistence';

/** Montant max coffrable : tout ce qui dépasse le solde de base (anti-farm refill). */
export function vaultableAmount(
  balance: number,
  floor: number = STARTING_BALANCE,
): number {
  return Math.max(0, Math.floor(balance) - floor);
}

export type VaultMoveResult =
  | { ok: true; balance: number; vault: number }
  | { ok: false; error: string; balance: number; vault: number };

/** Dépose du crédit jouable dans le coffre (ne crée pas de jetons). */
export function depositToVault(
  balance: number,
  vault: number,
  amountCents: number,
  floor: number = STARTING_BALANCE,
): VaultMoveResult {
  const bal = Math.max(0, Math.floor(balance));
  const v = Math.max(0, Math.floor(vault));
  const amount = Math.floor(amountCents);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Montant invalide.', balance: bal, vault: v };
  }
  const max = vaultableAmount(bal, floor);
  if (amount > max) {
    return {
      ok: false,
      error:
        max <= 0
          ? `Gardez au moins ${floor / 100} crédits hors du coffre.`
          : `Vous ne pouvez coffrer que ${max / 100} (au-dessus de ${floor / 100}).`,
      balance: bal,
      vault: v,
    };
  }
  return { ok: true, balance: bal - amount, vault: v + amount };
}

/** Retire du coffre vers le solde jouable. */
export function withdrawFromVault(
  balance: number,
  vault: number,
  amountCents: number,
): VaultMoveResult {
  const bal = Math.max(0, Math.floor(balance));
  const v = Math.max(0, Math.floor(vault));
  const amount = Math.floor(amountCents);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Montant invalide.', balance: bal, vault: v };
  }
  if (amount > v) {
    return {
      ok: false,
      error: 'Pas assez dans le coffre.',
      balance: bal,
      vault: v,
    };
  }
  return { ok: true, balance: bal + amount, vault: v - amount };
}
