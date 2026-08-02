/** Cibles possibles après le 1er lancer (Street Craps / GWYF). */
export const POINT_NUMBERS = [4, 5, 6, 8, 9, 10] as const
export type PointNumber = (typeof POINT_NUMBERS)[number]

export function isPointNumber(n: number): n is PointNumber {
  return (POINT_NUMBERS as readonly number[]).includes(n)
}

/** Premier lancer : gagne tout de suite. */
export const COME_OUT_WINS = [7, 11] as const
/** Premier lancer : perd tout de suite. */
export const COME_OUT_LOSES = [2, 3, 12] as const

/**
 * Multiplicateurs GWYF (retour total = mise × mult) :
 * ×2 avant la cible, ×4 une fois la cible fixée.
 */
export const MULT_COME_OUT = 2
export const MULT_POINT = 4

/**
 * En phase cible : après tant de jets ni gagnants ni perdants → remboursement.
 * Aligné sur le feeling GWYF (« souvent remboursé ») + Street Dice à 3 jets.
 */
export const POINT_ROLLS_BEFORE_PUSH = 3

export function comeOutWins(total: number): boolean {
  return (COME_OUT_WINS as readonly number[]).includes(total)
}

export function comeOutLoses(total: number): boolean {
  return (COME_OUT_LOSES as readonly number[]).includes(total)
}

/** Crédit total (mise + gain) pour un win à multiplicateur M. */
export function winCreditCents(stakeCents: number, mult: number): number {
  return Math.floor(stakeCents * mult)
}
