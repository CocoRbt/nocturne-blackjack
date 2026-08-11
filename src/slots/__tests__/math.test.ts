import { describe, expect, it } from 'vitest';
import {
  BASE_STRIPS,
  evaluateSpin,
  evaluateWays,
  freeSpinsAwarded,
  gridFromStops,
  payoutCents,
  pickStops,
  simulateBaseRtp,
  simulateFullRtp,
  SLOT_REELS,
  SLOT_ROWS,
} from '../math';

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('slots math', () => {
  it('grille 5×4', () => {
    const stops = [0, 0, 0, 0, 0];
    const g = gridFromStops(BASE_STRIPS, stops);
    expect(g).toHaveLength(SLOT_REELS);
    for (const col of g) expect(col).toHaveLength(SLOT_ROWS);
  });

  it('payoutCents floor', () => {
    expect(payoutCents(100, 1.5)).toBe(150);
    expect(payoutCents(100, 0)).toBe(0);
  });

  it('3 scatters → 8 free spins', () => {
    expect(freeSpinsAwarded(3)).toBe(8);
    expect(freeSpinsAwarded(4)).toBe(15);
    expect(freeSpinsAwarded(5)).toBe(20);
    expect(freeSpinsAwarded(2)).toBe(0);
  });

  it('ways : 5 bisons alignés paient', () => {
    const grid = [
      ['bison', 'J', 'J', 'J'],
      ['bison', 'J', 'J', 'J'],
      ['bison', 'J', 'J', 'J'],
      ['bison', 'J', 'J', 'J'],
      ['bison', 'J', 'J', 'J'],
    ] as const;
    const wins = evaluateWays(grid);
    const bison5 = wins.find((w) => w.symbol === 'bison' && w.length === 5);
    expect(bison5?.ways).toBe(1);
    expect(bison5!.multiplier).toBeCloseTo(650 / 1024, 5);
    const bisonTotal = wins
      .filter((w) => w.symbol === 'bison')
      .reduce((s, w) => s + w.multiplier, 0);
    expect(bisonTotal).toBeGreaterThan(bison5!.multiplier);
  });

  it('wild substitue', () => {
    const grid = [
      ['bison', 'J', 'J', 'J'],
      ['wild', 'J', 'J', 'J'],
      ['bison', 'J', 'J', 'J'],
      ['J', 'J', 'J', 'J'],
      ['J', 'J', 'J', 'J'],
    ] as const;
    const wins = evaluateWays(grid);
    expect(wins.some((w) => w.symbol === 'bison' && w.length === 3)).toBe(true);
  });

  it('pickStops déterministe', () => {
    const rng = mulberry32(7);
    const a = pickStops(BASE_STRIPS, rng);
    const rng2 = mulberry32(7);
    const b = pickStops(BASE_STRIPS, rng2);
    expect(a).toEqual(b);
  });

  it('RTP base empirique dans une bande raisonnable', () => {
    const rtp = simulateBaseRtp(40_000, mulberry32(99));
    expect(rtp).toBeGreaterThan(0.4);
    expect(rtp).toBeLessThan(1.2);
  });

  it('RTP full (base+FS) ~96 % (±10 pts sur 40k spins, variance FS)', () => {
    const rtp = simulateFullRtp(40_000, mulberry32(123));
    expect(rtp).toBeGreaterThan(0.85);
    expect(rtp).toBeLessThan(1.08);
  }, 60_000);

  it('evaluateSpin FS ajoute herd bison', () => {
    const grid = [
      ['bison', 'bison', 'J', 'J'],
      ['eagle', 'J', 'J', 'J'],
      ['J', 'J', 'J', 'J'],
      ['J', 'J', 'J', 'J'],
      ['J', 'J', 'J', 'J'],
    ] as const;
    const ev = evaluateSpin(grid, {
      freeSpinMode: true,
      herdHeads: 3,
      rng: () => 0.1,
    });
    expect(ev.bisonLanded).toBe(2);
  });
});
