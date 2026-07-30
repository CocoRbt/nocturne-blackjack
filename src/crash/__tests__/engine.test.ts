import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../engine/rng';
import { cashOut, startRound, tickRound } from '../engine';
import {
  CRASH_RTP,
  crashPointFromUnit,
  elapsedForMultiplier,
  multiplierAtElapsed,
  payoutCents,
  reachChance,
} from '../math';

describe('crash math (Stake-like)', () => {
  it('instant crash possible à 1.00×', () => {
    expect(crashPointFromUnit(0.999)).toBe(1);
  });

  it('u bas → multiplicateur élevé', () => {
    expect(crashPointFromUnit(0)).toBeGreaterThan(1000);
    expect(crashPointFromUnit(0.5)).toBeGreaterThan(1);
  });

  it('borné au max', () => {
    expect(crashPointFromUnit(0)).toBeLessThanOrEqual(1_000_000);
  });

  it('P(reach m) ≈ RTP / m', () => {
    expect(reachChance(2)).toBeCloseTo(CRASH_RTP / 2, 5);
    expect(reachChance(10)).toBeCloseTo(CRASH_RTP / 10, 5);
  });

  it('croissance exponentielle cohérente', () => {
    const t2 = elapsedForMultiplier(2);
    expect(multiplierAtElapsed(t2)).toBeCloseTo(2, 5);
    expect(multiplierAtElapsed(t2 * 2)).toBeCloseTo(4, 4);
  });

  it('payout en centimes floor', () => {
    expect(payoutCents(100_00, 1.5)).toBe(150_00);
    expect(payoutCents(100_00, 1.999)).toBe(199_90);
  });
});

describe('crash engine', () => {
  it('même seed → même crashAt', () => {
    const a = startRound(5_00, null, mulberry32(42));
    const b = startRound(5_00, null, mulberry32(42));
    expect(a.crashAt).toBe(b.crashAt);
    expect(a.phase).toBe('flying');
  });

  it('cashout avant crash crédite mise × mult', () => {
    const round = startRound(100_00, null, mulberry32(7));
    expect(round.crashAt).toBeGreaterThan(1.5);
    const res = cashOut(round, 1.5);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payout).toBe(payoutCents(100_00, 1.5));
    expect(res.round.phase).toBe('cashed');
  });

  it('refuse cashout après crash', () => {
    const round = startRound(50_00, null, () => 0.999);
    expect(round.crashAt).toBe(1);
    const t = tickRound(round, 1);
    expect(t.justCrashed).toBe(true);
    const res = cashOut(t.round, 1.2);
    expect(res.ok).toBe(false);
  });

  it('auto-cashout avant crash', () => {
    const round = startRound(20_00, 2, mulberry32(3));
    if (round.crashAt <= 2) return; // rare selon seed
    const t = tickRound(round, elapsedForMultiplier(2) + 1);
    expect(t.justAutoCashed).toBe(true);
    expect(t.round.phase).toBe('cashed');
    expect(t.round.payout).toBe(payoutCents(20_00, 2));
  });

  it('tick atteint crashAt → crashed', () => {
    const round = startRound(10_00, null, mulberry32(99));
    const t = tickRound(round, round.crashDurationMs + 50);
    expect(t.justCrashed).toBe(true);
    expect(t.round.phase).toBe('crashed');
    expect(t.round.payout).toBe(0);
  });
});
