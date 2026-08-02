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

function fmtChip(cents: number): string {
  const n = cents / 100
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
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
    message: 'Pose un jeton sur « Gagner », puis lance les dés.',
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
    if (!canPlacePass(round)) {
      return { ok: false, error: '« Gagner » seulement au premier lancer.' }
    }
    if (bets.dontPass > 0) {
      return { ok: false, error: 'Choisis soit Gagner, soit Contre — pas les deux.' }
    }
    bets.pass += amountCents
  } else if (kind === 'dont_pass') {
    if (!canPlaceDontPass(round)) {
      return { ok: false, error: '« Contre » seulement au premier lancer.' }
    }
    if (bets.pass > 0) {
      return { ok: false, error: 'Choisis soit Gagner, soit Contre — pas les deux.' }
    }
    bets.dontPass += amountCents
  } else if (kind === 'field') {
    bets.field += amountCents
  } else {
    if (!canPlaceOdds(round) || !round.point) {
      return { ok: false, error: '« Miser plus » s’ouvre quand tu as une cible.' }
    }
    const cap = oddsCap(round)
    if (bets.odds + amountCents > cap) {
      return { ok: false, error: `Tu peux encore miser jusqu’à ${fmtChip(cap)} ici.` }
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
    if (bets.pass + bets.dontPass + bets.field === 0) {
      return 'Pose un jeton sur « Gagner », puis lance les dés.'
    }
    return 'C’est bon — lance les dés !'
  }
  return `Cible ${point} : refais un ${point} avant un 7.`
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

  // « Ce coup » = un seul lancer
  if (bets.field > 0) {
    const stake = bets.field
    if (fieldWins(total)) {
      const profit = fieldWinCents(stake, total)
      credit += stake + profit
      settlements.push({
        kind: 'field_win',
        amountCents: stake + profit,
        label: `Ce coup : +${fmtChip(profit)}`,
      })
    } else {
      settlements.push({
        kind: 'field_lose',
        amountCents: 0,
        label: 'Ce coup perdu (5, 6, 7 ou 8)',
      })
    }
    bets.field = 0
  }

  if (phase === 'come_out') {
    if (total === 7 || total === 11) {
      if (bets.pass > 0) {
        const stake = bets.pass
        credit += stake * 2
        settlements.push({
          kind: 'pass_win',
          amountCents: stake * 2,
          label: `Gagner : ${total} direct — mise doublée`,
        })
        bets.pass = 0
      }
      if (bets.dontPass > 0) {
        settlements.push({
          kind: 'dont_pass_lose',
          amountCents: 0,
          label: `Contre perdu (${total})`,
        })
        bets.dontPass = 0
      }
      message =
        total === 7
          ? '7 ! Tu gagnes tout de suite.'
          : '11 ! Tu gagnes tout de suite.'
    } else if (total === 2 || total === 3) {
      if (bets.pass > 0) {
        settlements.push({
          kind: 'pass_lose',
          amountCents: 0,
          label: `Gagner perdu (${total})`,
        })
        bets.pass = 0
      }
      if (bets.dontPass > 0) {
        const stake = bets.dontPass
        credit += stake * 2
        settlements.push({
          kind: 'dont_pass_win',
          amountCents: stake * 2,
          label: `Contre : ${total} — mise doublée`,
        })
        bets.dontPass = 0
      }
      message = `${total} — Contre gagne, Gagner perd.`
    } else if (total === 12) {
      if (bets.pass > 0) {
        settlements.push({
          kind: 'pass_lose',
          amountCents: 0,
          label: 'Gagner perdu (12)',
        })
        bets.pass = 0
      }
      if (bets.dontPass > 0) {
        const stake = bets.dontPass
        credit += stake
        settlements.push({
          kind: 'dont_pass_push',
          amountCents: stake,
          label: 'Contre : 12 — on te rend ta mise',
        })
        bets.dontPass = 0
      }
      message = '12 — Gagner perd, Contre est remboursé.'
    } else if (isPointNumber(total) && (bets.pass > 0 || bets.dontPass > 0)) {
      phase = 'point'
      point = total
      settlements.push({
        kind: 'point_set',
        amountCents: 0,
        label: `Cible ${total} — la partie continue`,
      })
      message = `Cible ${total} ! Refais un ${total} avant un 7.`
    } else if (isPointNumber(total)) {
      message = `${total} — sans mise Gagner/Contre, rien ne change.`
    }
  } else {
    // Phase cible
    const p = point!
    if (total === 7) {
      if (bets.pass > 0) {
        settlements.push({
          kind: 'pass_lose',
          amountCents: 0,
          label: '7 trop tôt — Gagner perdu',
        })
        bets.pass = 0
      }
      if (bets.odds > 0) {
        settlements.push({
          kind: 'odds_lose',
          amountCents: 0,
          label: 'Miser plus perdu avec le 7',
        })
        bets.odds = 0
      }
      if (bets.dontPass > 0) {
        const stake = bets.dontPass
        credit += stake * 2
        settlements.push({
          kind: 'dont_pass_win',
          amountCents: stake * 2,
          label: 'Contre gagne (le 7 est sorti)',
        })
        bets.dontPass = 0
      }
      settlements.push({ kind: 'seven_out', amountCents: 0, label: '7 avant la cible' })
      phase = 'come_out'
      point = null
      message = '7 trop tôt — tu as perdu.'
    } else if (total === p) {
      if (bets.pass > 0) {
        const stake = bets.pass
        credit += stake * 2
        settlements.push({
          kind: 'pass_win',
          amountCents: stake * 2,
          label: `Gagner : cible ${p} atteinte`,
        })
        bets.pass = 0
      }
      if (bets.odds > 0) {
        const stake = bets.odds
        const profit = oddsWinCents(stake, p)
        credit += stake + profit
        settlements.push({
          kind: 'odds_win',
          amountCents: stake + profit,
          label: `Miser plus : +${fmtChip(profit)}`,
        })
        bets.odds = 0
      }
      if (bets.dontPass > 0) {
        settlements.push({
          kind: 'dont_pass_lose',
          amountCents: 0,
          label: `Contre perdu (cible ${p})`,
        })
        bets.dontPass = 0
      }
      settlements.push({ kind: 'point_made', amountCents: 0, label: `Cible ${p} atteinte` })
      phase = 'come_out'
      point = null
      message = `Cible ${p} ! Tu gagnes.`
    } else {
      message = `${total}… pas encore. Il faut ${p} (attention au 7).`
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
