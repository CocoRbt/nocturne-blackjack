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

/**
 * Phase 2a : identity — ne jamais reconstruire un solde depuis le record.
 * Conservé pour ne pas casser d’imports tests ; plus aucun chemin runtime.
 */
export function restoreWipedPlayable(
  balance: number,
  _vault?: number,
  _peak?: number,
  _gamesPlayed?: number,
): number {
  return Math.max(0, Math.floor(balance));
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
