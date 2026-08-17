import { describe, expect, it } from 'vitest';
import { mergeRecordPeak, peakWealthCents, restoreWipedPlayable, sanitizeScoreForPush, wealthCents } from '../wealth';

describe('wealthCents', () => {
  it('additionne solde + coffre', () => {
    expect(wealthCents(10_000, 40_000_000)).toBe(40_010_000);
  });

  it('ignore les négatifs', () => {
    expect(wealthCents(-5, 100)).toBe(100);
  });
});

describe('peakWealthCents', () => {
  it('prend le max entre record et patrimoine actuel', () => {
    expect(peakWealthCents(50_000, 10_000, 80_000)).toBe(90_000);
    expect(peakWealthCents(200_000, 10_000, 5_000)).toBe(200_000);
  });
});

describe('mergeRecordPeak', () => {
  it('ne descend pas un record local 1M si le cloud est à 70k', () => {
    expect(mergeRecordPeak(1_000_000_00, 70_000_00, 50_000_00, 0)).toBe(1_000_000_00);
  });

  it('prend le cloud s’il est plus haut', () => {
    expect(mergeRecordPeak(70_000_00, 1_000_000_00, 10_000, 0)).toBe(1_000_000_00);
  });
});

describe('restoreWipedPlayable', () => {
  it('recolle 1,2 M si le solde a été mis à 0', () => {
    expect(restoreWipedPlayable(0, 0, 121_100_000)).toBe(121_100_000);
  });

  it('ne touche pas un solde déjà là', () => {
    expect(restoreWipedPlayable(50_000_00, 0, 121_100_000)).toBe(50_000_00);
  });

  it('ignore un tout petit record (sous le solde de départ)', () => {
    expect(restoreWipedPlayable(0, 0, 5_000)).toBe(0);
  });

  it('recolle 800 crédits si le solde a été mis à 0', () => {
    expect(restoreWipedPlayable(0, 0, 80_000)).toBe(80_000);
  });
});

describe('sanitizeScoreForPush', () => {
  it('envoie le pic et refuse un wipe à 0', () => {
    const next = sanitizeScoreForPush({
      balance: 0,
      vault: 0,
      peakBalance: 121_100_000,
      gamesPlayed: 10,
    });
    expect(next.balance).toBe(121_100_000);
    expect(next.peakBalance).toBe(121_100_000);
    expect(next.gamesPlayed).toBe(10);
  });

  it('garde 50 crédits live tels quels', () => {
    const next = sanitizeScoreForPush({
      balance: 50_00,
      vault: 0,
      peakBalance: 50_00,
    });
    expect(next.balance).toBe(50_00);
    expect(next.peakBalance).toBe(50_00);
  });
});
