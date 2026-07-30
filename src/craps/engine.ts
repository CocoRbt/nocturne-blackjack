import {
  fieldWinCents,
  fieldWins,
  isPointNumber,
  maxOddsCents,
  oddsWinCents,
  type PointNumber,
} from './math'

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6

export type CrapsPhase = 'come_out' | 'point'

export type BetKind = 'pass' | 'dont_pass' | 'field' | 'odds'

export interface WorkingBets {
  pass: number
  dontPass: number
  field: number
  odds: number
}

export interface DiceRoll {
  d1: DieFace
  d2: DieFace
  total: number
}

export type SettleKind =
  | 'pass_win'
  | 'pass_lose'
  | 'dont_pass_win'
  | 'dont_pass_lose'
  | 'dont_pass_push'
  | 'field_win'
  | 'field_lose'
  | 'odds_win'
  | 'odds_lose'
  | 'point_set'
  | 'seven_out'
  | 'point_made'

export interface SettlementLine {
  kind: SettleKind
  amountCents: number
  label: string
}

export interface CrapsRound {
  phase: CrapsPhase
  point: PointNumber | null
  bets: WorkingBets
  lastRoll: DiceRoll | null
  history: DiceRoll[]
  settlements: SettlementLine[]
  /** Net chip flow this resolution (credits − debits already applied for stakes). */
  lastNetCents: number
  message: string
}

export function emptyBets(): WorkingBets {
  return { pass: 0, dontPass: 0, field: 0, odds: 0 }
}

export function createCrapsRound(): CrapsRound {
  return {
    phase: 'come_out',
    point: null,
    bets: emptyBets(),
    lastRoll: null,
    history: [],
    settlements: [],
    lastNetCents: 0,
    message: 'Come-out — Pass / Don’t Pass / Field.',
  }
}

function rollDie(rng: () => number): DieFace {
  return (Math.floor(rng() * 6) + 1) as DieFace
}

export function rollDice(rng: () => number = Math.random): DiceRoll {
  const d1 = rollDie(rng)
  const d2 = rollDie(rng)
  return { d1, d2, total: d1 + d2 }
}

/** Crypto RNG in [0, 1). */
export function cryptoUnit(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0]! / 2 ** 32
}

export function canPlacePass(round: CrapsRound): boolean {
  return round.phase === 'come_out'
}

export function canPlaceDontPass(round: CrapsRound): boolean {
  return round.phase === 'come_out'
}

export function canPlaceField(_round: CrapsRound): boolean {
  return true
}

export function canPlaceOdds(round: CrapsRound): boolean {
  return round.phase === 'point' && round.bets.pass > 0 && round.point != null
}

export function oddsCap(round: CrapsRound): number {
  if (!round.point || round.bets.pass <= 0) return 0
  return maxOddsCents(round.bets.pass, round.point)
}

export type PlaceBetResult =
  | { ok: true; round: CrapsRound; debitCents: number }
  | { ok: false; error: string }

export function placeBet(
  round: CrapsRound,
  kind: BetKind,
  amountCents: number,
): PlaceBetResult {
  if (!Number.isFinite(amountCents) || amountCents <= 0 || !Number.isInteger(amountCents)) {
    return { ok: false, error: 'Mise invalide.' }
  }

  const bets = { ...round.bets }

  if (kind === 'pass') {
    if (!canPlacePass(round)) return { ok: false, error: 'Pass Line uniquement au come-out.' }
    if (bets.dontPass > 0) return { ok: false, error: 'Pass et Don’t Pass incompatibles.' }
    bets.pass += amountCents
  } else if (kind === 'dont_pass') {
    if (!canPlaceDontPass(round)) return { ok: false, error: 'Don’t Pass uniquement au come-out.' }
    if (bets.pass > 0) return { ok: false, error: 'Pass et Don’t Pass incompatibles.' }
    bets.dontPass += amountCents
  } else if (kind === 'field') {
    bets.field += amountCents
  } else {
    if (!canPlaceOdds(round) || !round.point) {
      return { ok: false, error: 'Odds derrière Pass uniquement quand un point est établi.' }
    }
    const cap = oddsCap(round)
    if (bets.odds + amountCents > cap) {
      return { ok: false, error: `Odds max ${cap} ¢ pour ce point.` }
    }
    bets.odds += amountCents
  }

  return {
    ok: true,
    debitCents: amountCents,
    round: {
      ...round,
      bets,
      settlements: [],
      lastNetCents: 0,
      message: messageForBets(round.phase, round.point, bets),
    },
  }
}

function messageForBets(phase: CrapsPhase, point: PointNumber | null, bets: WorkingBets): string {
  if (phase === 'come_out') {
    if (bets.pass + bets.dontPass + bets.field === 0) return 'Come-out — placez vos jetons.'
    return 'Come-out — lancez les dés.'
  }
  return `Point ${point} — Field / Odds / lancez.`
}

export type RollResult =
  | { ok: true; round: CrapsRound; creditCents: number }
  | { ok: false; error: string }

/**
 * Resolve one roll. Stakes were already debited on placeBet.
 * creditCents = returned stakes + winnings paid this resolution.
 */
export function resolveRoll(round: CrapsRound, roll: DiceRoll): RollResult {
  const lineWorking = round.bets.pass + round.bets.dontPass + round.bets.odds
  if (lineWorking === 0 && round.bets.field === 0) {
    return { ok: false, error: 'Placez au moins une mise.' }
  }
  if (round.phase === 'come_out' && round.bets.pass === 0 && round.bets.dontPass === 0 && round.bets.field === 0) {
    return { ok: false, error: 'Placez au moins une mise.' }
  }

  const settlements: SettlementLine[] = []
  let credit = 0
  let bets = { ...round.bets }
  let phase = round.phase
  let point = round.point
  let message = ''

  const total = roll.total

  // Field always one-roll
  if (bets.field > 0) {
    const stake = bets.field
    if (fieldWins(total)) {
      const profit = fieldWinCents(stake, total)
      credit += stake + profit
      settlements.push({
        kind: 'field_win',
        amountCents: stake + profit,
        label: `Field +${profit / 100}€ (mise rendue)`,
      })
    } else {
      settlements.push({ kind: 'field_lose', amountCents: 0, label: 'Field perdu' })
    }
    bets.field = 0
  }

  if (phase === 'come_out') {
    if (total === 7 || total === 11) {
      if (bets.pass > 0) {
        const stake = bets.pass
        credit += stake * 2
        settlements.push({ kind: 'pass_win', amountCents: stake * 2, label: 'Pass Line gagne (natural)' })
        bets.pass = 0
      }
      if (bets.dontPass > 0) {
        settlements.push({ kind: 'dont_pass_lose', amountCents: 0, label: 'Don’t Pass perdu' })
        bets.dontPass = 0
      }
      message = total === 7 ? 'Natural 7 — come-out.' : 'Natural 11 — come-out.'
    } else if (total === 2 || total === 3) {
      if (bets.pass > 0) {
        settlements.push({ kind: 'pass_lose', amountCents: 0, label: 'Pass Line craps' })
        bets.pass = 0
      }
      if (bets.dontPass > 0) {
        const stake = bets.dontPass
        credit += stake * 2
        settlements.push({
          kind: 'dont_pass_win',
          amountCents: stake * 2,
          label: 'Don’t Pass gagne (craps)',
        })
        bets.dontPass = 0
      }
      message = `Craps ${total} — come-out.`
    } else if (total === 12) {
      if (bets.pass > 0) {
        settlements.push({ kind: 'pass_lose', amountCents: 0, label: 'Pass Line craps (12)' })
        bets.pass = 0
      }
      if (bets.dontPass > 0) {
        const stake = bets.dontPass
        credit += stake
        settlements.push({
          kind: 'dont_pass_push',
          amountCents: stake,
          label: 'Don’t Pass push (12)',
        })
        bets.dontPass = 0
      }
      message = 'Craps 12 — Don’t Pass push.'
    } else if (isPointNumber(total) && (bets.pass > 0 || bets.dontPass > 0)) {
      phase = 'point'
      point = total
      settlements.push({
        kind: 'point_set',
        amountCents: 0,
        label: `Point établi : ${total}`,
      })
      message = `Point ${total}. Odds ouverts (Pass).`
    } else if (isPointNumber(total)) {
      message = `${total} — pas de ligne ; nouveau come-out.`
    }
  } else {
    // Point phase
    const p = point!
    if (total === 7) {
      if (bets.pass > 0) {
        settlements.push({ kind: 'pass_lose', amountCents: 0, label: 'Seven-out — Pass perdu' })
        bets.pass = 0
      }
      if (bets.odds > 0) {
        settlements.push({ kind: 'odds_lose', amountCents: 0, label: 'Odds perdues' })
        bets.odds = 0
      }
      if (bets.dontPass > 0) {
        const stake = bets.dontPass
        credit += stake * 2
        settlements.push({
          kind: 'dont_pass_win',
          amountCents: stake * 2,
          label: 'Don’t Pass gagne (seven-out)',
        })
        bets.dontPass = 0
      }
      settlements.push({ kind: 'seven_out', amountCents: 0, label: 'Seven-out' })
      phase = 'come_out'
      point = null
      message = 'Seven-out — nouveau come-out.'
    } else if (total === p) {
      if (bets.pass > 0) {
        const stake = bets.pass
        credit += stake * 2
        settlements.push({ kind: 'pass_win', amountCents: stake * 2, label: 'Pass Line — point fait' })
        bets.pass = 0
      }
      if (bets.odds > 0) {
        const stake = bets.odds
        const profit = oddsWinCents(stake, p)
        credit += stake + profit
        settlements.push({
          kind: 'odds_win',
          amountCents: stake + profit,
          label: `Odds +${(profit / 100).toFixed(2)}€`,
        })
        bets.odds = 0
      }
      if (bets.dontPass > 0) {
        settlements.push({ kind: 'dont_pass_lose', amountCents: 0, label: 'Don’t Pass perdu (point)' })
        bets.dontPass = 0
      }
      settlements.push({ kind: 'point_made', amountCents: 0, label: `Point ${p} fait` })
      phase = 'come_out'
      point = null
      message = `Point ${p} fait — nouveau come-out.`
    } else {
      message = `Rien (${total}) — point ${p} toujours en jeu.`
    }
  }

  const history = [...round.history, roll].slice(-12)

  return {
    ok: true,
    creditCents: credit,
    round: {
      phase,
      point,
      bets,
      lastRoll: roll,
      history,
      settlements,
      lastNetCents: credit,
      message,
    },
  }
}

export function rollAndResolve(
  round: CrapsRound,
  rng: () => number = cryptoUnit,
): RollResult {
  return resolveRoll(round, rollDice(rng))
}

/** Clear leftover line bets is not allowed mid-point for pass — only used after settle. */
export function clearFieldOnly(round: CrapsRound): CrapsRound {
  return { ...round, bets: { ...round.bets, field: 0 } }
}
