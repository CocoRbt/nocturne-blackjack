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
  /** L’avion vole encore (même après cashout, jusqu’au crash). */
  flightActive: boolean
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
    flightActive: false,
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
    flightActive: crashAt > 1,
  }
}

export type TickResult = {
  round: CrashRound
  /** Multiplicateur affiché (borné au crash) — continue après cashout. */
  displayMult: number
  justCrashed: boolean
  justAutoCashed: boolean
  /** Vol terminé (crash atteint), que le joueur ait encaissé ou non. */
  justFlightEnded: boolean
}

/** Avance la manche à `elapsedMs` depuis le décollage. */
export function tickRound(round: CrashRound, elapsedMs: number): TickResult {
  if (!round.flightActive) {
    return {
      round,
      displayMult: round.crashAt > 1 || round.phase === 'crashed' ? round.crashAt : 1,
      justCrashed: false,
      justAutoCashed: false,
      justFlightEnded: false,
    }
  }

  const raw = multiplierAtElapsed(elapsedMs)
  const displayMult = Math.min(raw, round.crashAt)

  let next = round
  let justAutoCashed = false

  // Auto-cashout pendant le vol (une seule fois)
  if (
    next.phase === 'flying' &&
    next.autoCashout != null &&
    next.autoCashout < next.crashAt &&
    displayMult >= next.autoCashout
  ) {
    const cashAt = next.autoCashout
    next = {
      ...next,
      phase: 'cashed',
      cashoutAt: cashAt,
      payout: payoutCents(next.bet, cashAt),
    }
    justAutoCashed = true
  }

  if (raw >= round.crashAt) {
    const ended: CrashRound = {
      ...next,
      flightActive: false,
      // Si déjà encaissé, on reste « cashed » ; sinon crash perdu.
      phase: next.phase === 'cashed' || next.cashoutAt != null ? 'cashed' : 'crashed',
      payout: next.phase === 'cashed' || next.cashoutAt != null ? next.payout : 0,
    }
    return {
      round: ended,
      displayMult: round.crashAt,
      justCrashed: ended.phase === 'crashed',
      justAutoCashed,
      justFlightEnded: true,
    }
  }

  return {
    round: next,
    displayMult,
    justCrashed: false,
    justAutoCashed,
    justFlightEnded: false,
  }
}

export type CashResult =
  | { ok: true; round: CrashRound; payout: number }
  | { ok: false; error: string }

/** Encaissement manuel si encore en vol et avant le crash. Le vol continue. */
export function cashOut(round: CrashRound, currentMult: number): CashResult {
  if (round.phase !== 'flying' || !round.flightActive) {
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
      flightActive: true,
    },
  }
}
