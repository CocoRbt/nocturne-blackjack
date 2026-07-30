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

  it('reports the max seat count for orientation', () => {
    expect(maxSeatsForOrientation(false)).toBe(5);
    expect(maxSeatsForOrientation(true)).toBe(7);
  });
});
