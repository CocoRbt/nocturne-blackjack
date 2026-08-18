import { describe, expect, it } from 'vitest';
import { walletFromLedger } from '../ledgerApi';

describe('walletFromLedger', () => {
  it('mappe le JSON serveur vers le store', () => {
    expect(
      walletFromLedger({
        balance: 9500,
        vault: 200,
        peak_balance: 10000,
        games_played: 3,
        games_before_peak: 2,
      }),
    ).toEqual({
      balance: 9500,
      vault: 200,
      peakBalance: 10000,
      gamesPlayed: 3,
      gamesBeforePeak: 2,
    });
  });
});
