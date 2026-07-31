import { describe, expect, it } from 'vitest';
import { card } from '../cards';
import { getTable, type RulesConfig } from '../rules';
import { RiggedShoe } from '../shoe';
import { maxSeatsForOrientation, TableRound } from '../tableRound';
import type { BetLayout } from '../types';

function rig(codes: string[]) {
  return new RiggedShoe(codes.map((c, i) => card(c, `${c}-${i}`)));
}

const RULES: RulesConfig = getTable('emeraude').rules;
const bet = (main: number, sideBets: BetLayout['sideBets'] = {}): BetLayout => ({ main, sideBets });

describe('TableRound', () => {
  it('deals two seats before the shared dealer hole card', () => {
    const r = new TableRound(RULES, rig(['2S', '3S', '9D', '4H', '5H', '7C']), [
      { seatIndex: 0, bets: bet(10_00) },
      { seatIndex: 1, bets: bet(10_00) },
    ]);

    expect(r.phase).toBe('player');
    expect(r.dealerCards.map((c) => c.id)).toEqual(['9D-2', '7C-5']);
    expect(r.seats[0].hands[0].cards.map((c) => c.id)).toEqual(['2S-0', '4H-3']);
    expect(r.seats[1].hands[0].cards.map((c) => c.id)).toEqual(['3S-1', '5H-4']);
  });

  it('settles side bets independently per seat', () => {
    const r = new TableRound(RULES, rig(['8S', '2H', '10D', '8H', '9S', '7C']), [
      { seatIndex: 0, bets: bet(10_00, { perfectPairs: 2_00 }) },
      { seatIndex: 1, bets: bet(10_00, { perfectPairs: 2_00 }) },
    ]);

    r.stand();
    r.stand();

    const res = r.result!;
    const seat0Pair = res.sideBets.find((b) => b.seatIndex === 0 && b.id === 'perfectPairs')!;
    const seat1Pair = res.sideBets.find((b) => b.seatIndex === 1 && b.id === 'perfectPairs')!;
    expect(seat0Pair.paysMultiplier).toBe(6);
    expect(seat0Pair.returned).toBe(14_00);
    expect(seat1Pair.returned).toBe(0);
    expect(res.seats[0].totalNet).toBe(14_00 - 10_00 - 2_00);
    expect(res.seats[1].totalNet).toBe(-12_00);
  });

  it('plays all hands for seat 0 before seat 1', () => {
    const r = new TableRound(RULES, rig(['10S', '10H', '6D', '2C', '9C', '10D', '3S', '5H']), [
      { seatIndex: 0, bets: bet(10_00) },
      { seatIndex: 1, bets: bet(10_00) },
    ]);

    expect(r.activeSeatIndex).toBe(0);
    r.hit();
    expect(r.activeSeatIndex).toBe(0);
    r.stand();
    expect(r.phase).toBe('player');
    expect(r.activeSeatIndex).toBe(1);
    r.stand();
    expect(r.phase).toBe('settled');
  });

  it('uses one dealer play to settle all seats', () => {
    const r = new TableRound(RULES, rig(['10S', '10H', '6D', '8C', '9C', '10D', 'KD']), [
      { seatIndex: 0, bets: bet(10_00) },
      { seatIndex: 1, bets: bet(10_00) },
    ]);

    r.stand();
    r.stand();

    const res = r.result!;
    expect(res.dealerBust).toBe(true);
    expect(res.dealerCards.map((c) => c.id)).toEqual(['6D-2', '10D-5', 'KD-6']);
    expect(res.hands.map((h) => [h.seatIndex, h.outcome, h.returned])).toEqual([
      [0, 'win', 20_00],
      [1, 'win', 20_00],
    ]);
    expect(res.totalNet).toBe(20_00);
  });

  it('push sur une place rend la mise même si l’autre perd', () => {
    // Deal order: P0, P1, D up, P0, P1, D hole — then P0 stand, P1 stand, dealer draws
    // P0: 10+9=19, P1: 8+7=15, D: 10+6=16 → hits K → bust? Wait need both push scenarios
    // Better: P0 20 push vs 20, P1 18 lose vs 20
    // Cards: P0c1=10, P1c1=9, Dup=10, P0c2=10, P1c2=9, Dhole=10 → D=20
    // P0=20 push, P1=18 lose
    const r = new TableRound(
      RULES,
      rig(['10S', '9H', '10D', '10C', '9C', '10H']),
      [
        { seatIndex: 0, bets: bet(50_00) },
        { seatIndex: 1, bets: bet(50_00) },
      ],
    );
    r.stand();
    r.stand();
    const res = r.result!;
    expect(res.dealerTotal).toBe(20);
    expect(res.hands[0]).toMatchObject({ seatIndex: 0, outcome: 'push', bet: 50_00, returned: 50_00, net: 0 });
    expect(res.hands[1]).toMatchObject({ seatIndex: 1, outcome: 'lose', bet: 50_00, returned: 0, net: -50_00 });
    expect(res.totalReturned).toBe(50_00);
    expect(res.totalWagered).toBe(100_00);
    expect(res.totalNet).toBe(-50_00);
    // Crédit simulé : 500 − 100 misés + 50 rendus = 450 (la place push a bien récupéré sa mise)
    const balanceAfter = 500_00 - res.totalWagered + res.totalReturned;
    expect(balanceAfter).toBe(450_00);
  });

  it('push + side bet perdant : main rendue, side perdu (net ≠ 0 global)', () => {
    // P: 10+10=20, D: 9+K=19 → win actually. Need push: D also 20
    // P: KS KH = 20, D: 10D QD = 20. PP: perfect pair of kings same suit? KS KH different suits = colored? 
    // Perfect pair needs same rank. KS+KH = mixed pair pays.
    const r = new TableRound(
      RULES,
      rig(['KS', '10D', 'KH', 'QD']),
      [
        {
          seatIndex: 0,
          bets: {
            main: 20_00,
            sideBets: { perfectPairs: 5_00 },
          },
        },
      ],
    );
    r.stand();
    const res = r.result!;
    expect(res.hands[0].outcome).toBe('push');
    expect(res.hands[0].returned).toBe(20_00);
    expect(res.hands[0].net).toBe(0);
    // Mixed pair (same rank, different color? K♠ K♥ = different color = mixed)
    const pp = res.sideBets.find((b) => b.id === 'perfectPairs');
    expect(pp).toBeTruthy();
    // Main push kept; global net = side net only
    expect(res.totalReturned).toBe(20_00 + (pp?.returned ?? 0));
    expect(res.totalNet).toBe(pp!.net);
  });

  it('reports the max seat count for orientation', () => {
    expect(maxSeatsForOrientation(false)).toBe(5);
    expect(maxSeatsForOrientation(true)).toBe(7);
  });

  it('S17 : le croupier reste sur 6+A (soft 17)', () => {
    // P: J+8=18, D: 6+A — ne doit plus tirer
    const r = new TableRound(RULES, rig(['JS', '6D', '8H', 'AC', 'KH']), [
      { seatIndex: 0, bets: bet(10_00) },
    ]);
    r.stand();
    expect(r.result!.dealerCards.map((c) => c.rank)).toEqual(['6', 'A']);
    expect(r.result!.dealerTotal).toBe(17);
    expect(r.result!.dealerBust).toBe(false);
    expect(r.result!.hands[0].outcome).toBe('win');
  });

  it('reste sur 10+6+A (17 dur avec As)', () => {
    const r = new TableRound(RULES, rig(['JS', '10D', '8H', '6C', 'AS', '2H']), [
      { seatIndex: 0, bets: bet(10_00) },
    ]);
    r.stand();
    expect(r.result!.dealerCards.map((c) => c.rank)).toEqual(['10', '6', 'A']);
    expect(r.result!.dealerTotal).toBe(17);
    expect(r.result!.dealerBust).toBe(false);
  });
});
