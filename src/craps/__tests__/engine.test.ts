import { describe, expect, it } from 'vitest';
import {
  createCrapsRound,
  crapsStakeOpen,
  placeBet,
  resolveRoll,
  takeBackBet,
  type DiceRoll,
} from '../engine';
import {
  MULT_COME_OUT,
  MULT_POINT,
  POINT_ROLLS_BEFORE_PUSH,
  winCreditCents,
} from '../math';

function roll(d1: number, d2: number): DiceRoll {
  return {
    d1: d1 as 1 | 2 | 3 | 4 | 5 | 6,
    d2: d2 as 1 | 2 | 3 | 4 | 5 | 6,
    total: d1 + d2,
  };
}

function withBet(cents: number) {
  const p = placeBet(createCrapsRound(), cents);
  if (!p.ok) throw new Error('bet');
  return p.round;
}

describe('street craps math', () => {
  it('crédits ×2 / ×4', () => {
    expect(winCreditCents(500, MULT_COME_OUT)).toBe(1000);
    expect(winCreditCents(500, MULT_POINT)).toBe(2000);
  });
});

describe('premier lancer (×2)', () => {
  it('7 — win ×2', () => {
    const res = resolveRoll(withBet(500), roll(3, 4));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.creditCents).toBe(1000);
    expect(res.round.phase).toBe('come_out');
    expect(res.round.bet).toBe(0);
  });

  it('11 — win ×2', () => {
    const res = resolveRoll(withBet(200), roll(5, 6));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.creditCents).toBe(400);
  });

  it('2 — lose', () => {
    const res = resolveRoll(withBet(300), roll(1, 1));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.creditCents).toBe(0);
    expect(res.round.bet).toBe(0);
  });

  it('12 — lose', () => {
    const res = resolveRoll(withBet(100), roll(6, 6));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.creditCents).toBe(0);
  });

  it('6 — fixe la cible, mise toujours en jeu', () => {
    const res = resolveRoll(withBet(100), roll(2, 4));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.round.phase).toBe('point');
    expect(res.round.point).toBe(6);
    expect(res.round.bet).toBe(100);
    expect(res.round.pointRolls).toBe(0);
    expect(res.creditCents).toBe(0);
  });
});

describe('phase cible (×4)', () => {
  function withPoint(stake: number, pointTotal: number) {
    const a = Math.min(pointTotal - 1, 6);
    const b = pointTotal - a;
    const res = resolveRoll(withBet(stake), roll(a, b));
    if (!res.ok) throw new Error('point');
    return res.round;
  }

  it('cible faite — win ×4', () => {
    let r = withPoint(100, 4);
    expect(r.point).toBe(4);
    const res = resolveRoll(r, roll(1, 3));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.creditCents).toBe(400);
    expect(res.round.phase).toBe('come_out');
    expect(res.round.bet).toBe(0);
  });

  it('7 trop tôt — perdu', () => {
    const r = withPoint(100, 8);
    const res = resolveRoll(r, roll(3, 4));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.creditCents).toBe(0);
    expect(res.round.phase).toBe('come_out');
  });

  it('jets neutres puis push après N', () => {
    let r = withPoint(250, 5);
    // 5 established; roll 6, 8, 9 = three neutrals → push
    const neutrals = [roll(1, 5), roll(2, 6), roll(3, 6)]; // 6, 8, 9
    expect(neutrals).toHaveLength(POINT_ROLLS_BEFORE_PUSH);
    for (let i = 0; i < POINT_ROLLS_BEFORE_PUSH - 1; i++) {
      const res = resolveRoll(r, neutrals[i]!);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.round.phase).toBe('point');
      expect(res.creditCents).toBe(0);
      r = res.round;
    }
    const last = resolveRoll(r, neutrals[POINT_ROLLS_BEFORE_PUSH - 1]!);
    expect(last.ok).toBe(true);
    if (!last.ok) return;
    expect(last.creditCents).toBe(250);
    expect(last.round.phase).toBe('come_out');
    expect(last.round.settlements.some((s) => s.kind === 'point_push')).toBe(true);
  });

  it('pas de remise pendant la cible', () => {
    const r = withPoint(100, 6);
    const p = placeBet(r, 50);
    expect(p.ok).toBe(false);
  });
});

describe('reprendre la mise', () => {
  it('rend le jeton avant le lancer', () => {
    const tb = takeBackBet(withBet(500));
    expect(tb.ok).toBe(true);
    if (!tb.ok) return;
    expect(tb.creditCents).toBe(500);
    expect(tb.round.bet).toBe(0);
    expect(crapsStakeOpen(tb.round)).toBe(false);
  });

  it('refuse pendant la cible', () => {
    const r = resolveRoll(withBet(100), roll(2, 4));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tb = takeBackBet(r.round);
    expect(tb.ok).toBe(false);
    expect(r.round.bet).toBe(100);
  });

  it('rien à reprendre si table vide', () => {
    const tb = takeBackBet(createCrapsRound());
    expect(tb.ok).toBe(false);
  });
});

describe('anti all-in + recharge', () => {
  it('crapsStakeOpen dès qu’un jeton est posé', () => {
    expect(crapsStakeOpen(createCrapsRound())).toBe(false);
    expect(crapsStakeOpen(withBet(100))).toBe(true);
    const afterWin = resolveRoll(withBet(100), roll(3, 4));
    expect(afterWin.ok).toBe(true);
    if (!afterWin.ok) return;
    expect(crapsStakeOpen(afterWin.round)).toBe(false);
  });
});
