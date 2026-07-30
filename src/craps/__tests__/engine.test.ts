import { describe, expect, it } from 'vitest';
import {
  createCrapsRound,
  placeBet,
  resolveRoll,
  type DiceRoll,
} from '../engine';
import { fieldWinCents, maxOddsCents, oddsWinCents } from '../math';

function roll(d1: number, d2: number): DiceRoll {
  return { d1: d1 as 1 | 2 | 3 | 4 | 5 | 6, d2: d2 as 1 | 2 | 3 | 4 | 5 | 6, total: d1 + d2 };
}

describe('craps math', () => {
  it('field 2 → 2:1, 12 → 3:1, 11 → 1:1', () => {
    expect(fieldWinCents(100, 2)).toBe(200);
    expect(fieldWinCents(100, 12)).toBe(300);
    expect(fieldWinCents(100, 11)).toBe(100);
    expect(fieldWinCents(100, 7)).toBe(0);
  });

  it('odds 3-4-5× et cotes vraies', () => {
    expect(maxOddsCents(100, 4)).toBe(300);
    expect(maxOddsCents(100, 5)).toBe(400);
    expect(maxOddsCents(100, 6)).toBe(500);
    expect(oddsWinCents(100, 4)).toBe(200);
    expect(oddsWinCents(100, 5)).toBe(150);
    expect(oddsWinCents(100, 6)).toBe(120);
  });
});

describe('craps come-out', () => {
  it('natural 7 — Pass gagne 1:1', () => {
    let r = createCrapsRound();
    const p = placeBet(r, 'pass', 500);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    r = p.round;
    const res = resolveRoll(r, roll(3, 4));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.creditCents).toBe(1000);
    expect(res.round.phase).toBe('come_out');
    expect(res.round.bets.pass).toBe(0);
  });

  it('craps 2 — Don’t Pass gagne', () => {
    const placed = placeBet(createCrapsRound(), 'dont_pass', 200);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const res = resolveRoll(placed.round, roll(1, 1));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.creditCents).toBe(400);
  });

  it('12 — Pass perd, Don’t Pass push', () => {
    let r = createCrapsRound();
    const placed = placeBet(r, 'dont_pass', 300);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const res = resolveRoll(placed.round, roll(6, 6));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.creditCents).toBe(300);
    expect(res.round.settlements.some((s) => s.kind === 'dont_pass_push')).toBe(true);
  });

  it('point 6 établi', () => {
    let r = createCrapsRound();
    const placed = placeBet(r, 'pass', 100);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const res = resolveRoll(placed.round, roll(2, 4));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.round.phase).toBe('point');
    expect(res.round.point).toBe(6);
    expect(res.round.bets.pass).toBe(100);
  });

  it('Pass et Don’t Pass incompatibles', () => {
    let r = createCrapsRound();
    const a = placeBet(r, 'pass', 100);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = placeBet(a.round, 'dont_pass', 100);
    expect(b.ok).toBe(false);
  });
});

describe('craps point phase', () => {
  function withPoint(pass: number, pointTotal: number) {
    let r = createCrapsRound();
    const placed = placeBet(r, 'pass', pass);
    if (!placed.ok) throw new Error('place');
    const res = resolveRoll(placed.round, roll(Math.min(pointTotal - 1, 6), pointTotal - Math.min(pointTotal - 1, 6)));
    if (!res.ok) throw new Error('point');
    return res.round;
  }

  it('point fait — Pass + odds payés', () => {
    let r = withPoint(100, 4); // 1+3
    expect(r.point).toBe(4);
    const odds = placeBet(r, 'odds', 300);
    expect(odds.ok).toBe(true);
    if (!odds.ok) return;
    r = odds.round;
    const res = resolveRoll(r, roll(1, 3));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // pass 100*2 + odds 300 + profit 600 = 200 + 900 = 1100
    expect(res.creditCents).toBe(200 + 300 + 600);
    expect(res.round.phase).toBe('come_out');
  });

  it('seven-out — Pass et odds perdus', () => {
    let r = withPoint(100, 8);
    const odds = placeBet(r, 'odds', 200);
    expect(odds.ok).toBe(true);
    if (!odds.ok) return;
    const res = resolveRoll(odds.round, roll(3, 4));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.creditCents).toBe(0);
    expect(res.round.phase).toBe('come_out');
    expect(res.round.bets.pass).toBe(0);
  });

  it('field one-roll pendant le point', () => {
    let r = withPoint(100, 5);
    const f = placeBet(r, 'field', 50);
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    const res = resolveRoll(f.round, roll(1, 2)); // 3 field win 1:1
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.creditCents).toBe(100); // stake+profit field; pass still working
    expect(res.round.bets.pass).toBe(100);
    expect(res.round.phase).toBe('point');
  });
});
