import { cryptoRng, shuffle, type Rng } from '../engine/rng';
import {
  MINES_GRID,
  MINES_MAX,
  MINES_MIN,
  maxSafeTiles,
  minesMultiplier,
  nextTileMultiplier,
  payoutCents,
} from './math';

export type MinesPhase = 'idle' | 'playing' | 'busted' | 'cashed';

export interface MinesRound {
  phase: MinesPhase;
  bet: number;
  mines: number;
  /** Indices 0..24 qui sont des mines (figés au bet). */
  mineSet: ReadonlySet<number>;
  revealed: number[];
  multiplier: number;
  nextMultiplier: number;
}

export interface MinesRevealResult {
  round: MinesRound;
  hitMine: boolean;
  autoCashed: boolean;
  payout: number;
}

export function clampMines(mines: number): number {
  return Math.min(MINES_MAX, Math.max(MINES_MIN, Math.floor(mines)));
}

export function createIdleRound(mines = 3): MinesRound {
  const m = clampMines(mines);
  return {
    phase: 'idle',
    bet: 0,
    mines: m,
    mineSet: new Set(),
    revealed: [],
    multiplier: 1,
    nextMultiplier: nextTileMultiplier(0, m),
  };
}

/** Place `mines` bombes aléatoirement sur la grille. */
export function placeMines(mines: number, rng: Rng = cryptoRng()): Set<number> {
  const m = clampMines(mines);
  const indices = Array.from({ length: MINES_GRID }, (_, i) => i);
  shuffle(indices, rng);
  return new Set(indices.slice(0, m));
}

export function startRound(bet: number, mines: number, rng: Rng = cryptoRng()): MinesRound {
  if (bet <= 0) throw new Error('Mise invalide');
  const m = clampMines(mines);
  return {
    phase: 'playing',
    bet,
    mines: m,
    mineSet: placeMines(m, rng),
    revealed: [],
    multiplier: 1,
    nextMultiplier: nextTileMultiplier(0, m),
  };
}

export function revealTile(round: MinesRound, index: number): MinesRevealResult {
  if (round.phase !== 'playing') {
    return { round, hitMine: false, autoCashed: false, payout: 0 };
  }
  if (index < 0 || index >= MINES_GRID || round.revealed.includes(index)) {
    return { round, hitMine: false, autoCashed: false, payout: 0 };
  }

  if (round.mineSet.has(index)) {
    return {
      round: {
        ...round,
        phase: 'busted',
        revealed: [...round.revealed, index],
        multiplier: 0,
        nextMultiplier: 0,
      },
      hitMine: true,
      autoCashed: false,
      payout: 0,
    };
  }

  const revealed = [...round.revealed, index];
  const gems = revealed.length;
  const multiplier = minesMultiplier(gems, round.mines);
  const autoCashed = gems >= maxSafeTiles(round.mines);
  const next: MinesRound = {
    ...round,
    phase: autoCashed ? 'cashed' : 'playing',
    revealed,
    multiplier,
    nextMultiplier: autoCashed ? multiplier : nextTileMultiplier(gems, round.mines),
  };
  return {
    round: next,
    hitMine: false,
    autoCashed,
    payout: autoCashed ? payoutCents(round.bet, multiplier) : 0,
  };
}

export function cashOut(round: MinesRound): { round: MinesRound; payout: number } {
  if (round.phase !== 'playing' || round.revealed.length === 0) {
    return { round, payout: 0 };
  }
  return {
    round: { ...round, phase: 'cashed', nextMultiplier: round.multiplier },
    payout: payoutCents(round.bet, round.multiplier),
  };
}

export function shouldShowMine(round: MinesRound, index: number): boolean {
  if (!round.mineSet.has(index)) return false;
  if (round.phase === 'busted' || round.phase === 'cashed') return true;
  return round.revealed.includes(index);
}

export function shouldShowGem(round: MinesRound, index: number): boolean {
  if (round.mineSet.has(index)) return false;
  if (round.revealed.includes(index)) return true;
  return round.phase === 'busted' || round.phase === 'cashed';
}

export { MINES_GRID, MINES_MIN, MINES_MAX };
