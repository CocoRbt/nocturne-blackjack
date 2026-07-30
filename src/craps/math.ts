/** Point numbers established on the come-out. */
export const POINT_NUMBERS = [4, 5, 6, 8, 9, 10] as const
export type PointNumber = (typeof POINT_NUMBERS)[number]

export function isPointNumber(n: number): n is PointNumber {
  return (POINT_NUMBERS as readonly number[]).includes(n)
}

/** True odds payout multiplier on odds stake (win amount = stake * multiplier). */
export function trueOddsMultiplier(point: PointNumber): number {
  if (point === 4 || point === 10) return 2
  if (point === 5 || point === 9) return 3 / 2
  return 6 / 5 // 6 or 8
}

/** Max odds as multiple of pass line stake (common 3-4-5× table). */
export function maxOddsMultiple(point: PointNumber): number {
  if (point === 4 || point === 10) return 3
  if (point === 5 || point === 9) return 4
  return 5
}

export function maxOddsCents(passCents: number, point: PointNumber): number {
  return Math.floor(passCents * maxOddsMultiple(point))
}

/** Win amount (profit) for a winning odds bet. */
export function oddsWinCents(oddsStake: number, point: PointNumber): number {
  const m = trueOddsMultiplier(point)
  return Math.floor(oddsStake * m)
}

/** Field: 2 pays 2:1, 12 pays 3:1, 3/4/9/10/11 pay 1:1. Profit only. */
export function fieldWinCents(stake: number, total: number): number {
  if (total === 2) return stake * 2
  if (total === 12) return stake * 3
  if (total === 3 || total === 4 || total === 9 || total === 10 || total === 11) return stake
  return 0
}

export function fieldWins(total: number): boolean {
  return total === 2 || total === 3 || total === 4 || total === 9 || total === 10 || total === 11 || total === 12
}
