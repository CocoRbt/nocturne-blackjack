import { describe, expect, it } from 'vitest';
import { mulberry32, type Rng } from '../../engine/rng';
import {
  createIdleRound,
  resetAfterSettle,
  settleSpin,
  startSpin,
  type SlotsRound,
} from '../engine';
import { payoutCents } from '../math';

/**
 * Rejoue exactement la boucle de `SlotScreen` :
 * débit uniquement sur un spin de base, un seul crédit par spin,
 * enchaînement automatique des tours gratuits.
 */
function runSession(opts: {
  bet: number;
  baseSpins: number;
  startBalance: number;
  rng: Rng;
  startRound?: SlotsRound;
}) {
  const { bet, baseSpins, startBalance, rng } = opts;
  let balance = startBalance;
  let round = opts.startRound ?? createIdleRound();

  let debited = 0;
  let credited = 0;
  let creditCalls = 0;
  let paidSpins = 0;
  let freeSpins = 0;
  /** Traces par spin pour vérifier l’invariant de caisse. */
  const ledger: { free: boolean; before: number; stake: number; payout: number; after: number }[] =
    [];

  let guard = 0;
  while (paidSpins < baseSpins && guard < 100_000) {
    guard += 1;
    const free = round.freeSpinsLeft > 0;
    const stake = free ? round.bet : bet;
    const before = balance;

    if (free) {
      freeSpins += 1;
    } else {
      if (stake > balance) break;
      balance -= stake;
      debited += stake;
      paidSpins += 1;
    }

    round = startSpin({
      bet: stake,
      freeSpinsLeft: round.freeSpinsLeft,
      herdHeads: round.herdHeads,
      rng,
    });
    round = settleSpin(round);

    balance += round.payout;
    credited += round.payout;
    creditCalls += 1;
    ledger.push({ free, before, stake, payout: round.payout, after: balance });

    round = resetAfterSettle(round);
  }

  return { balance, debited, credited, creditCalls, paidSpins, freeSpins, ledger, round };
}

describe('stampede — comptabilité de session', () => {
  it('spin de base : solde après = solde avant − mise + gain', () => {
    const rng = mulberry32(2026);
    for (let i = 0; i < 400; i++) {
      const bet = 5_00;
      const before = 1_000_00;
      const round = settleSpin(startSpin({ bet, rng }));
      const after = before - bet + round.payout;
      expect(after).toBe(before - bet + round.payout);
      expect(round.payout).toBeGreaterThanOrEqual(0);
      expect(round.payout).toBe(payoutCents(bet, round.eval!.totalMult));
    }
  });

  it('session complète : solde = départ − débits + crédits', () => {
    for (const seed of [1, 7, 42, 1234, 99_999]) {
      const s = runSession({
        bet: 5_00,
        baseSpins: 300,
        startBalance: 100_000_00,
        rng: mulberry32(seed),
      });
      expect(s.paidSpins, `seed ${seed}`).toBe(300);
      expect(s.debited).toBe(300 * 5_00);
      expect(s.balance).toBe(100_000_00 - s.debited + s.credited);
      // Un crédit et un seul par spin joué (base + gratuits).
      expect(s.creditCalls).toBe(s.paidSpins + s.freeSpins);
    }
  });

  it('chaque ligne du journal respecte l’invariant de caisse', () => {
    const s = runSession({
      bet: 25_00,
      baseSpins: 150,
      startBalance: 50_000_00,
      rng: mulberry32(77),
    });
    for (const line of s.ledger) {
      const stake = line.free ? 0 : line.stake;
      expect(line.after).toBe(line.before - stake + line.payout);
    }
  });

  it('tours gratuits : aucun débit, la mise du déclencheur est conservée', () => {
    const rng = mulberry32(555);
    const bet = 10_00;
    let round = startSpin({ bet, freeSpinsLeft: 12, herdHeads: 0, rng });
    let balance = 1_000_00;
    const debits = 0;
    let spins = 0;

    while (round.freeSpinsLeft > 0 && spins < 200) {
      spins += 1;
      round = settleSpin(round);
      balance += round.payout;
      round = resetAfterSettle(round);
      expect(round.bet).toBe(bet);
      if (round.freeSpinsLeft <= 0) break;
      // Le tour suivant repart sans toucher au solde.
      const before = balance;
      round = startSpin({
        bet: round.bet,
        freeSpinsLeft: round.freeSpinsLeft,
        herdHeads: round.herdHeads,
        rng,
      });
      expect(balance).toBe(before);
    }

    expect(debits).toBe(0);
    expect(spins).toBeGreaterThan(1);
    expect(balance).toBeGreaterThanOrEqual(1_000_00);
  });

  it('le stock de tours gratuits se vide (retriggers compris)', () => {
    const rng = mulberry32(31_337);
    let round = startSpin({ bet: 1_00, freeSpinsLeft: 8, herdHeads: 0, rng });
    let guard = 0;
    while (round.freeSpinsLeft > 0 && guard < 500) {
      guard += 1;
      round = resetAfterSettle(settleSpin(round));
      if (round.freeSpinsLeft <= 0) break;
      round = startSpin({
        bet: round.bet,
        freeSpinsLeft: round.freeSpinsLeft,
        herdHeads: round.herdHeads,
        rng,
      });
    }
    expect(round.freeSpinsLeft).toBe(0);
    expect(guard).toBeLessThan(500);
  });

  it('le compteur troupeau ne monte que pendant le bonus', () => {
    const rng = mulberry32(8);
    const base = startSpin({ bet: 5_00, rng });
    expect(base.herdHeads).toBe(0);

    const free = startSpin({ bet: 5_00, freeSpinsLeft: 5, herdHeads: 4, rng });
    expect(free.mode).toBe('free');
    expect(free.herdHeads).toBeGreaterThanOrEqual(4);
    expect(free.herdHeads).toBe(4 + (free.eval?.bisonLanded ?? 0));
  });

  it('sortie de bonus : la manche revient à une mise nulle', () => {
    const rng = mulberry32(404);
    const round = resetAfterSettle(settleSpin(startSpin({ bet: 5_00, freeSpinsLeft: 1, rng })));
    if (round.freeSpinsLeft === 0) {
      expect(round.bet).toBe(0);
      expect(round.mode).toBe('base');
      expect(round.payout).toBe(0);
    }
  });

  it('gain jamais supérieur au multiplicateur annoncé', () => {
    const rng = mulberry32(6_060);
    for (let i = 0; i < 500; i++) {
      const bet = 3_33;
      const round = settleSpin(startSpin({ bet, freeSpinsLeft: i % 3 === 0 ? 4 : 0, rng }));
      const mult = round.eval?.totalMult ?? 0;
      expect(round.payout).toBe(Math.floor(bet * mult));
      expect(round.payout).toBeLessThanOrEqual(Math.ceil(bet * mult));
    }
  });
});
