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

/** 1 000 000 crédits (centimes). En-dessous on ne « recolle » pas un wipe. */
export const MILLIONAIRE_PEAK_CENTS = 100_000_000;
/** Patrimoine < 1 crédit = considéré comme zéro. */
export const WIPE_WEALTH_CENTS = 100;

/**
 * Record millionnaire + solde ~0 = wipe (nouvelle session / hydrate cloud vide),
 * pas une vraie ruine. Recolle le jouable sur le pic.
 */
export function restoreWipedPlayable(balance: number, vault: number, peak: number): number {
  const b = Math.max(0, Math.floor(balance));
  const v = Math.max(0, Math.floor(vault));
  const p = Math.max(0, Math.floor(peak));
  if (b + v < WIPE_WEALTH_CENTS && p >= MILLIONAIRE_PEAK_CENTS) {
    return Math.max(b, p - v);
  }
  return b;
}
