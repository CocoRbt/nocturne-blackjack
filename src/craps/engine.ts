/**
 * Street Craps façon « Gamble With Your Friends » :
 * une mise, ×2 au 1er lancer, ×4 une fois la cible fixée,
 * chiffres gagnants/perdants qui changent, remboursement après 3 jets neutres.
 */
import {
  COME_OUT_LOSES,
  COME_OUT_WINS,
  MULT_COME_OUT,
  MULT_POINT,
  POINT_ROLLS_BEFORE_PUSH,
  comeOutLoses,
  comeOutWins,
  isPointNumber,
  winCreditCents,
  type PointNumber,
} from './math'

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6

export type CrapsPhase = 'come_out' | 'point'

export interface DiceRoll {
  d1: DieFace
  d2: DieFace
  total: number
}

export type SettleKind =
  | 'come_out_win'
  | 'come_out_lose'
  | 'point_set'
  | 'point_win'
  | 'point_lose'
  | 'point_push'
  | 'point_continue'

export interface SettlementLine {
  kind: SettleKind
  amountCents: number
  label: string
}

export interface CrapsRound {
  phase: CrapsPhase
  point: PointNumber | null
  /** Jets déjà joués en phase cible (0 → POINT_ROLLS_BEFORE_PUSH). */
  pointRolls: number
  /** Mise unique en cours (0 = table libre). */
  bet: number
  lastRoll: DiceRoll | null
  history: DiceRoll[]
  settlements: SettlementLine[]
  lastNetCents: number
  message: string
}

export function createCrapsRound(): CrapsRound {
  return {
    phase: 'come_out',
    point: null,
    pointRolls: 0,
    bet: 0,
    lastRoll: null,
    history: [],
    settlements: [],
    lastNetCents: 0,
    message: 'Choisis ta mise, puis lance. 7 ou 11 = gagné ×2.',
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

export function currentMult(round: CrapsRound): number {
  return round.phase === 'point' ? MULT_POINT : MULT_COME_OUT
}

/** Chiffres affichés selon la phase (ils changent après le 1er total). */
export function boardNumbers(round: CrapsRound): {
  wins: readonly number[]
  loses: readonly number[]
  hint: string
} {
  if (round.phase === 'point' && round.point != null) {
    const left = POINT_ROLLS_BEFORE_PUSH - round.pointRolls
    return {
      wins: [round.point],
      loses: [7],
      hint:
        left <= 1
          ? `Dernier jet : ${round.point} = ×4, 7 = perdu, autre = remboursé`
          : `Encore ${left} jet${left > 1 ? 's' : ''} : ${round.point} = ×4 · 7 = perdu · autre = on continue`,
    }
  }
  return {
    wins: COME_OUT_WINS,
    loses: COME_OUT_LOSES,
    hint: 'Autre chiffre (4–6, 8–10) → on fixe une cible, puis ×4',
  }
}

export type PlaceBetResult =
  | { ok: true; round: CrapsRound; debitCents: number }
  | { ok: false; error: string }

/** Pose / ajoute à la mise unique (seulement avant le 1er lancer d’une manche). */
export function placeBet(round: CrapsRound, amountCents: number): PlaceBetResult {
  if (!Number.isFinite(amountCents) || amountCents <= 0 || !Number.isInteger(amountCents)) {
    return { ok: false, error: 'Mise invalide.' }
  }
  if (round.phase === 'point') {
    return { ok: false, error: 'Attends la fin de la cible pour remiser.' }
  }
  const bet = round.bet + amountCents
  return {
    ok: true,
    debitCents: amountCents,
    round: {
      ...round,
      bet,
      settlements: [],
      lastNetCents: 0,
      message: `Mise ${fmtChip(bet)} · lance pour ×2 (ou fixer une cible → ×4).`,
    },
  }
}

export type TakeBackResult =
  | { ok: true; round: CrapsRound; creditCents: number }
  | { ok: false; error: string }

/** Reprend la mise avant le 1er lancer (come-out uniquement). */
export function takeBackBet(round: CrapsRound): TakeBackResult {
  if (round.phase === 'point') {
    return { ok: false, error: 'La cible est lancée — trop tard pour reprendre.' }
  }
  if (round.bet <= 0) {
    return { ok: false, error: 'Rien à reprendre.' }
  }
  const creditCents = round.bet
  return {
    ok: true,
    creditCents,
    round: {
      ...round,
      bet: 0,
      settlements: [],
      lastNetCents: 0,
      message: 'Mise reprise. Pose un jeton pour relancer.',
    },
  }
}

function fmtChip(cents: number): string {
  const n = cents / 100
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

export type RollResult =
  | { ok: true; round: CrapsRound; creditCents: number }
  | { ok: false; error: string }

/**
 * Résout un lancer. La mise a déjà été débitée via placeBet.
 * creditCents = ce qu’on rend (mise+gain, ou mise seule en push).
 */
export function resolveRoll(round: CrapsRound, roll: DiceRoll): RollResult {
  if (round.bet <= 0) {
    return { ok: false, error: 'Pose d’abord une mise.' }
  }

  const settlements: SettlementLine[] = []
  let credit = 0
  let bet = round.bet
  let phase = round.phase
  let point = round.point
  let pointRolls = round.pointRolls
  let message = ''
  const total = roll.total
  const stake = bet

  if (phase === 'come_out') {
    if (comeOutWins(total)) {
      credit = winCreditCents(stake, MULT_COME_OUT)
      settlements.push({
        kind: 'come_out_win',
        amountCents: credit,
        label: `${total} direct — ×${MULT_COME_OUT}`,
      })
      bet = 0
      message = `${total} ! Tu gagnes ×${MULT_COME_OUT}.`
    } else if (comeOutLoses(total)) {
      settlements.push({
        kind: 'come_out_lose',
        amountCents: 0,
        label: `${total} — perdu`,
      })
      bet = 0
      message = `${total}… perdu. Remise pour réessayer.`
    } else if (isPointNumber(total)) {
      phase = 'point'
      point = total
      pointRolls = 0
      settlements.push({
        kind: 'point_set',
        amountCents: 0,
        label: `Cible ${total} — maintenant ça paie ×${MULT_POINT}`,
      })
      message = `Cible ${total} ! Refais un ${total} avant un 7 (×${MULT_POINT}). ${POINT_ROLLS_BEFORE_PUSH} jets max.`
    } else {
      message = `${total} — bizarre, on continue.`
    }
  } else {
    const p = point!
    pointRolls += 1
    if (total === p) {
      credit = winCreditCents(stake, MULT_POINT)
      settlements.push({
        kind: 'point_win',
        amountCents: credit,
        label: `Cible ${p} — ×${MULT_POINT}`,
      })
      bet = 0
      phase = 'come_out'
      point = null
      pointRolls = 0
      message = `Cible ${p} ! ×${MULT_POINT}.`
    } else if (total === 7) {
      settlements.push({
        kind: 'point_lose',
        amountCents: 0,
        label: '7 trop tôt — perdu',
      })
      bet = 0
      phase = 'come_out'
      point = null
      pointRolls = 0
      message = '7 trop tôt — perdu.'
    } else if (pointRolls >= POINT_ROLLS_BEFORE_PUSH) {
      credit = stake
      settlements.push({
        kind: 'point_push',
        amountCents: credit,
        label: `${POINT_ROLLS_BEFORE_PUSH} jets sans ${p} ni 7 — mise rendue`,
      })
      bet = 0
      phase = 'come_out'
      point = null
      pointRolls = 0
      message = `Rien en ${POINT_ROLLS_BEFORE_PUSH} jets — on te rend ta mise.`
    } else {
      const left = POINT_ROLLS_BEFORE_PUSH - pointRolls
      settlements.push({
        kind: 'point_continue',
        amountCents: 0,
        label: `${total}… encore ${left} jet${left > 1 ? 's' : ''}`,
      })
      message = `${total}… pas encore. Il faut ${p} (attention au 7). Encore ${left}.`
    }
  }

  const history = [...round.history, roll].slice(-12)

  return {
    ok: true,
    creditCents: credit,
    round: {
      phase,
      point,
      pointRolls,
      bet,
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

export function canRoll(round: CrapsRound): boolean {
  return round.bet > 0
}

/** Mise encore sur le feutre — recharge / sortie interdites (anti all-in + refill). */
export function crapsStakeOpen(round: CrapsRound): boolean {
  return round.bet > 0
}
