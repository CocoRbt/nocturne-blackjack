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

/** Pic au-dessus du solde de départ (100 crédits) : un 0 est un wipe, pas une ruine. */
export const WIPE_PEAK_FLOOR_CENTS = 10_000;
/** Patrimoine < 1 crédit = considéré comme zéro. */
export const WIPE_WEALTH_CENTS = 100;

/**
 * Record réel + solde ~0 = wipe (nouvelle session / hydrate cloud vide).
 * Recolle le jouable sur le pic.
 */
export function restoreWipedPlayable(balance: number, vault: number, peak: number): number {
  const b = Math.max(0, Math.floor(balance));
  const v = Math.max(0, Math.floor(vault));
  const p = Math.max(0, Math.floor(peak));
  if (b + v < WIPE_WEALTH_CENTS && p >= WIPE_PEAK_FLOOR_CENTS) {
    return Math.max(b, p - v);
  }
  return b;
}

/** Normalise un score avant push cloud (pic monotone + anti-wipe). */
export function sanitizeScoreForPush<T extends { balance: number; vault: number; peakBalance: number }>(
  seed: T,
): T {
  const peakBalance = peakWealthCents(seed.peakBalance, seed.balance, seed.vault);
  return {
    ...seed,
    peakBalance,
    balance: restoreWipedPlayable(seed.balance, seed.vault, peakBalance),
  };
}
