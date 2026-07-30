/**
 * Métadonnées du record (peak) : combien de parties avant d’atteindre ce pic.
 * Ex. 15 parties jouées, record sur la 16ᵉ → gamesBeforePeak = 15.
 */

export interface PeakMeta {
  peakBalance: number;
  gamesPlayed: number;
  gamesBeforePeak: number;
}

/** Applique un crédit après une partie terminée (+1 partie). */
export function settleGamePeak(
  balanceBeforeCredit: number,
  payout: number,
  meta: PeakMeta,
): { balance: number } & PeakMeta {
  const gamesPlayed = meta.gamesPlayed + 1;
  const balance = balanceBeforeCredit + Math.max(0, Math.floor(payout));
  if (balance > meta.peakBalance) {
    return {
      balance,
      peakBalance: balance,
      gamesPlayed,
      gamesBeforePeak: Math.max(0, gamesPlayed - 1),
    };
  }
  return {
    balance,
    peakBalance: meta.peakBalance,
    gamesPlayed,
    gamesBeforePeak: meta.gamesBeforePeak,
  };
}

/** Crédit hors partie (ex. refill) — ne compte pas de partie. */
export function creditWithoutGame(
  balanceBeforeCredit: number,
  payout: number,
  meta: PeakMeta,
): { balance: number } & PeakMeta {
  const balance = balanceBeforeCredit + Math.max(0, Math.floor(payout));
  if (balance > meta.peakBalance) {
    return {
      balance,
      peakBalance: balance,
      gamesPlayed: meta.gamesPlayed,
      gamesBeforePeak: meta.gamesPlayed,
    };
  }
  return {
    balance,
    peakBalance: meta.peakBalance,
    gamesPlayed: meta.gamesPlayed,
    gamesBeforePeak: meta.gamesBeforePeak,
  };
}

export function formatGamesBeforePeak(n: number): string {
  if (n <= 0) return 'dès le départ';
  return n === 1 ? '1 partie avant' : `${n} parties avant`;
}
