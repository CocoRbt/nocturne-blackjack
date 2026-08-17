import { describe, expect, it } from 'vitest';
import { mergeRecordPeak, peakWealthCents, wealthCents } from '../wealth';

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
