import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../engine/rng';
import { pathToSlot, resetIdle, rollPath, settleDrop, startDrop } from '../engine';
import { multiplierAt } from '../math';

describe('plinko engine', () => {
  it('chemin déterministe avec seed', () => {
    const rng = mulberry32(42);
    const path = rollPath(8, rng);
    expect(path).toHaveLength(8);
    expect(pathToSlot(path)).toBe(path.filter(Boolean).length);
  });

  it('startDrop fige slot + payout', () => {
    const round = startDrop(5_00, 8, 'medium', mulberry32(7));
    expect(round.phase).toBe('dropping');
    expect(round.path).toHaveLength(8);
    expect(round.slot).toBe(pathToSlot(round.path));
    expect(round.multiplier).toBe(multiplierAt(8, 'medium', round.slot));
    expect(round.payout).toBe(Math.floor(5_00 * round.multiplier + 1e-9));
  });

  it('settle puis reset', () => {
    const dropping = startDrop(1_00, 12, 'low', mulberry32(99));
    const settled = settleDrop(dropping);
    expect(settled.phase).toBe('settled');
    const idle = resetIdle(settled);
    expect(idle.phase).toBe('idle');
    expect(idle.rows).toBe(12);
    expect(idle.risk).toBe('low');
    expect(idle.bet).toBe(0);
  });

  it('rejette mise nulle', () => {
    expect(() => startDrop(0, 8, 'low')).toThrow();
  });

  it('simulation 50k drops : RTP empirique proche du théorique', () => {
    const rows = 12;
    const risk = 'medium' as const;
    const bet = 100;
    let returned = 0;
    const N = 50_000;
    const rng = mulberry32(12345);
    for (let i = 0; i < N; i++) {
      const r = startDrop(bet, rows, risk, rng);
      returned += r.payout;
    }
    const empiric = returned / (N * bet);
    expect(empiric).toBeGreaterThan(0.95);
    expect(empiric).toBeLessThan(1.03);
  });
});
