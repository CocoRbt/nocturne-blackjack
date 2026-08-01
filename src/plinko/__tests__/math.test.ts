import { describe, expect, it } from 'vitest';
import {
  PLINKO_RISKS,
  PLINKO_ROWS,
  binomial,
  paytable,
  payoutCents,
  slotProbability,
  theoreticalRtp,
} from '../math';

describe('plinko math', () => {
  it('binomial classiques', () => {
    expect(binomial(8, 0)).toBe(1);
    expect(binomial(8, 4)).toBe(70);
    expect(binomial(16, 8)).toBe(12870);
  });

  it('probabilités somment à 1', () => {
    for (const rows of PLINKO_ROWS) {
      let sum = 0;
      for (let k = 0; k <= rows; k++) sum += slotProbability(rows, k);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it('tables symétriques', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of PLINKO_RISKS) {
        const t = paytable(rows, risk);
        expect(t.length).toBe(rows + 1);
        for (let i = 0; i < t.length; i++) {
          expect(t[i]).toBe(t[t.length - 1 - i]);
        }
      }
    }
  });

  it('RTP théorique ~99 % (±2,5 pts — tables Stake-like)', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of PLINKO_RISKS) {
        const rtp = theoreticalRtp(rows, risk);
        expect(rtp).toBeGreaterThan(0.96);
        expect(rtp).toBeLessThan(1.02);
      }
    }
  });

  it('payoutCents floor', () => {
    expect(payoutCents(100, 1.5)).toBe(150);
    expect(payoutCents(100, 0.3)).toBe(30);
    expect(payoutCents(333, 2.1)).toBe(699);
  });
});
