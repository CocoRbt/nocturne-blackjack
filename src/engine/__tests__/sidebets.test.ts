import { describe, expect, it } from 'vitest';
import { card } from '../cards';
import { Round } from '../round';
import { getTable, type RulesConfig } from '../rules';
import { RiggedShoe } from '../shoe';
import { evaluateBustIt, evaluateDealSideBet } from '../sidebets';
import type { BetLayout, Card } from '../types';

const c = (code: string, id?: string) => card(code, id ?? `${code}-${Math.random()}`);
const pair = (a: string, b: string): [Card, Card] => [c(a, 'a'), c(b, 'b')];

describe('Perfect Pairs', () => {
  it('paire parfaite 25:1', () => {
    const r = evaluateDealSideBet('perfectPairs', pair('8S', '8S'), c('2D'), false);
    expect(r.row?.pays).toBe(25);
  });
  it('paire colorée 12:1 (même couleur, enseignes différentes)', () => {
    const r = evaluateDealSideBet('perfectPairs', pair('8S', '8C'), c('2D'), false);
    expect(r.row?.pays).toBe(12);
  });
  it('paire mixte 6:1', () => {
    const r = evaluateDealSideBet('perfectPairs', pair('8S', '8H'), c('2D'), false);
    expect(r.row?.pays).toBe(6);
  });
  it('K + Q n\u2019est pas une paire', () => {
    const r = evaluateDealSideBet('perfectPairs', pair('KS', 'QS'), c('2D'), false);
    expect(r.row).toBeNull();
  });
});

describe('21+3', () => {
  it('brelan assorti 100:1', () => {
    const r = evaluateDealSideBet('twentyOnePlusThree', pair('7S', '7S'), c('7S'), false);
    expect(r.row?.pays).toBe(100);
  });
  it('quinte flush 40:1', () => {
    const r = evaluateDealSideBet('twentyOnePlusThree', pair('5H', '6H'), c('7H'), false);
    expect(r.row?.pays).toBe(40);
  });
  it('brelan 30:1', () => {
    const r = evaluateDealSideBet('twentyOnePlusThree', pair('7S', '7H'), c('7D'), false);
    expect(r.row?.pays).toBe(30);
  });
  it('quinte 10:1 (non assortie)', () => {
    const r = evaluateDealSideBet('twentyOnePlusThree', pair('5H', '6S'), c('7D'), false);
    expect(r.row?.pays).toBe(10);
  });
  it('quinte à l\u2019As haut (Q-K-A)', () => {
    const r = evaluateDealSideBet('twentyOnePlusThree', pair('QH', 'KS'), c('AD'), false);
    expect(r.row?.pays).toBe(10);
  });
  it('quinte à l\u2019As bas (A-2-3)', () => {
    const r = evaluateDealSideBet('twentyOnePlusThree', pair('AH', '2S'), c('3D'), false);
    expect(r.row?.pays).toBe(10);
  });
  it('pas de tour du roi (K-A-2 ne compte pas)', () => {
    const r = evaluateDealSideBet('twentyOnePlusThree', pair('KH', 'AS'), c('2D'), false);
    expect(r.row).toBeNull();
  });
  it('couleur 5:1', () => {
    const r = evaluateDealSideBet('twentyOnePlusThree', pair('2H', '9H'), c('KH'), false);
    expect(r.row?.pays).toBe(5);
  });
  it('rien : perdu', () => {
    const r = evaluateDealSideBet('twentyOnePlusThree', pair('2H', '9S'), c('KD'), false);
    expect(r.row).toBeNull();
  });
});

describe('Lucky Ladies', () => {
  it('paire de Dames de cœur + BJ croupier : 1000:1', () => {
    const r = evaluateDealSideBet('luckyLadies', pair('QH', 'QH'), c('AD'), true);
    expect(r.row?.pays).toBe(1000);
  });
  it('paire de Dames de cœur sans BJ croupier : 125:1', () => {
    const r = evaluateDealSideBet('luckyLadies', pair('QH', 'QH'), c('AD'), false);
    expect(r.row?.pays).toBe(125);
  });
  it('20 identique (même rang et enseigne) : 19:1', () => {
    const r = evaluateDealSideBet('luckyLadies', pair('KD', 'KD'), c('5S'), false);
    expect(r.row?.pays).toBe(19);
  });
  it('20 assorti : 9:1', () => {
    const r = evaluateDealSideBet('luckyLadies', pair('KD', '10D'), c('5S'), false);
    expect(r.row?.pays).toBe(9);
  });
  it('20 quelconque : 4:1', () => {
    const r = evaluateDealSideBet('luckyLadies', pair('KD', 'JS'), c('5S'), false);
    expect(r.row?.pays).toBe(4);
  });
  it('soft 20 (A+9) ne compte pas : l\u2019As vaut 1 ou 11, pas 10+10', () => {
    // Lucky Ladies exige un total de 20 en valeur de comptage (A=1) : A+9 = 10.
    const r = evaluateDealSideBet('luckyLadies', pair('AD', '9D'), c('5S'), false);
    expect(r.row).toBeNull();
  });
  it('19 ou 21 ne comptent pas', () => {
    expect(evaluateDealSideBet('luckyLadies', pair('KD', '9S'), c('5S'), false).row).toBeNull();
    expect(evaluateDealSideBet('luckyLadies', pair('KD', 'AS'), c('5S'), false).row).toBeNull();
  });
});

describe('Bust It', () => {
  const cards = (n: number) => Array.from({ length: n }, (_, i) => c('5S', `5S-${i}`));
  it('perd si le croupier ne saute pas', () => {
    expect(evaluateBustIt(cards(5), false).row).toBeNull();
  });
  it('3 ou 4 cartes : 2:1', () => {
    expect(evaluateBustIt(cards(3), true).row?.pays).toBe(2);
    expect(evaluateBustIt(cards(4), true).row?.pays).toBe(2);
  });
  it('5 cartes : 4:1 · 6 cartes : 18:1 · 7 cartes : 50:1 · 8+ : 250:1', () => {
    expect(evaluateBustIt(cards(5), true).row?.pays).toBe(4);
    expect(evaluateBustIt(cards(6), true).row?.pays).toBe(18);
    expect(evaluateBustIt(cards(7), true).row?.pays).toBe(50);
    expect(evaluateBustIt(cards(8), true).row?.pays).toBe(250);
    expect(evaluateBustIt(cards(9), true).row?.pays).toBe(250);
  });
});

describe('Royal Match', () => {
  it('mariage royal (K+Q assortis) : 25:1', () => {
    expect(evaluateDealSideBet('royalMatch', pair('KH', 'QH'), c('2D'), false).row?.pays).toBe(25);
    expect(evaluateDealSideBet('royalMatch', pair('QS', 'KS'), c('2D'), false).row?.pays).toBe(25);
  });
  it('deux cartes assorties : 5:2', () => {
    expect(evaluateDealSideBet('royalMatch', pair('2H', '9H'), c('2D'), false).row?.pays).toBe(2.5);
  });
  it('non assorties : perdu', () => {
    expect(evaluateDealSideBet('royalMatch', pair('KH', 'QS'), c('2D'), false).row).toBeNull();
  });
});

describe('intégration side bets dans une manche', () => {
  const RULES = getTable('emeraude').rules;
  const ALL_SIDE_BETS_RULES: RulesConfig = {
    ...RULES,
    sideBets: ['perfectPairs', 'twentyOnePlusThree', 'luckyLadies', 'bustIt', 'royalMatch'],
  };
  const rig = (codes: string[]) => new RiggedShoe(codes.map((cd, i) => card(cd, `${cd}-${i}`)));
  const bet = (main: number, sideBets: BetLayout['sideBets']): BetLayout => ({ main, sideBets });

  it('les side bets à la donne sont payés même si la main principale perd', () => {
    // Joueur 8♠ 8♥ (paire mixte 6:1), croupier 10♦ + 10♣ = 20. Joueur reste sur 16 : perd.
    const r = new Round(
      RULES,
      rig(['8S', '10D', '8H', '10C']),
      bet(10_00, { perfectPairs: 2_00 }),
    );
    r.stand();
    const res = r.result!;
    expect(res.hands[0].outcome).toBe('lose');
    const pp = res.sideBets.find((b) => b.id === 'perfectPairs')!;
    expect(pp.paysMultiplier).toBe(6);
    expect(pp.returned).toBe(14_00); // 2 + 12
    expect(res.totalNet).toBe(14_00 - 10_00 - 2_00);
  });

  it('Royal Match 5:2 arrondi correctement au centime', () => {
    // 2♥ 9♥ assortis : 5:2 sur 3,33 → 3.33*2.5 = 8.325 → 8.33
    const r = new Round(
      ALL_SIDE_BETS_RULES,
      rig(['2H', '10D', '9H', '9C', '5S']),
      bet(10_00, { royalMatch: 3_33 }),
    );
    r.hit(); // 11 + 5 = 16
    r.stand();
    const rm = r.result!.sideBets.find((b) => b.id === 'royalMatch')!;
    expect(rm.returned).toBe(3_33 + Math.round(3_33 * 2.5)); // 333 + 833 = 1166
  });

  it('Lucky Ladies 1000:1 : Q♥ Q♥ face à un blackjack croupier', () => {
    const r = new Round(
      ALL_SIDE_BETS_RULES,
      rig(['QH', 'AD', 'QH', 'KC']),
      bet(10_00, { luckyLadies: 1_00 }),
    );
    r.resolveInsurance(0);
    const res = r.result!;
    expect(res.hands[0].outcome).toBe('lose'); // 20 contre BJ croupier
    const ll = res.sideBets.find((b) => b.id === 'luckyLadies')!;
    expect(ll.paysMultiplier).toBe(1000);
    expect(ll.returned).toBe(1001_00);
  });

  it('side bet perdant : mise perdue, comptabilisée dans le net', () => {
    const r = new Round(
      RULES,
      rig(['2H', '10D', '9S', '9C', 'KS']),
      bet(10_00, { perfectPairs: 5_00, twentyOnePlusThree: 5_00 }),
    );
    r.hit(); // 11 + K = 21 auto-stand ; croupier 19 : joueur gagne
    const res = r.result!;
    expect(res.hands[0].outcome).toBe('win');
    expect(res.sideBets.every((b) => b.returned === 0)).toBe(true);
    expect(res.totalNet).toBe(10_00 - 5_00 - 5_00);
  });
});
