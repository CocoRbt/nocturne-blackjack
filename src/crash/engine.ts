import { cryptoRng, type Rng } from '../engine/rng'
import {
  crashPointFromUnit,
  elapsedForMultiplier,
  multiplierAtElapsed,
  payoutCents,
} from './math'

export type CrashPhase = 'idle' | 'flying' | 'cashed' | 'crashed'

export interface CrashRound {
  phase: CrashPhase
  bet: number
  crashAt: number
  /** Multiplicateur d’encaissement (si cashed). */
  cashoutAt: number | null
  /** Auto-cashout cible, ou null. */
  autoCashout: number | null
  payout: number
  /** Durée de vol jusqu’au crash (ms). */
  crashDurationMs: number
}

export function createIdleRound(): CrashRound {
  return {
    phase: 'idle',
    bet: 0,
    crashAt: 1,
    cashoutAt: null,
    autoCashout: null,
    payout: 0,
    crashDurationMs: 0,
  }
}

export function startRound(
  betCents: number,
  autoCashout: number | null = null,
  rng: Rng = cryptoRng(),
): CrashRound {
  const bet = Math.floor(betCents)
  if (bet < 1_00) throw new Error('Mise minimale 1.')
  const crashAt = crashPointFromUnit(rng())
  const auto =
    autoCashout != null && Number.isFinite(autoCashout) && autoCashout >= 1.01
      ? Math.floor(autoCashout * 100) / 100
      : null
  return {
    phase: 'flying',
    bet,
    crashAt,
    cashoutAt: null,
    autoCashout: auto,
    payout: 0,
    crashDurationMs: elapsedForMultiplier(crashAt),
  }
}

export type TickResult = {
  round: CrashRound
  /** Multiplicateur affiché (borné au crash). */
  displayMult: number
  justCrashed: boolean
  justAutoCashed: boolean
}

/** Avance la manche à `elapsedMs` depuis le décollage. */
export function tickRound(round: CrashRound, elapsedMs: number): TickResult {
  if (round.phase !== 'flying') {
    return {
      round,
      displayMult: round.cashoutAt ?? round.crashAt,
      justCrashed: false,
      justAutoCashed: false,
    }
  }

  const raw = multiplierAtElapsed(elapsedMs)
  const displayMult = Math.min(raw, round.crashAt)

  // Auto-cashout avant le crash
  if (round.autoCashout != null && round.autoCashout < round.crashAt && displayMult >= round.autoCashout) {
    const cashAt = round.autoCashout
    return {
      justCrashed: false,
      justAutoCashed: true,
      displayMult: cashAt,
      round: {
        ...round,
        phase: 'cashed',
        cashoutAt: cashAt,
        payout: payoutCents(round.bet, cashAt),
      },
    }
  }

  if (raw >= round.crashAt) {
    return {
      justCrashed: true,
      justAutoCashed: false,
      displayMult: round.crashAt,
      round: {
        ...round,
        phase: 'crashed',
        cashoutAt: null,
        payout: 0,
      },
    }
  }

  return { round, displayMult, justCrashed: false, justAutoCashed: false }
}

export type CashResult =
  | { ok: true; round: CrashRound; payout: number }
  | { ok: false; error: string }

/** Encaissement manuel si encore en vol et avant le crash. */
export function cashOut(round: CrashRound, currentMult: number): CashResult {
  if (round.phase !== 'flying') {
    return { ok: false, error: 'Plus rien à encaisser.' }
  }
  const m = Math.floor(currentMult * 100 + 1e-9) / 100
  if (m < 1.01) {
    return { ok: false, error: 'Trop tôt pour encaisser.' }
  }
  if (m >= round.crashAt) {
    return { ok: false, error: 'L’avion a déjà crashé.' }
  }
  const payout = payoutCents(round.bet, m)
  return {
    ok: true,
    payout,
    round: {
      ...round,
      phase: 'cashed',
      cashoutAt: m,
      payout,
    },
  }
}
