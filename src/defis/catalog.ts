/** Catalogue des défis du jour — sélection déterministe par date. */

export type DefiGame = 'blackjack' | 'mines' | 'craps' | 'crash' | 'plinko' | 'global'

export type DefiMetric =
  | 'bj_hands'
  | 'bj_wins'
  | 'bj_blackjacks'
  | 'mines_rounds'
  | 'mines_cashouts'
  | 'mines_mult'
  | 'craps_pass_wins'
  | 'crash_cashouts'
  | 'crash_mult'
  | 'plinko_rounds'
  | 'plinko_mult'
  | 'gain_cents'

export interface DefiDef {
  id: string
  title: string
  description: string
  game: DefiGame
  metric: DefiMetric
  target: number
  /** Pour mines_mult / crash_mult / plinko_mult : seuil multiplicateur. */
  threshold?: number
  /** Récompense en centimes à la complétion (défaut 5 crédits). */
  rewardCents?: number
}

/** Récompense standard par défi. */
export const DEFI_REWARD_CENTS = 5_00
/** Bonus si les 3 défis du jour sont faits. */
export const DEFI_FULL_CLEAR_BONUS_CENTS = 15_00

export function defiRewardCents(def: DefiDef): number {
  return def.rewardCents ?? DEFI_REWARD_CENTS
}

export const DEFI_CATALOG: DefiDef[] = [
  {
    id: 'bj_hands_8',
    title: 'Main sur main',
    description: 'Joue 8 mains au blackjack',
    game: 'blackjack',
    metric: 'bj_hands',
    target: 8,
  },
  {
    id: 'bj_wins_4',
    title: 'La table tourne',
    description: 'Gagne 4 mains au blackjack',
    game: 'blackjack',
    metric: 'bj_wins',
    target: 4,
  },
  {
    id: 'bj_bj_2',
    title: 'Naturel',
    description: 'Réalise 2 blackjacks',
    game: 'blackjack',
    metric: 'bj_blackjacks',
    target: 2,
  },
  {
    id: 'mines_rounds_3',
    title: 'Sous le salon',
    description: 'Lance 3 manches de Mines',
    game: 'mines',
    metric: 'mines_rounds',
    target: 3,
  },
  {
    id: 'mines_cash_2',
    title: 'Diamants en poche',
    description: 'Encaisse 2 fois aux Mines',
    game: 'mines',
    metric: 'mines_cashouts',
    target: 2,
  },
  {
    id: 'mines_mult_2',
    title: 'Risque calculé',
    description: 'Encaisse aux Mines à 2× ou plus',
    game: 'mines',
    metric: 'mines_mult',
    target: 1,
    threshold: 2,
  },
  {
    id: 'craps_pass_2',
    title: 'Sur Gagner',
    description: 'Gagne 2 fois avec la case Gagner',
    game: 'craps',
    metric: 'craps_pass_wins',
    target: 2,
  },
  {
    id: 'crash_cash_3',
    title: 'Parachute',
    description: 'Encaisse 3 fois au Crash',
    game: 'crash',
    metric: 'crash_cashouts',
    target: 3,
  },
  {
    id: 'crash_mult_2',
    title: 'Décollage réussi',
    description: 'Encaisse au Crash à 2× ou plus',
    game: 'crash',
    metric: 'crash_mult',
    target: 1,
    threshold: 2,
  },
  {
    id: 'plinko_rounds_5',
    title: 'Pluie de billes',
    description: 'Lance 5 drops au Plinko',
    game: 'plinko',
    metric: 'plinko_rounds',
    target: 5,
  },
  {
    id: 'plinko_mult_5',
    title: 'Slot doré',
    description: 'Atterris au Plinko à 5× ou plus',
    game: 'plinko',
    metric: 'plinko_mult',
    target: 1,
    threshold: 5,
  },
  {
    id: 'gain_25',
    title: 'Bonne soirée',
    description: 'Gagne +25 de crédit aujourd’hui',
    game: 'global',
    metric: 'gain_cents',
    target: 25_00,
  },
  {
    id: 'gain_50',
    title: 'Nuit en or',
    description: 'Gagne +50 de crédit aujourd’hui',
    game: 'global',
    metric: 'gain_cents',
    target: 50_00,
  },
]

/** Jour civil local YYYY-MM-DD. */
export function todayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function hashDay(day: string): number {
  let h = 2166136261
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Tire 3 défis du jour, en mélangeant les jeux si possible. */
export function pickDailyDefis(day: string, count = 3): DefiDef[] {
  const seed = hashDay(day)
  const pool = [...DEFI_CATALOG]
  // Shuffle déterministe
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (seed + i * 97) % (i + 1)
    ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
  }

  const picked: DefiDef[] = []
  const usedGames = new Set<DefiGame>()

  // Priorité : jeux distincts
  for (const d of pool) {
    if (picked.length >= count) break
    if (usedGames.has(d.game) && d.game !== 'global') continue
    picked.push(d)
    usedGames.add(d.game)
  }
  // Compléter si besoin
  for (const d of pool) {
    if (picked.length >= count) break
    if (picked.some((p) => p.id === d.id)) continue
    picked.push(d)
  }
  return picked.slice(0, count)
}

export function defiById(id: string): DefiDef | undefined {
  return DEFI_CATALOG.find((d) => d.id === id)
}
