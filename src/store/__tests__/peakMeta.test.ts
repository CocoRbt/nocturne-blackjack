import { describe, expect, it } from 'vitest';
import { creditWithoutGame, formatGamesBeforePeak, settleGamePeak } from '../peakMeta';

describe('settleGamePeak', () => {
  it('fige les parties avant le record (15 avant la 16ᵉ)', () => {
    const next = settleGamePeak(900_00, 200_00, {
      peakBalance: 100_00,
      gamesPlayed: 15,
      gamesBeforePeak: 0,
    });
    expect(next.gamesPlayed).toBe(16);
    expect(next.balance).toBe(1_100_00);
    expect(next.peakBalance).toBe(1_100_00);
    expect(next.gamesBeforePeak).toBe(15);
  });

  it('ne touche pas gamesBeforePeak si le pic ne bouge pas', () => {
    const next = settleGamePeak(50_00, 0, {
      peakBalance: 200_00,
      gamesPlayed: 10,
      gamesBeforePeak: 7,
    });
    expect(next.gamesPlayed).toBe(11);
    expect(next.peakBalance).toBe(200_00);
    expect(next.gamesBeforePeak).toBe(7);
  });

  it('compte une défaite (payout 0) comme partie', () => {
    const next = settleGamePeak(80_00, 0, {
      peakBalance: 100_00,
      gamesPlayed: 3,
      gamesBeforePeak: 0,
    });
    expect(next.gamesPlayed).toBe(4);
    expect(next.balance).toBe(80_00);
    expect(next.gamesBeforePeak).toBe(0);
  });
});

describe('creditWithoutGame', () => {
  it('met à jour le pic sans incrémenter les parties', () => {
    const next = creditWithoutGame(90_00, 20_00, {
      peakBalance: 100_00,
      gamesPlayed: 5,
      gamesBeforePeak: 2,
    });
    expect(next.gamesPlayed).toBe(5);
    expect(next.peakBalance).toBe(110_00);
    expect(next.gamesBeforePeak).toBe(5);
  });
});

describe('formatGamesBeforePeak', () => {
  it('formule le libellé', () => {
    expect(formatGamesBeforePeak(0)).toBe('dès le départ');
    expect(formatGamesBeforePeak(1)).toBe('1 partie avant');
    expect(formatGamesBeforePeak(15)).toBe('15 parties avant');
  });
});
