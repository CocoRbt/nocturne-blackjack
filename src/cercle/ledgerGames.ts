/**
 * Jeux migrés vers le ledger serveur (Phase 2b).
 * Les autres restent sur sync_my_score / debit-credit local.
 */

export const LEDGER_GAMES = {
  plinko: true,
  mines: true,
  crash: false,
  slots: false,
  craps: false,
  blackjack: false,
} as const;

export type LedgerGame = keyof typeof LEDGER_GAMES;

export function isGameOnLedger(game: LedgerGame): boolean {
  return LEDGER_GAMES[game] === true;
}
