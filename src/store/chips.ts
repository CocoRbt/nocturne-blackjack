/** Dénominations de jetons disponibles (centimes), du plus petit au plus grand. */
export const ALL_CHIP_DENOMS = [
  1_00,
  5_00,
  25_00,
  100_00,
  500_00,
  1_000_00,
  5_000_00,
  10_000_00,
  25_000_00,
] as const;

export type ChipDenom = (typeof ALL_CHIP_DENOMS)[number];

/**
 * Plateau de jetons adapté aux limites de la table.
 * Inclut les denoms entre minBet et maxBet, plus le plus petit ≥ minBet
 * et le plus grand ≤ maxBet pour toujours pouvoir viser les bornes.
 */
export function chipsForLimits(minBet: number, maxBet: number): number[] {
  const filtered = ALL_CHIP_DENOMS.filter((d) => d >= minBet && d <= maxBet);
  if (filtered.length > 0) return [...filtered];

  // Fallback : plus proche sous max, ou min de la grille.
  const under = [...ALL_CHIP_DENOMS].reverse().find((d) => d <= maxBet);
  return [under ?? ALL_CHIP_DENOMS[0]];
}

export function defaultChipForLimits(minBet: number, maxBet: number): number {
  const chips = chipsForLimits(minBet, maxBet);
  return chips.find((d) => d >= minBet) ?? chips[0];
}

export function decomposeAmount(amount: number, denoms: readonly number[] = ALL_CHIP_DENOMS): number[] {
  const chips: number[] = [];
  let rest = amount;
  const sorted = [...denoms].sort((a, b) => b - a);
  for (const d of sorted) {
    while (rest >= d) {
      chips.push(d);
      rest -= d;
    }
  }
  if (rest > 0 && sorted.length > 0) {
    // Reliquat non représentable : empile en plus petites unités si possible.
    const smallest = [...denoms].sort((a, b) => a - b)[0];
    while (rest >= smallest) {
      chips.push(smallest);
      rest -= smallest;
    }
  }
  return chips;
}
