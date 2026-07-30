import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../engine/rng';
import {
  cashOut,
  placeMines,
  revealTile,
  startRound,
} from '../engine';
import { minesMultiplier, nextTileMultiplier, payoutCents, survivalChance } from '../math';

describe('minesMultiplier (Stake-like)', () => {
  it('1 mine · 1 diamant ≈ 1.03x', () => {
    expect(minesMultiplier(1, 1)).toBe(1.03);
  });

  it('24 mines · 1 diamant = 24.75x', () => {
    expect(minesMultiplier(24, 1)).toBe(24.75);
  });

  it('0 diamant = 1x', () => {
    expect(minesMultiplier(0, 3)).toBe(1);
  });

  it('next tile = multiplier(revealed+1)', () => {
    expect(nextTileMultiplier(2, 3)).toBe(minesMultiplier(3, 3));
  });

  it('EV ≈ RTP : P(survie) × mult ≈ 0.99', () => {
    for (const mines of [1, 3, 5, 10, 24]) {
      for (const n of [1, 2, 3]) {
        if (n > 25 - mines) continue;
        const ev = survivalChance(n, mines) * minesMultiplier(n, mines);
        expect(ev).toBeGreaterThan(0.97);
        expect(ev).toBeLessThan(1.0);
      }
    }
  });
});

describe('mines engine', () => {
  it('place exactement N mines', () => {
    const set = placeMines(5, mulberry32(42));
    expect(set.size).toBe(5);
  });

  it('même seed → même placement', () => {
    const a = [...placeMines(7, mulberry32(99))].sort((x, y) => x - y);
    const b = [...placeMines(7, mulberry32(99))].sort((x, y) => x - y);
    expect(a).toEqual(b);
  });

  it('cashout après diamants crédite mise × mult', () => {
    const rng = mulberry32(7);
    // Cherche une case safe
    let round = startRound(100_00, 3, rng);
    const safe = [...Array(25).keys()].find((i) => !round.mineSet.has(i))!;
    const r1 = revealTile(round, safe);
    expect(r1.hitMine).toBe(false);
    round = r1.round;
    const { payout } = cashOut(round);
    expect(payout).toBe(payoutCents(100_00, round.multiplier));
    expect(payout).toBeGreaterThan(0);
  });

  it('mine → bust, payout 0', () => {
    const round = startRound(50_00, 10, mulberry32(1));
    const mine = [...round.mineSet][0];
    const r = revealTile(round, mine);
    expect(r.hitMine).toBe(true);
    expect(r.round.phase).toBe('busted');
    expect(r.payout).toBe(0);
  });
});
