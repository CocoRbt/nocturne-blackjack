/**
 * Math Plinko — distribution binomiale + tables type Stake (Low/Medium/High).
 * RTP cible ~99 % (aligné Mines/Crash). Les risques ne changent que les mults.
 */

export const PLINKO_RTP = 0.99;
export const PLINKO_ROWS = [8, 12, 16] as const;
export type PlinkoRows = (typeof PLINKO_ROWS)[number];
export type PlinkoRisk = 'low' | 'medium' | 'high';

export const PLINKO_RISKS: PlinkoRisk[] = ['low', 'medium', 'high'];

/** Tables type Stake — symétriques, index = nombre de rebonds « droite ». */
const TABLES: Record<PlinkoRows, Record<PlinkoRisk, readonly number[]>> = {
  8: {
    low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
  },
  12: {
    low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
  },
  16: {
    low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
    medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
    high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};

export function clampRows(rows: number): PlinkoRows {
  if (rows <= 8) return 8;
  if (rows <= 12) return 12;
  return 16;
}

export function slotCount(rows: PlinkoRows): number {
  return rows + 1;
}

export function paytable(rows: PlinkoRows, risk: PlinkoRisk): readonly number[] {
  return TABLES[rows][risk];
}

export function multiplierAt(rows: PlinkoRows, risk: PlinkoRisk, slot: number): number {
  const table = paytable(rows, risk);
  if (slot < 0 || slot >= table.length) return 0;
  return table[slot]!;
}

/** Coefficient binomial C(n, k). */
export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const kk = Math.min(k, n - k);
  let res = 1;
  for (let i = 1; i <= kk; i++) {
    res = (res * (n - kk + i)) / i;
  }
  return Math.round(res);
}

/** P(slot = k) = C(rows, k) / 2^rows */
export function slotProbability(rows: PlinkoRows, slot: number): number {
  const ways = binomial(rows, slot);
  return ways / 2 ** rows;
}

/** RTP théorique = Σ p(k) · m(k) */
export function theoreticalRtp(rows: PlinkoRows, risk: PlinkoRisk): number {
  const table = paytable(rows, risk);
  let ev = 0;
  for (let k = 0; k < table.length; k++) {
    ev += slotProbability(rows, k) * table[k]!;
  }
  return ev;
}

export function payoutCents(bet: number, multiplier: number): number {
  return Math.floor(bet * multiplier + 1e-9);
}

export function riskLabel(risk: PlinkoRisk): string {
  if (risk === 'low') return 'Faible';
  if (risk === 'medium') return 'Moyen';
  return 'Élevé';
}
