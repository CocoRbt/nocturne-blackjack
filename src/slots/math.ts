/**
 * STAMPEDE — math 5×4 / 1024 ways (inspiration Buffalo, IP-safe).
 * Toutes les valeurs en multiplicateurs du total bet (mise spin).
 */

import { cryptoRng, type Rng } from '../engine/rng';

export const SLOT_REELS = 5 as const;
export const SLOT_ROWS = 4 as const;
export const SLOT_WAYS = 1024 as const; // 4^5

export type SlotSymbol =
  | 'bison'
  | 'eagle'
  | 'cougar'
  | 'wolf'
  | 'elk'
  | 'A'
  | 'K'
  | 'Q'
  | 'J'
  | 'wild'
  | 'scatter';

export type PaySymbol = Exclude<SlotSymbol, 'wild' | 'scatter'>;

/** Gains en « crédits » pour 1 way — divisés par SLOT_WAYS pour le mult bet. */
export const WAY_PAY: Record<PaySymbol, { 3: number; 4: number; 5: number }> = {
  bison: { 3: 60, 4: 240, 5: 650 },
  eagle: { 3: 45, 4: 170, 5: 450 },
  cougar: { 3: 36, 4: 140, 5: 360 },
  wolf: { 3: 28, 4: 110, 5: 280 },
  elk: { 3: 24, 4: 90, 5: 230 },
  A: { 3: 18, 4: 65, 5: 160 },
  K: { 3: 15, 4: 55, 5: 140 },
  Q: { 3: 12, 4: 45, 5: 115 },
  J: { 3: 10, 4: 38, 5: 95 },
};

/** Scatter : payout × bet (anywhere), en plus du trigger FS. */
export const SCATTER_PAY: Record<3 | 4 | 5, number> = {
  3: 1.2,
  4: 5,
  5: 20,
};

export const FREE_SPINS_AWARD: Record<3 | 4 | 5, number> = {
  3: 8,
  4: 15,
  5: 20,
};

export const FREE_SPINS_RETRIGGER = 5;
/** Seuil minimum de scatters pour retrigger en FS. */
export const FREE_SPINS_RETRIGGER_MIN = 2;

/** Compteur troupeau : multiplicateur progressif sur les gains ways (pas de transform pay). */
export const HERD_MULT_THRESHOLDS = [
  { at: 4, mult: 1.5 },
  { at: 7, mult: 2 },
  { at: 13, mult: 2.5 },
  { at: 15, mult: 3 },
] as const;

/** Seuils d’upgrade cosmétique (UI) — les animaux « deviennent » bisons visuellement. */
export const HERD_THRESHOLDS = [
  { at: 4, turns: 'eagle' as PaySymbol },
  { at: 7, turns: 'cougar' as PaySymbol },
  { at: 13, turns: 'wolf' as PaySymbol },
  { at: 15, turns: 'elk' as PaySymbol },
] as const;

export function herdWinMultiplier(heads: number): number {
  let m = 1;
  for (const t of HERD_MULT_THRESHOLDS) {
    if (heads >= t.at) m = t.mult;
  }
  return m;
}

/** Bandes de rouleaux (base) — fréquences calibrées pour ~96–97 % RTP. */
export const BASE_STRIPS: readonly (readonly SlotSymbol[])[] = [
  // Reel 1 — pas de wild (classique ways)
  [
    'bison', 'J', 'eagle', 'Q', 'wolf', 'K', 'cougar', 'A', 'elk', 'J',
    'scatter', 'Q', 'wolf', 'K', 'eagle', 'A', 'bison', 'J', 'cougar', 'Q',
    'elk', 'K', 'wolf', 'A', 'eagle', 'J', 'Q', 'cougar', 'K', 'bison',
    'A', 'elk', 'J', 'wolf', 'Q', 'eagle', 'K', 'cougar', 'A', 'J',
  ],
  // Reel 2
  [
    'wild', 'J', 'eagle', 'Q', 'wolf', 'K', 'bison', 'A', 'elk', 'J',
    'cougar', 'Q', 'scatter', 'K', 'eagle', 'A', 'wolf', 'J', 'bison', 'Q',
    'elk', 'K', 'cougar', 'A', 'wild', 'J', 'eagle', 'Q', 'wolf', 'K',
    'A', 'elk', 'J', 'bison', 'Q', 'cougar', 'K', 'eagle', 'A', 'J',
  ],
  // Reel 3
  [
    'J', 'wild', 'eagle', 'Q', 'bison', 'K', 'wolf', 'A', 'elk', 'J',
    'cougar', 'Q', 'eagle', 'K', 'scatter', 'A', 'wolf', 'J', 'bison', 'Q',
    'wild', 'K', 'elk', 'A', 'cougar', 'J', 'eagle', 'Q', 'wolf', 'K',
    'bison', 'A', 'J', 'elk', 'Q', 'cougar', 'K', 'eagle', 'A', 'J',
  ],
  // Reel 4
  [
    'J', 'eagle', 'wild', 'Q', 'wolf', 'K', 'bison', 'A', 'elk', 'J',
    'cougar', 'Q', 'eagle', 'K', 'wolf', 'A', 'scatter', 'J', 'bison', 'Q',
    'elk', 'K', 'wild', 'A', 'cougar', 'J', 'eagle', 'Q', 'wolf', 'K',
    'A', 'bison', 'J', 'elk', 'Q', 'cougar', 'K', 'eagle', 'A', 'J',
  ],
  // Reel 5
  [
    'J', 'eagle', 'Q', 'wolf', 'K', 'bison', 'A', 'elk', 'J', 'cougar',
    'Q', 'eagle', 'K', 'wolf', 'A', 'bison', 'J', 'scatter', 'Q', 'elk',
    'K', 'cougar', 'A', 'eagle', 'J', 'wolf', 'Q', 'bison', 'K', 'elk',
    'A', 'cougar', 'J', 'eagle', 'Q', 'wolf', 'K', 'A', 'J', 'elk',
  ],
];

/** Bandes FS : légèrement plus riches, sans saturation bison/wild. */
export const FREE_STRIPS: readonly (readonly SlotSymbol[])[] = [
  [
    'bison', 'J', 'eagle', 'Q', 'wolf', 'K', 'cougar', 'A', 'elk', 'J',
    'wolf', 'Q', 'bison', 'K', 'eagle', 'A', 'J', 'cougar', 'Q', 'elk',
    'K', 'wolf', 'A', 'eagle', 'J', 'Q', 'cougar', 'K', 'bison', 'A',
    'elk', 'J', 'wolf', 'Q', 'eagle', 'K', 'A', 'J', 'cougar', 'Q',
  ],
  [
    'wild', 'J', 'eagle', 'Q', 'wolf', 'K', 'bison', 'A', 'elk', 'J',
    'cougar', 'Q', 'eagle', 'K', 'bison', 'A', 'wolf', 'J', 'Q', 'elk',
    'K', 'cougar', 'A', 'bison', 'J', 'eagle', 'Q', 'wolf', 'K', 'A',
    'elk', 'J', 'bison', 'Q', 'cougar', 'K', 'eagle', 'A', 'J', 'wolf',
  ],
  [
    'J', 'wild', 'eagle', 'Q', 'bison', 'K', 'wolf', 'A', 'elk', 'J',
    'cougar', 'Q', 'eagle', 'K', 'A', 'wolf', 'J', 'bison', 'Q', 'elk',
    'K', 'cougar', 'A', 'eagle', 'J', 'Q', 'wolf', 'K', 'bison', 'A',
    'J', 'elk', 'Q', 'cougar', 'K', 'eagle', 'A', 'J', 'wolf', 'Q',
  ],
  [
    'J', 'eagle', 'wild', 'Q', 'wolf', 'K', 'bison', 'A', 'elk', 'J',
    'cougar', 'Q', 'eagle', 'K', 'A', 'wolf', 'J', 'bison', 'Q', 'elk',
    'K', 'A', 'cougar', 'J', 'eagle', 'Q', 'wolf', 'K', 'A', 'bison',
    'J', 'elk', 'Q', 'cougar', 'K', 'eagle', 'A', 'J', 'wolf', 'Q',
  ],
  [
    'J', 'eagle', 'Q', 'wolf', 'K', 'bison', 'A', 'elk', 'J', 'cougar',
    'Q', 'eagle', 'K', 'wolf', 'A', 'bison', 'J', 'Q', 'elk', 'K',
    'cougar', 'A', 'eagle', 'J', 'wolf', 'Q', 'bison', 'K', 'elk', 'A',
    'cougar', 'J', 'eagle', 'Q', 'wolf', 'K', 'A', 'J', 'elk', 'Q',
  ],
];

export const SYMBOL_LABEL: Record<SlotSymbol, string> = {
  bison: 'Bison',
  eagle: 'Aigle',
  cougar: 'Puma',
  wolf: 'Loup',
  elk: 'Élan',
  A: 'A',
  K: 'K',
  Q: 'Q',
  J: 'J',
  wild: 'Crépuscule',
  scatter: 'Médaille',
};

export function payoutCents(bet: number, multiplier: number): number {
  if (bet <= 0 || multiplier <= 0) return 0;
  return Math.floor(bet * multiplier);
}

export function isPaySymbol(s: SlotSymbol): s is PaySymbol {
  return s !== 'wild' && s !== 'scatter';
}

/** Grille [reel][row] depuis stops (index haut de fenêtre). */
export function gridFromStops(
  strips: readonly (readonly SlotSymbol[])[],
  stops: readonly number[],
): SlotSymbol[][] {
  return strips.map((strip, r) => {
    const stop = ((stops[r] ?? 0) % strip.length + strip.length) % strip.length;
    const col: SlotSymbol[] = [];
    for (let row = 0; row < SLOT_ROWS; row++) {
      col.push(strip[(stop + row) % strip.length]!);
    }
    return col;
  });
}

export function countScatter(grid: readonly (readonly SlotSymbol[])[]): number {
  let n = 0;
  for (const col of grid) for (const s of col) if (s === 'scatter') n += 1;
  return n;
}

export function countBison(grid: readonly (readonly SlotSymbol[])[]): number {
  let n = 0;
  for (const col of grid) for (const s of col) if (s === 'bison') n += 1;
  return n;
}

/** Animaux transformés en bison selon le compteur troupeau. */
export function herdTransformed(heads: number): Set<PaySymbol> {
  const out = new Set<PaySymbol>();
  for (const t of HERD_THRESHOLDS) {
    if (heads >= t.at) out.add(t.turns);
  }
  return out;
}

export function applyHerdTransform(
  grid: readonly (readonly SlotSymbol[])[],
  heads: number,
): SlotSymbol[][] {
  const turns = herdTransformed(heads);
  if (turns.size === 0) return grid.map((c) => [...c]);
  return grid.map((col) =>
    col.map((s) => (isPaySymbol(s) && turns.has(s) ? 'bison' : s)),
  );
}

export type WayWin = {
  symbol: PaySymbol;
  length: 3 | 4 | 5;
  ways: number;
  multiplier: number;
};

/**
 * Évalue les 1024 ways : chaque chemin (1 case / rouleau) paie au plus
 * une combinaison (symbole concret + wilds). Pas de double-comptage.
 */
export function evaluateWays(grid: readonly (readonly SlotSymbol[])[]): WayWin[] {
  const agg = new Map<string, WayWin>();

  const rows = SLOT_ROWS;
  for (let a = 0; a < rows; a++) {
    for (let b = 0; b < rows; b++) {
      for (let c = 0; c < rows; c++) {
        for (let d = 0; d < rows; d++) {
          for (let e = 0; e < rows; e++) {
            const cells: SlotSymbol[] = [
              grid[0]![a]!,
              grid[1]![b]!,
              grid[2]![c]!,
              grid[3]![d]!,
              grid[4]![e]!,
            ];
            let paySym: PaySymbol | null = null;
            let length = 0;
            for (const cell of cells) {
              if (cell === 'scatter') break;
              if (cell === 'wild') {
                length += 1;
                continue;
              }
              if (!isPaySymbol(cell)) break;
              if (paySym == null) {
                paySym = cell;
                length += 1;
                continue;
              }
              if (cell !== paySym) break;
              length += 1;
            }
            if (!paySym || length < 3) continue;
            const len = Math.min(length, 5) as 3 | 4 | 5;
            const key = `${paySym}:${len}`;
            const prev = agg.get(key);
            if (prev) {
              prev.ways += 1;
              prev.multiplier = (WAY_PAY[paySym][len] * prev.ways) / SLOT_WAYS;
            } else {
              agg.set(key, {
                symbol: paySym,
                length: len,
                ways: 1,
                multiplier: WAY_PAY[paySym][len] / SLOT_WAYS,
              });
            }
          }
        }
      }
    }
  }

  return [...agg.values()];
}

export function waysMultiplier(wins: readonly WayWin[]): number {
  return wins.reduce((s, w) => s + w.multiplier, 0);
}

export function scatterMultiplier(count: number): number {
  if (count >= 5) return SCATTER_PAY[5];
  if (count >= 4) return SCATTER_PAY[4];
  if (count >= 3) return SCATTER_PAY[3];
  return 0;
}

export function freeSpinsAwarded(scatterCount: number): number {
  if (scatterCount >= 5) return FREE_SPINS_AWARD[5];
  if (scatterCount >= 4) return FREE_SPINS_AWARD[4];
  if (scatterCount >= 3) return FREE_SPINS_AWARD[3];
  return 0;
}

/** Multiplicateurs wild en FS : 2× ou 3×, au plus 2 wilds dans le produit. */
export function rollWildMultipliers(
  grid: readonly (readonly SlotSymbol[])[],
  rng: Rng,
): number[] {
  const mults: number[] = [];
  for (const col of grid) {
    for (const s of col) {
      if (s === 'wild') mults.push(rng() < 0.65 ? 2 : 3);
    }
  }
  return mults.slice(0, 2);
}

export function product(nums: readonly number[]): number {
  if (nums.length === 0) return 1;
  return Math.min(
    9,
    nums.reduce((a, b) => a * b, 1),
  );
}

export function pickStops(
  strips: readonly (readonly SlotSymbol[])[],
  rng: Rng = cryptoRng(),
): number[] {
  return strips.map((strip) => Math.floor(rng() * strip.length));
}

export type SpinEval = {
  grid: SlotSymbol[][];
  wayWins: WayWin[];
  waysMult: number;
  scatterCount: number;
  scatterMult: number;
  wildMults: number[];
  wildProduct: number;
  /** Multiplicateur total (ways × wildProduct + scatter). */
  totalMult: number;
  freeSpins: number;
  bisonLanded: number;
};

export function evaluateSpin(
  gridIn: readonly (readonly SlotSymbol[])[],
  opts: {
    freeSpinMode: boolean;
    herdHeads: number;
    rng?: Rng;
  },
): SpinEval {
  const rng = opts.rng ?? cryptoRng();
  const bisonLanded = countBison(gridIn);
  const headsAfter = opts.freeSpinMode ? opts.herdHeads + bisonLanded : opts.herdHeads;
  // Pay sur la grille réelle ; transform troupeau = cosmétique UI seulement.
  const grid = gridIn.map((c) => [...c]);
  const displayGrid = opts.freeSpinMode
    ? applyHerdTransform(gridIn, headsAfter)
    : grid;

  const wayWins = evaluateWays(grid);
  const waysMult = waysMultiplier(wayWins);
  const scatterCount = countScatter(gridIn);
  const scatterMult = scatterMultiplier(scatterCount);

  let wildMults: number[] = [];
  let wildProduct = 1;
  let herdMult = 1;
  if (opts.freeSpinMode) {
    wildMults = rollWildMultipliers(gridIn, rng);
    wildProduct = product(wildMults);
    herdMult = herdWinMultiplier(headsAfter);
  }

  const totalMult = waysMult * wildProduct * herdMult + scatterMult;
  let freeSpins = 0;
  if (!opts.freeSpinMode) {
    freeSpins = freeSpinsAwarded(scatterCount);
  } else if (scatterCount >= FREE_SPINS_RETRIGGER_MIN) {
    freeSpins = FREE_SPINS_RETRIGGER;
  }

  return {
    grid: displayGrid,
    wayWins,
    waysMult,
    scatterCount,
    scatterMult,
    wildMults,
    wildProduct,
    totalMult,
    freeSpins,
    bisonLanded,
  };
}

/** Simulation RTP base game seule (sans valoriser le bonus FS). */
export function simulateBaseRtp(spins: number, rng: Rng = cryptoRng()): number {
  let spent = 0;
  let won = 0;
  const bet = 100;
  for (let i = 0; i < spins; i++) {
    spent += bet;
    const stops = pickStops(BASE_STRIPS, rng);
    const grid = gridFromStops(BASE_STRIPS, stops);
    const ev = evaluateSpin(grid, { freeSpinMode: false, herdHeads: 0, rng });
    won += payoutCents(bet, ev.totalMult);
  }
  return won / spent;
}

/**
 * Simulation RTP complète (base + free spins joués).
 * Une « session spin » = 1 mise base ; les FS ne re-débitent pas.
 */
export function simulateFullRtp(spins: number, rng: Rng = cryptoRng()): number {
  let spent = 0;
  let won = 0;
  const bet = 100;

  for (let i = 0; i < spins; i++) {
    spent += bet;
    const stops = pickStops(BASE_STRIPS, rng);
    const grid = gridFromStops(BASE_STRIPS, stops);
    const base = evaluateSpin(grid, { freeSpinMode: false, herdHeads: 0, rng });
    won += payoutCents(bet, base.totalMult);

    let remaining = base.freeSpins;
    let herd = 0;
    let guard = 0;
    while (remaining > 0 && guard < 500) {
      guard += 1;
      remaining -= 1;
      const fsStops = pickStops(FREE_STRIPS, rng);
      const fsGrid = gridFromStops(FREE_STRIPS, fsStops);
      const fs = evaluateSpin(fsGrid, {
        freeSpinMode: true,
        herdHeads: herd,
        rng,
      });
      herd += fs.bisonLanded;
      won += payoutCents(bet, fs.totalMult);
      remaining += fs.freeSpins;
    }
  }
  return won / spent;
}
