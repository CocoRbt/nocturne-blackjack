/** Patrimoine cercle : solde jouable + coffre. */
export function wealthCents(balance: number, vault = 0): number {
  return Math.max(0, Math.floor(balance)) + Math.max(0, Math.floor(vault));
}

/** Record affiché : max(peak stocké, patrimoine actuel). */
export function peakWealthCents(peakBalance: number, balance: number, vault = 0): number {
  return Math.max(Math.max(0, Math.floor(peakBalance)), wealthCents(balance, vault));
}
