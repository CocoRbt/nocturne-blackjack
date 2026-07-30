/** Math Mines — RTP 99 %, grille 25, formule type Stake. */

export const MINES_GRID = 25;
export const MINES_RTP = 0.99;
export const MINES_MIN = 1;
export const MINES_MAX = 24;

/** Multiplicateur après `revealed` diamants avec `mines` bombes. */
export function minesMultiplier(revealed: number, mines: number, tiles = MINES_GRID, rtp = MINES_RTP): number {
  if (revealed <= 0) return 1;
  if (mines < MINES_MIN || mines > tiles - 1) return 0;
  const maxSafe = tiles - mines;
  if (revealed > maxSafe) return 0;

  let acc = 1;
  for (let i = 0; i < revealed; i++) {
    acc *= (tiles - i) / (tiles - mines - i);
  }
  return Math.floor(acc * rtp * 100 + 1e-9) / 100;
}

/** Multiplicateur si le prochain clic est un diamant. */
export function nextTileMultiplier(revealed: number, mines: number, tiles = MINES_GRID): number {
  return minesMultiplier(revealed + 1, mines, tiles);
}

/** Probabilité de survie jusqu’à `revealed` diamants. */
export function survivalChance(revealed: number, mines: number, tiles = MINES_GRID): number {
  if (revealed <= 0) return 1;
  const maxSafe = tiles - mines;
  if (revealed > maxSafe) return 0;
  let p = 1;
  for (let i = 0; i < revealed; i++) {
    p *= (tiles - mines - i) / (tiles - i);
  }
  return p;
}

export function maxSafeTiles(mines: number, tiles = MINES_GRID): number {
  return tiles - mines;
}

export function payoutCents(bet: number, multiplier: number): number {
  return Math.floor(bet * multiplier + 1e-9);
}
