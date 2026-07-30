/** Math Crash — RTP 99 %, formule type Stake Originals. */

export const CRASH_RTP = 0.99;
export const CRASH_MAX = 1_000_000;
/** Le multiplicateur double environ toutes les 3,5 s (feel Stake). */
export const CRASH_DOUBLE_MS = 3500;
export const CRASH_GROWTH = Math.LN2 / CRASH_DOUBLE_MS;

/**
 * Point de crash depuis u ∈ [0, 1).
 * Équivalent Stake : max(1, floor((2³²/(h+1)) × 0.99 × 100) / 100)
 * → ~1 % d’instant crash à 1.00×.
 */
export function crashPointFromUnit(u: number): number {
  const clamped = Number.isFinite(u) ? Math.min(Math.max(u, 0), 0.999999999) : 0;
  const h = Math.floor(clamped * 0x1_0000_0000); // 0 … 2³²−1
  const raw = (0x1_0000_0000 / (h + 1)) * CRASH_RTP;
  const point = Math.floor(raw * 100 + 1e-9) / 100;
  return Math.max(1, Math.min(CRASH_MAX, point));
}

/** Multiplicateur affiché après `elapsedMs` de vol (exponentiel). */
export function multiplierAtElapsed(elapsedMs: number): number {
  if (elapsedMs <= 0) return 1;
  return Math.exp(CRASH_GROWTH * elapsedMs);
}

/** Temps (ms) pour atteindre un multiplicateur `m` (≥ 1). */
export function elapsedForMultiplier(m: number): number {
  if (m <= 1) return 0;
  return Math.log(m) / CRASH_GROWTH;
}

/** Probabilité d’atteindre au moins `m` (RTP / m). */
export function reachChance(m: number, rtp = CRASH_RTP): number {
  if (m <= 1) return 1;
  return Math.min(1, rtp / m);
}

export function payoutCents(bet: number, multiplier: number): number {
  return Math.floor(bet * multiplier + 1e-9);
}
