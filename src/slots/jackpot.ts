import { countStars, jackpotTierFromStars, type SlotSymbol } from './math'

export type JackpotTier = 'mini' | 'major' | 'grand'

export type CircleJackpotState = {
  miniCents: number
  majorCents: number
  grandCents: number
}

export type JackpotHitRecord = {
  id: string
  tier: JackpotTier
  amountCents: number
  playerName: string
  createdAt: string
}

/** Seeds en centimes (= unités solde) : 1 000 / 5 000 / 15 000 crédits. */
export const JACKPOT_SEEDS_CENTS: Record<JackpotTier, number> = {
  mini: 100_000,
  major: 500_000,
  grand: 1_500_000,
}

/** Parts de contribution sur la mise de base (total 1 %). */
export const JACKPOT_CONTRIB_BPS: Record<JackpotTier, number> = {
  mini: 50, // 0,5 %
  major: 30, // 0,3 %
  grand: 20, // 0,2 %
}

const LOCAL_KEY = 'nocturne.stampede.jackpots.v1'

export function emptyJackpots(): CircleJackpotState {
  return {
    miniCents: JACKPOT_SEEDS_CENTS.mini,
    majorCents: JACKPOT_SEEDS_CENTS.major,
    grandCents: JACKPOT_SEEDS_CENTS.grand,
  }
}

/** Aligné sur le SQL : greatest(1, bet * bps / 10000). */
export function contribPartsCents(betCents: number): CircleJackpotState {
  const bet = Math.max(0, Math.floor(betCents))
  const part = (bps: number) => Math.max(1, Math.floor((bet * bps) / 10_000))
  if (bet <= 0) {
    return { miniCents: 0, majorCents: 0, grandCents: 0 }
  }
  return {
    miniCents: part(JACKPOT_CONTRIB_BPS.mini),
    majorCents: part(JACKPOT_CONTRIB_BPS.major),
    grandCents: part(JACKPOT_CONTRIB_BPS.grand),
  }
}

export function countJackpotStars(grid: readonly (readonly SlotSymbol[])[]): number {
  return countStars(grid)
}

/** Plus haut tier uniquement : 5=grand, 4=major, 3=mini. */
export function jackpotTierFromStarCount(starCount: number): JackpotTier | null {
  return jackpotTierFromStars(starCount)
}

export function jackpotLabel(tier: JackpotTier): string {
  if (tier === 'grand') return 'Grand'
  if (tier === 'major') return 'Major'
  return 'Mini'
}

export function loadLocalJackpots(): CircleJackpotState {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return emptyJackpots()
    const j = JSON.parse(raw) as Partial<CircleJackpotState>
    return {
      miniCents: Math.max(JACKPOT_SEEDS_CENTS.mini, Math.floor(Number(j.miniCents) || 0)),
      majorCents: Math.max(JACKPOT_SEEDS_CENTS.major, Math.floor(Number(j.majorCents) || 0)),
      grandCents: Math.max(JACKPOT_SEEDS_CENTS.grand, Math.floor(Number(j.grandCents) || 0)),
    }
  } catch {
    return emptyJackpots()
  }
}

export function saveLocalJackpots(state: CircleJackpotState): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

export function localContribute(betCents: number): CircleJackpotState {
  const cur = loadLocalJackpots()
  const parts = contribPartsCents(betCents)
  const next = {
    miniCents: cur.miniCents + parts.miniCents,
    majorCents: cur.majorCents + parts.majorCents,
    grandCents: cur.grandCents + parts.grandCents,
  }
  saveLocalJackpots(next)
  return next
}

export function localClaim(tier: JackpotTier): { amountCents: number; pots: CircleJackpotState } {
  const cur = loadLocalJackpots()
  const amountCents =
    tier === 'grand' ? cur.grandCents : tier === 'major' ? cur.majorCents : cur.miniCents
  const next = { ...cur }
  if (tier === 'grand') next.grandCents = JACKPOT_SEEDS_CENTS.grand
  else if (tier === 'major') next.majorCents = JACKPOT_SEEDS_CENTS.major
  else next.miniCents = JACKPOT_SEEDS_CENTS.mini
  saveLocalJackpots(next)
  return { amountCents, pots: next }
}
