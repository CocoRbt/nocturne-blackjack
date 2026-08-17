/**
 * Garde-fous miroir de sync_my_score (anti écrasement classement).
 * Utilisé côté client pour tests / doc — la source de vérité reste le SQL.
 */

export type SyncScoreSnapshot = {
  balance: number;
  vault: number;
  peakBalance: number;
  gamesPlayed: number;
};

export type SyncScoreInput = SyncScoreSnapshot;

const STARTING = 10_000;
const MAX_BALANCE = 2_000_000_000;

/**
 * Décide le solde/coffre à écrire si le serveur a déjà `prev`.
 * Rejette les pushs stale (moins de parties) et les baisses mid-mise.
 */
export function resolveSyncedScore(
  prev: SyncScoreSnapshot | null,
  input: SyncScoreInput,
): SyncScoreSnapshot {
  let balance = Math.min(Math.max(0, Math.floor(input.balance)), MAX_BALANCE);
  let vault = Math.min(Math.max(0, Math.floor(input.vault)), MAX_BALANCE);
  let peakBalance = Math.min(
    Math.max(Math.floor(input.peakBalance), balance),
    MAX_BALANCE,
  );
  let gamesPlayed = Math.max(0, Math.floor(input.gamesPlayed));

  if (!prev) {
    peakBalance = Math.max(peakBalance, balance + vault);
    return { balance, vault, peakBalance, gamesPlayed };
  }

  if (gamesPlayed < prev.gamesPlayed) {
    return {
      ...prev,
      peakBalance: Math.max(peakBalance, prev.peakBalance, prev.balance + prev.vault),
    };
  }

  let vaultDelta = vault - prev.vault;
  let balDelta = balance - prev.balance;

  if (vaultDelta > 0 && Math.abs(-balDelta - vaultDelta) > 1) {
    const wealth = balance + vault;
    const prevWealth = prev.balance + prev.vault;
    if (Math.abs(wealth - prevWealth) <= 1) {
      // Dépôt : richesse stable même si le découpage solde/coffre a bougé.
    } else {
      vault = prev.vault;
      balance = prev.balance;
      vaultDelta = 0;
      balDelta = 0;
    }
  }

  if (vaultDelta < 0 && Math.abs(balDelta - -vaultDelta) > 1) {
    vault = prev.vault;
    vaultDelta = 0;
    balDelta = balance - prev.balance;
  }

  // Mid-mise : même games_played, solde ↓ sans dépôt coffre.
  if (gamesPlayed === prev.gamesPlayed && balance < prev.balance && vaultDelta === 0) {
    balance = prev.balance;
    balDelta = 0;
  }

  if (balDelta > 0 && vaultDelta >= 0 && gamesPlayed <= prev.gamesPlayed) {
    if (prev.balance < 100 && balance <= STARTING && vaultDelta === 0) {
      // refill ok
    } else if (balDelta <= 3000 && vaultDelta === 0) {
      // défi ok
    } else {
      balance = prev.balance;
    }
  }

  const wealth = balance + vault;
  const prevWealth = prev.balance + prev.vault;
  if (wealth > prevWealth + 100_000 && gamesPlayed <= prev.gamesPlayed) {
    balance = prev.balance;
    vault = prev.vault;
  }

  peakBalance = Math.max(peakBalance, balance + vault, prev.peakBalance);
  gamesPlayed = Math.max(gamesPlayed, prev.gamesPlayed);

  return { balance, vault, peakBalance, gamesPlayed };
}
