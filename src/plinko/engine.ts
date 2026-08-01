import { cryptoRng, type Rng } from '../engine/rng';
import {
  clampRows,
  multiplierAt,
  payoutCents,
  type PlinkoRisk,
  type PlinkoRows,
} from './math';

export type PlinkoPhase = 'idle' | 'dropping' | 'settled';

export interface PlinkoRound {
  phase: PlinkoPhase;
  bet: number;
  rows: PlinkoRows;
  risk: PlinkoRisk;
  /** Rebond droite (true) / gauche (false) par rangée — figé au drop. */
  path: readonly boolean[];
  /** Slot final = nombre de droites (0..rows). */
  slot: number;
  multiplier: number;
  payout: number;
}

export function createIdleRound(rows: PlinkoRows = 12, risk: PlinkoRisk = 'medium'): PlinkoRound {
  return {
    phase: 'idle',
    bet: 0,
    rows: clampRows(rows),
    risk,
    path: [],
    slot: -1,
    multiplier: 0,
    payout: 0,
  };
}

/** Tire le chemin : chaque rangée = 50/50. */
export function rollPath(rows: PlinkoRows, rng: Rng = cryptoRng()): boolean[] {
  const path: boolean[] = [];
  for (let i = 0; i < rows; i++) {
    path.push(rng() < 0.5);
  }
  return path;
}

export function pathToSlot(path: readonly boolean[]): number {
  let slot = 0;
  for (const right of path) if (right) slot += 1;
  return slot;
}

export function startDrop(
  bet: number,
  rows: number,
  risk: PlinkoRisk,
  rng: Rng = cryptoRng(),
): PlinkoRound {
  if (bet <= 0) throw new Error('Mise invalide');
  const r = clampRows(rows);
  const path = rollPath(r, rng);
  const slot = pathToSlot(path);
  const multiplier = multiplierAt(r, risk, slot);
  const payout = payoutCents(bet, multiplier);
  return {
    phase: 'dropping',
    bet,
    rows: r,
    risk,
    path,
    slot,
    multiplier,
    payout,
  };
}

/** Fin d’animation → settled (le crédit UI se fait ici). */
export function settleDrop(round: PlinkoRound): PlinkoRound {
  if (round.phase !== 'dropping') return round;
  return { ...round, phase: 'settled' };
}

export function resetIdle(round: PlinkoRound): PlinkoRound {
  return createIdleRound(round.rows, round.risk);
}
