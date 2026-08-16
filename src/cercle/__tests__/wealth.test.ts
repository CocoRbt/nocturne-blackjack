import { describe, expect, it } from 'vitest';
import { peakWealthCents, wealthCents } from '../wealth';

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
