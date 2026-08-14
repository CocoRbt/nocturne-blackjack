import { describe, expect, it } from 'vitest';
import { crapsStakeOpen, createCrapsRound, placeBet, resolveRoll, takeBackBet, type DiceRoll } from '../engine';
import { STARTING_BALANCE } from '../../store/persistence';

function roll(d1: number, d2: number): DiceRoll {
  return {
    d1: d1 as 1 | 2 | 3 | 4 | 5 | 6,
    d2: d2 as 1 | 2 | 3 | 4 | 5 | 6,
    total: d1 + d2,
  };
}

/**
 * Rejoue le glitch rapporté :
 * all-in 100 → recharge +100 → re-poser → la mise gonfle sans payer.
 * Après fix, refill est interdit tant que crapsStakeOpen.
 */
function session() {
  let balance = STARTING_BALANCE;
  let round = createCrapsRound();
  let refills = 0;

  const stakeOpen = () => crapsStakeOpen(round);

  const place = (cents: number) => {
    const amount = Math.min(cents, balance);
    const p = placeBet(round, amount);
    if (!p.ok) return false;
    if (p.debitCents > balance) return false;
    balance -= p.debitCents;
    round = p.round;
    return true;
  };

  const refill = () => {
    if (stakeOpen()) return false;
    if (balance >= 1_00) return false;
    balance = STARTING_BALANCE;
    refills += 1;
    return true;
  };

  const resolve = (d1: number, d2: number) => {
    const res = resolveRoll(round, roll(d1, d2));
    if (!res.ok) return res;
    balance += res.creditCents;
    round = res.round;
    return res;
  };

  const takeBack = () => {
    const tb = takeBackBet(round);
    if (!tb.ok) return false;
    balance += tb.creditCents;
    round = tb.round;
    return true;
  };

  return {
    get balance() {
      return balance;
    },
    get bet() {
      return round.bet;
    },
    get refills() {
      return refills;
    },
    stakeOpen,
    place,
    refill,
    resolve,
    takeBack,
  };
}

describe('craps — all-in + recharge', () => {
  it('refuse la recharge tant qu’un jeton est sur le feutre', () => {
    const s = session();
    expect(s.place(STARTING_BALANCE)).toBe(true);
    expect(s.balance).toBe(0);
    expect(s.bet).toBe(STARTING_BALANCE);
    expect(s.stakeOpen()).toBe(true);
    expect(s.refill()).toBe(false);
    expect(s.refills).toBe(0);
    expect(s.balance).toBe(0);
    expect(s.bet).toBe(STARTING_BALANCE);
  });

  it('autorise la recharge seulement après une perte (table vide)', () => {
    const s = session();
    expect(s.place(STARTING_BALANCE)).toBe(true);
    s.resolve(1, 1); // 2 = craps lose
    expect(s.bet).toBe(0);
    expect(s.stakeOpen()).toBe(false);
    expect(s.balance).toBe(0);
    expect(s.refill()).toBe(true);
    expect(s.balance).toBe(STARTING_BALANCE);
    expect(s.place(STARTING_BALANCE)).toBe(true);
    expect(s.bet).toBe(STARTING_BALANCE);
  });
});

describe('craps — reprendre sans jouer', () => {
  it('recrédite exactement la mise posée', () => {
    const s = session();
    expect(s.place(25_00)).toBe(true);
    expect(s.place(5_00)).toBe(true);
    expect(s.bet).toBe(30_00);
    expect(s.balance).toBe(STARTING_BALANCE - 30_00);
    expect(s.takeBack()).toBe(true);
    expect(s.bet).toBe(0);
    expect(s.balance).toBe(STARTING_BALANCE);
    expect(s.stakeOpen()).toBe(false);
  });
});
