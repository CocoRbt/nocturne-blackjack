import {
  defiById,
  pickDailyDefis,
  todayKey,
  type DefiDef,
  type DefiMetric,
} from './catalog'

const KEY = 'nocturne-defis-du-jour'

export interface DefiBaseline {
  handsPlayed: number
  wins: number
  blackjacks: number
  balance: number
}

export interface DefiDayState {
  day: string
  challengeIds: string[]
  /** Compteurs d’événements salon / gain. */
  counters: Partial<Record<DefiMetric, number>>
  baseline: DefiBaseline
  completed: string[]
}

export interface DefiView {
  def: DefiDef
  progress: number
  target: number
  done: boolean
  pct: number
}

function emptyCounters(): Partial<Record<DefiMetric, number>> {
  return {
    mines_rounds: 0,
    mines_cashouts: 0,
    mines_mult: 0,
    craps_pass_wins: 0,
    crash_cashouts: 0,
    crash_mult: 0,
    gain_cents: 0,
  }
}

function loadRaw(): DefiDayState | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw) as DefiDayState
  } catch {
    return null
  }
}

function save(state: DefiDayState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

export function ensureDefiDay(baseline: DefiBaseline, day = todayKey()): DefiDayState {
  const existing = loadRaw()
  if (existing && existing.day === day && existing.challengeIds.length > 0) {
    return existing
  }
  const challenges = pickDailyDefis(day)
  const next: DefiDayState = {
    day,
    challengeIds: challenges.map((c) => c.id),
    counters: emptyCounters(),
    baseline: { ...baseline },
    completed: [],
  }
  save(next)
  return next
}

export function loadDefiDay(): DefiDayState | null {
  return loadRaw()
}

function progressFor(
  def: DefiDef,
  state: DefiDayState,
  live: DefiBaseline,
): number {
  switch (def.metric) {
    case 'bj_hands':
      return Math.max(0, live.handsPlayed - state.baseline.handsPlayed)
    case 'bj_wins':
      return Math.max(0, live.wins - state.baseline.wins)
    case 'bj_blackjacks':
      return Math.max(0, live.blackjacks - state.baseline.blackjacks)
    case 'gain_cents':
      return Math.max(0, live.balance - state.baseline.balance, state.counters.gain_cents ?? 0)
    default:
      return state.counters[def.metric] ?? 0
  }
}

export function listDefiViews(live: DefiBaseline): DefiView[] {
  const state = ensureDefiDay(live)
  return state.challengeIds
    .map((id) => defiById(id))
    .filter((d): d is DefiDef => !!d)
    .map((def) => {
      const progress = Math.min(def.target, progressFor(def, state, live))
      const done = progress >= def.target || state.completed.includes(def.id)
      return {
        def,
        progress: done ? def.target : progress,
        target: def.target,
        done,
        pct: Math.min(100, Math.round((progress / def.target) * 100)),
      }
    })
}

/** Recalcule les complétions à partir des stats live + compteurs. */
export function syncDefiProgress(live: DefiBaseline): DefiDayState {
  const state = ensureDefiDay(live)
  // Suivi du meilleur gain net du jour (pic de crédit depuis baseline)
  const gain = Math.max(0, live.balance - state.baseline.balance)
  if (gain > (state.counters.gain_cents ?? 0)) {
    state.counters.gain_cents = gain
  }

  const completed = new Set(state.completed)
  for (const id of state.challengeIds) {
    const def = defiById(id)
    if (!def) continue
    if (progressFor(def, state, live) >= def.target) completed.add(id)
  }
  state.completed = [...completed]
  save(state)
  return state
}

export type DefiEvent =
  | { type: 'mines_start' }
  | { type: 'mines_cashout'; mult: number }
  | { type: 'craps_pass_win' }
  | { type: 'crash_cashout'; mult: number }

export function trackDefiEvent(event: DefiEvent, live: DefiBaseline): DefiDayState {
  const state = ensureDefiDay(live)
  const c = { ...emptyCounters(), ...state.counters }

  if (event.type === 'mines_start') {
    c.mines_rounds = (c.mines_rounds ?? 0) + 1
  } else if (event.type === 'mines_cashout') {
    c.mines_cashouts = (c.mines_cashouts ?? 0) + 1
    if (event.mult >= 2) c.mines_mult = (c.mines_mult ?? 0) + 1
  } else if (event.type === 'craps_pass_win') {
    c.craps_pass_wins = (c.craps_pass_wins ?? 0) + 1
  } else if (event.type === 'crash_cashout') {
    c.crash_cashouts = (c.crash_cashouts ?? 0) + 1
    if (event.mult >= 2) c.crash_mult = (c.crash_mult ?? 0) + 1
  }

  state.counters = c
  save(state)
  return syncDefiProgress(live)
}

export function completedCount(live: DefiBaseline): { done: number; total: number } {
  const views = listDefiViews(live)
  return { done: views.filter((v) => v.done).length, total: views.length }
}
