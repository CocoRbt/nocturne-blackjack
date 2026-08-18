import { describe, expect, it } from 'vitest';
import { isGameOnLedger, LEDGER_GAMES } from '../ledgerGames';

describe('ledgerGames', () => {
  it('Plinko et Mines sont sur le ledger ; le reste reste legacy', () => {
    expect(isGameOnLedger('plinko')).toBe(true);
    expect(isGameOnLedger('mines')).toBe(true);
    expect(isGameOnLedger('crash')).toBe(false);
    expect(isGameOnLedger('slots')).toBe(false);
    expect(isGameOnLedger('craps')).toBe(false);
    expect(isGameOnLedger('blackjack')).toBe(false);
    expect(LEDGER_GAMES.blackjack).toBe(false);
  });
});
