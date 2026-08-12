import { describe, expect, it } from 'vitest';
import { HERD_MULT_THRESHOLDS, herdWinMultiplier } from '../math';

describe('slots feel helpers', () => {
  it('paliers troupeau lisibles et croissants', () => {
    expect(herdWinMultiplier(0)).toBe(1);
    expect(herdWinMultiplier(3)).toBe(1);
    expect(herdWinMultiplier(4)).toBe(1.5);
    expect(herdWinMultiplier(7)).toBe(2);
    expect(herdWinMultiplier(13)).toBe(2.5);
    expect(herdWinMultiplier(15)).toBe(3);
    const ats = HERD_MULT_THRESHOLDS.map((t) => t.at);
    expect(ats).toEqual([4, 7, 13, 15]);
    for (let i = 1; i < HERD_MULT_THRESHOLDS.length; i++) {
      expect(HERD_MULT_THRESHOLDS[i]!.mult).toBeGreaterThan(HERD_MULT_THRESHOLDS[i - 1]!.mult);
    }
  });
});
