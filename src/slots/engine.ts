import { cryptoRng, type Rng } from '../engine/rng';
import type { JackpotTier } from './jackpot';
import {
  BASE_STRIPS,
  FREE_STRIPS,
  evaluateSpin,
  gridFromStops,
  pickStops,
  payoutCents,
  type SlotSymbol,
  type SpinEval,
  type WayWin,
} from './math';

export type SlotsPhase = 'idle' | 'spinning' | 'settled';

export type SlotsMode = 'base' | 'free';

export interface SlotsRound {
  phase: SlotsPhase;
  mode: SlotsMode;
  bet: number;
  stops: readonly number[];
  /** Grille affichée (après transform troupeau si FS). */
  grid: SlotSymbol[][];
  eval: SpinEval | null;
  wayWins: WayWin[];
  payout: number;
  /** Free spins restants après ce spin (0 si hors bonus). */
  freeSpinsLeft: number;
  /** Compteur troupeau cumulé dans le bonus. */
  herdHeads: number;
  /** Spins free accordés par CE résultat (trigger ou retrigger). */
  freeSpinsGranted: number;
  /** Jackpot progressif (spin de base uniquement). */
  jackpotTier: JackpotTier | null;
}

export function createIdleRound(): SlotsRound {
  return {
    phase: 'idle',
    mode: 'base',
    bet: 0,
    stops: [0, 0, 0, 0, 0],
    grid: gridFromStops(BASE_STRIPS, [0, 0, 0, 0, 0]),
    eval: null,
    wayWins: [],
    payout: 0,
    freeSpinsLeft: 0,
    herdHeads: 0,
    freeSpinsGranted: 0,
    jackpotTier: null,
  };
}

export type StartSpinInput = {
  bet: number;
  /** Si > 0, on est en free spin (pas de débit). */
  freeSpinsLeft?: number;
  herdHeads?: number;
  mode?: SlotsMode;
  rng?: Rng;
};

/** Tire le résultat (stops + eval) — l’anim UI suit ensuite. */
export function startSpin(input: StartSpinInput): SlotsRound {
  const bet = Math.floor(input.bet);
  if (bet <= 0) throw new Error('Mise invalide');

  const freeLeft = Math.max(0, Math.floor(input.freeSpinsLeft ?? 0));
  const mode: SlotsMode = freeLeft > 0 || input.mode === 'free' ? 'free' : 'base';
  const herdHeads = Math.max(0, Math.floor(input.herdHeads ?? 0));
  const rng = input.rng ?? cryptoRng();

  const strips = mode === 'free' ? FREE_STRIPS : BASE_STRIPS;
  const stops = pickStops(strips, rng);
  const rawGrid = gridFromStops(strips, stops);
  const ev = evaluateSpin(rawGrid, {
    freeSpinMode: mode === 'free',
    herdHeads,
    rng,
  });

  const nextHerd = mode === 'free' ? herdHeads + ev.bisonLanded : 0;
  let nextFree = 0;
  if (mode === 'base') {
    nextFree = ev.freeSpins;
  } else {
    // Consomme 1 FS, ajoute retriggers.
    nextFree = Math.max(0, freeLeft - 1) + ev.freeSpins;
  }

  return {
    phase: 'spinning',
    mode,
    bet,
    stops,
    grid: ev.grid,
    eval: ev,
    wayWins: ev.wayWins,
    payout: payoutCents(bet, ev.totalMult),
    freeSpinsLeft: nextFree,
    herdHeads: mode === 'free' ? nextHerd : 0,
    freeSpinsGranted: ev.freeSpins,
    jackpotTier: mode === 'base' ? ev.jackpotTier : null,
  };
}

export function settleSpin(round: SlotsRound): SlotsRound {
  if (round.phase !== 'spinning') return round;
  return { ...round, phase: 'settled' };
}

export function resetAfterSettle(round: SlotsRound): SlotsRound {
  if (round.freeSpinsLeft > 0) {
    return {
      ...round,
      phase: 'idle',
      mode: 'free',
      // garde bet / herd / freeSpinsLeft pour le prochain auto-spin
      eval: null,
      wayWins: [],
      payout: 0,
      freeSpinsGranted: 0,
      jackpotTier: null,
    };
  }
  return {
    ...createIdleRound(),
    grid: round.grid,
    stops: [...round.stops],
  };
}
