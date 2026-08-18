import { describe, expect, it } from 'vitest';
import { isGameOnLedger, LEDGER_GAMES } from '../ledgerGames';

describe('ledgerGames', () => {
  it('Tous les jeux sont sur le ledger (Phase 2c)', () => {
    expect(isGameOnLedger('plinko')).toBe(true);
    expect(isGameOnLedger('mines')).toBe(true);
    expect(isGameOnLedger('crash')).toBe(true);
    expect(isGameOnLedger('slots')).toBe(true);
    expect(isGameOnLedger('craps')).toBe(true);
    expect(isGameOnLedger('blackjack')).toBe(true);
    expect(LEDGER_GAMES.blackjack).toBe(true);
  });
});
