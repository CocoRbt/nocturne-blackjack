import { describe, expect, it } from 'vitest';
import { SLOT_WAYS, WAY_PAY, type PaySymbol } from '../math';

/** Miroir de la logique UI : un preset 0 = ∞ (−1), sinon N spins. */
function normalizeAutoCount(count: number): number {
  return count <= 0 ? -1 : Math.floor(count);
}

function shouldStopAuto(input: {
  fsGrant: number;
  isBig: boolean;
  stopOnFeature: boolean;
  stopOnBigWin: boolean;
}): boolean {
  if (input.fsGrant > 0 && input.stopOnFeature) return true;
  if (input.isBig && input.stopOnBigWin) return true;
  return false;
}

describe('slots auto-spin helpers', () => {
  it('normalise les compteurs (∞ = −1)', () => {
    expect(normalizeAutoCount(10)).toBe(10);
    expect(normalizeAutoCount(0)).toBe(-1);
    expect(normalizeAutoCount(-5)).toBe(-1);
  });

  it('stop sur feature / gros gain selon les toggles', () => {
    expect(
      shouldStopAuto({ fsGrant: 8, isBig: false, stopOnFeature: true, stopOnBigWin: false }),
    ).toBe(true);
    expect(
      shouldStopAuto({ fsGrant: 8, isBig: false, stopOnFeature: false, stopOnBigWin: false }),
    ).toBe(false);
    expect(
      shouldStopAuto({ fsGrant: 0, isBig: true, stopOnFeature: true, stopOnBigWin: true }),
    ).toBe(true);
    expect(
      shouldStopAuto({ fsGrant: 0, isBig: true, stopOnFeature: true, stopOnBigWin: false }),
    ).toBe(false);
  });
});

describe('slots paytable display', () => {
  it('tous les symboles ont 3/4/5 et un mult way > 0', () => {
    const syms = Object.keys(WAY_PAY) as PaySymbol[];
    expect(syms.length).toBe(9);
    for (const s of syms) {
      expect(WAY_PAY[s][3] / SLOT_WAYS).toBeGreaterThan(0);
      expect(WAY_PAY[s][5]).toBeGreaterThan(WAY_PAY[s][3]);
    }
  });
});
