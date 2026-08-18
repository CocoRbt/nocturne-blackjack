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
  it('ne recolle jamais un solde depuis le record (Phase 2a)', () => {
    expect(restoreWipedPlayable(0, 0, 121_100_000)).toBe(0);
    expect(restoreWipedPlayable(0, 0, 121_100_000, 0)).toBe(0);
    expect(restoreWipedPlayable(5_000, 0, 1_000_000_00, 12)).toBe(5_000);
  });
});

describe('sanitizeScoreForPush', () => {
  it('ne recolle pas une all-in perdue sur le pic', () => {
    const next = sanitizeScoreForPush({
      balance: 0,
      vault: 0,
      peakBalance: 121_100_000,
      gamesPlayed: 10,
    });
    expect(next.balance).toBe(0);
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
