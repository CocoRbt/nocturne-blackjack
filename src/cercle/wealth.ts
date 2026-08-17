/** Patrimoine cercle : solde jouable + coffre. */
export function wealthCents(balance: number, vault = 0): number {
  return Math.max(0, Math.floor(balance)) + Math.max(0, Math.floor(vault));
}

/** Record affiché : max(peak stocké, patrimoine actuel). */
export function peakWealthCents(peakBalance: number, balance: number, vault = 0): number {
  return Math.max(Math.max(0, Math.floor(peakBalance)), wealthCents(balance, vault));
}

/** Record après sync/hydrate : jamais en baisse (max local, cloud, patrimoine). */
export function mergeRecordPeak(
  localPeak: number,
  cloudPeak: number,
  balance: number,
  vault = 0,
): number {
  return Math.max(
    Math.max(0, Math.floor(localPeak)),
    peakWealthCents(cloudPeak, balance, vault),
  );
}

/** Pic ≥ 1 000 000 crédits : un 0 au boot = wipe de session, pas une all-in perdue. */
export const WIPE_PEAK_FLOOR_CENTS = 100_000_000;
/** Patrimoine < 1 crédit = considéré comme zéro. */
export const WIPE_WEALTH_CENTS = 100;

/**
 * Uniquement un wipe de session (pic millionnaire + solde vide).
 * Une vraie ruine (all-in perdue) doit rester à 0.
 */
export function restoreWipedPlayable(
  balance: number,
  vault: number,
  peak: number,
  gamesPlayed = 0,
): number {
  const b = Math.max(0, Math.floor(balance));
  const v = Math.max(0, Math.floor(vault));
  const p = Math.max(0, Math.floor(peak));
  if (Math.max(0, Math.floor(gamesPlayed)) > 0) return b;
  if (b + v < WIPE_WEALTH_CENTS && p >= WIPE_PEAK_FLOOR_CENTS) {
    return Math.max(b, p - v);
  }
  return b;
}

/** Normalise un score avant push : pic monotone, sans recoller une perte. */
export function sanitizeScoreForPush<T extends { balance: number; vault: number; peakBalance: number }>(
  seed: T,
): T {
  const peakBalance = peakWealthCents(seed.peakBalance, seed.balance, seed.vault);
  return {
    ...seed,
    peakBalance,
    balance: Math.max(0, Math.floor(seed.balance)),
  };
}
