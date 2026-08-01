import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../engine/rng';
import {
  pathToSlot,
  resetIdle,
  rollPath,
  settleDrop,
  startDrop,
} from '../engine';
import {
  PLINKO_RISKS,
  PLINKO_ROWS,
  multiplierAt,
  paytable,
  payoutCents,
  theoreticalRtp,
} from '../math';

describe('plinko situations', () => {
  it('tous les configs : RTP théorique dans la bande', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of PLINKO_RISKS) {
        const rtp = theoreticalRtp(rows, risk);
        expect(rtp, `${rows}/${risk}`).toBeGreaterThan(0.96);
        expect(rtp, `${rows}/${risk}`).toBeLessThan(1.02);
      }
    }
  });

  it('simulation multi-config RTP empirique (15k chacune)', () => {
    const bet = 100;
    const N = 15_000;
    for (const rows of PLINKO_ROWS) {
      for (const risk of PLINKO_RISKS) {
        const rng = mulberry32(rows * 17 + risk.charCodeAt(0));
        let returned = 0;
        for (let i = 0; i < N; i++) {
          returned += startDrop(bet, rows, risk, rng).payout;
        }
        const emp = returned / (N * bet);
        // High variance sur High/16 — bande large, le test 50k couvre le cas précis.
        expect(emp, `${rows}/${risk}`).toBeGreaterThan(0.88);
        expect(emp, `${rows}/${risk}`).toBeLessThan(1.12);
      }
    }
  });

  it('bords : tout gauche / tout droite', () => {
    for (const rows of PLINKO_ROWS) {
      const left = Array.from({ length: rows }, () => false);
      const right = Array.from({ length: rows }, () => true);
      expect(pathToSlot(left)).toBe(0);
      expect(pathToSlot(right)).toBe(rows);
      expect(multiplierAt(rows, 'high', 0)).toBe(paytable(rows, 'high')[0]);
      expect(multiplierAt(rows, 'high', rows)).toBe(paytable(rows, 'high')[rows]);
    }
  });

  it('payout = floor(mise × mult) pour chaque slot', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of PLINKO_RISKS) {
        const table = paytable(rows, risk);
        for (let slot = 0; slot < table.length; slot++) {
          const bet = 333;
          expect(payoutCents(bet, table[slot]!)).toBe(Math.floor(bet * table[slot]! + 1e-9));
        }
      }
    }
  });

  it('cycle idle → drop → settle → idle préserve rows/risk', () => {
    const dropping = startDrop(25_00, 16, 'high', mulberry32(404));
    expect(dropping.phase).toBe('dropping');
    expect(dropping.path).toHaveLength(16);
    const settled = settleDrop(dropping);
    expect(settled.phase).toBe('settled');
    expect(settled.payout).toBe(payoutCents(25_00, settled.multiplier));
    const idle = resetIdle(settled);
    expect(idle.phase).toBe('idle');
    expect(idle.rows).toBe(16);
    expect(idle.risk).toBe('high');
    expect(idle.bet).toBe(0);
  });

  it('settle hors dropping est no-op', () => {
    const idle = resetIdle(startDrop(1_00, 8, 'low', mulberry32(1)));
    expect(settleDrop(idle)).toBe(idle);
  });

  it('rollPath longueur = rows et slot borné', () => {
    const rng = mulberry32(999);
    for (let i = 0; i < 200; i++) {
      const rows = PLINKO_ROWS[i % PLINKO_ROWS.length]!;
      const path = rollPath(rows, rng);
      expect(path).toHaveLength(rows);
      const slot = pathToSlot(path);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThanOrEqual(rows);
    }
  });

  it('rejette mise nulle ou négative', () => {
    expect(() => startDrop(0, 8, 'low')).toThrow();
    expect(() => startDrop(-100, 8, 'low')).toThrow();
  });
});
