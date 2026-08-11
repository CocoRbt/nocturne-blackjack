import { describe, expect, it } from 'vitest';
import { createIdleRound, resetAfterSettle, settleSpin, startSpin } from '../engine';

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('slots engine', () => {
  it('refuse mise invalide', () => {
    expect(() => startSpin({ bet: 0 })).toThrow(/Mise/);
  });

  it('spin base → spinning puis settled', () => {
    const round = startSpin({ bet: 5_00, rng: mulberry32(1) });
    expect(round.phase).toBe('spinning');
    expect(round.mode).toBe('base');
    expect(round.grid).toHaveLength(5);
    const settled = settleSpin(round);
    expect(settled.phase).toBe('settled');
    expect(settled.payout).toBe(round.payout);
  });

  it('comptabilité : payout = f(bet, mult)', () => {
    const round = startSpin({ bet: 10_00, rng: mulberry32(42) });
    expect(round.payout).toBeGreaterThanOrEqual(0);
    if (round.eval) {
      expect(round.payout).toBe(Math.floor(10_00 * round.eval.totalMult));
    }
  });

  it('free spins : mode free sans consommer une mise séparée', () => {
    // Force un chemin : on démarre en free avec stock
    const fs = startSpin({
      bet: 5_00,
      freeSpinsLeft: 3,
      herdHeads: 0,
      rng: mulberry32(9),
    });
    expect(fs.mode).toBe('free');
    expect(fs.freeSpinsLeft).toBeGreaterThanOrEqual(2); // 3-1 (+retriggers éventuels)
  });

  it('resetAfterSettle garde le bonus si FS restants', () => {
    let round = startSpin({
      bet: 5_00,
      freeSpinsLeft: 2,
      herdHeads: 1,
      rng: mulberry32(3),
    });
    round = settleSpin(round);
    const next = resetAfterSettle(round);
    if (round.freeSpinsLeft > 0) {
      expect(next.mode).toBe('free');
      expect(next.freeSpinsLeft).toBe(round.freeSpinsLeft);
      expect(next.herdHeads).toBe(round.herdHeads);
      expect(next.phase).toBe('idle');
    }
  });

  it('idle de départ', () => {
    const idle = createIdleRound();
    expect(idle.phase).toBe('idle');
    expect(idle.bet).toBe(0);
  });
});
