import { describe, expect, it } from 'vitest';
import { card } from '../cards';
import { Round } from '../round';
import { getTable, type RulesConfig } from '../rules';
import { RiggedShoe } from '../shoe';
import type { BetLayout } from '../types';

/**
 * Sabot truqué : ordre de donne = J1, croupier visible, J2, croupier cachée,
 * puis toutes les cartes tirées ensuite (joueur puis croupier).
 */
function rig(codes: string[]) {
  return new RiggedShoe(codes.map((c, i) => card(c, `${c}-${i}`)));
}

const RULES: RulesConfig = getTable('emeraude').rules; // 6 jeux, S17, surrender, DAS
/** Règles étendues pour tester les side bets retirés de l’UI mais encore dans le moteur. */
const ALL_SIDE_BETS_RULES: RulesConfig = {
  ...RULES,
  sideBets: ['perfectPairs', 'twentyOnePlusThree', 'luckyLadies', 'bustIt', 'royalMatch'],
};
const H17_RULES: RulesConfig = getTable('onyx').rules;
const RSA_RULES: RulesConfig = getTable('imperiale').rules; // re-split des As

const bet = (main: number, sideBets: BetLayout['sideBets'] = {}): BetLayout => ({ main, sideBets });

describe('donne et blackjacks naturels', () => {
  it('paie le blackjack joueur 3:2', () => {
    // Joueur : A♠ K♥ — Croupier : 9♦ 5♣ (pas de tour croupier nécessaire)
    const r = new Round(RULES, rig(['AS', '9D', 'KH', '5C']), bet(10_00));
    expect(r.phase).toBe('settled');
    const res = r.result!;
    expect(res.hands[0].outcome).toBe('blackjack');
    expect(res.hands[0].returned).toBe(25_00); // 10 + 15
    expect(res.totalNet).toBe(15_00);
  });

  it('blackjack 3:2 exact sur mise impaire (centimes)', () => {
    const r = new Round(RULES, rig(['AS', '9D', 'KH', '5C']), bet(5_00));
    expect(r.result!.hands[0].returned).toBe(12_50);
  });

  it('BJ joueur contre BJ croupier = push', () => {
    // Croupier montre 10, hole As -> peek révèle le BJ, pas d'assurance offerte.
    const r = new Round(RULES, rig(['AS', '10D', 'KH', 'AC']), bet(10_00));
    expect(r.isInsuranceOffered).toBe(false);
    expect(r.phase).toBe('settled');
    expect(r.result!.hands[0].outcome).toBe('push');
    expect(r.result!.hands[0].returned).toBe(10_00);
  });

  it('BJ croupier (10 visible) : le joueur perd sans jouer', () => {
    const r = new Round(RULES, rig(['9S', '10D', '8H', 'AC']), bet(10_00));
    expect(r.phase).toBe('settled');
    expect(r.result!.hands[0].outcome).toBe('lose');
    expect(r.result!.dealerBlackjack).toBe(true);
    expect(r.result!.totalReturned).toBe(0);
  });

  it('21 en trois cartes perd contre un blackjack naturel', () => {
    // Croupier A visible + K cachée = BJ. Le joueur ne joue jamais.
    const r = new Round(RULES, rig(['7S', 'AD', '7H', 'KC']), bet(10_00));
    expect(r.phase).toBe('insurance');
    r.resolveInsurance(0);
    expect(r.result!.hands[0].outcome).toBe('lose');
  });
});

describe('assurance et even money', () => {
  it('assurance gagnée payée 2:1 quand le croupier a un blackjack', () => {
    const r = new Round(RULES, rig(['9S', 'AD', '8H', 'KC']), bet(10_00));
    expect(r.phase).toBe('insurance');
    expect(r.maxInsurance).toBe(5_00);
    r.resolveInsurance(5_00);
    const res = r.result!;
    expect(res.insurance).toEqual({ bet: 5_00, won: true, returned: 15_00, net: 10_00 });
    expect(res.hands[0].outcome).toBe('lose');
    // Net de la manche : -10 (main) + 10 (assurance) = 0
    expect(res.totalNet).toBe(0);
  });

  it('assurance perdue quand le croupier n\u2019a pas de blackjack', () => {
    // Joueur 10+K = 20 ; croupier A+8 = 19 soft (S17 : il reste).
    const r = new Round(RULES, rig(['10S', 'AD', 'KH', '8C']), bet(10_00));
    r.resolveInsurance(5_00);
    expect(r.phase).toBe('player');
    r.stand();
    const res = r.result!;
    expect(res.insurance!.won).toBe(false);
    expect(res.insurance!.net).toBe(-5_00);
    expect(res.hands[0].outcome).toBe('win'); // 20 contre 19
  });

  it('even money paie 1:1 immédiatement, même si le croupier a un BJ', () => {
    const r = new Round(RULES, rig(['AS', 'AD', 'KH', 'QC']), bet(10_00));
    expect(r.canTakeEvenMoney).toBe(true);
    r.takeEvenMoney();
    const res = r.result!;
    expect(res.hands[0].outcome).toBe('evenMoney');
    expect(res.hands[0].returned).toBe(20_00);
    expect(res.dealerBlackjack).toBe(true);
  });

  it('even money refusé : BJ contre BJ = push', () => {
    const r = new Round(RULES, rig(['AS', 'AD', 'KH', 'QC']), bet(10_00));
    r.resolveInsurance(0);
    expect(r.result!.hands[0].outcome).toBe('push');
  });

  it('even money refusé : BJ payé 3:2 si le croupier n\u2019a pas de BJ', () => {
    const r = new Round(RULES, rig(['AS', 'AD', 'KH', '5C']), bet(10_00));
    r.resolveInsurance(0);
    expect(r.result!.hands[0].outcome).toBe('blackjack');
    expect(r.result!.hands[0].returned).toBe(25_00);
  });

  it('refuse une assurance supérieure à la moitié de la mise', () => {
    const r = new Round(RULES, rig(['10S', 'AD', '9H', '8C']), bet(10_00));
    expect(() => r.resolveInsurance(5_01)).toThrow();
  });
});

describe('hit / stand / bust', () => {
  it('le joueur qui saute perd, le croupier ne tire pas', () => {
    // Joueur 10+9, tire un 5 -> 24 bust. Croupier 10+7 reste tel quel.
    const r = new Round(RULES, rig(['10S', '10D', '9H', '7C', '5S']), bet(10_00));
    r.hit();
    expect(r.phase).toBe('settled');
    expect(r.result!.hands[0].outcome).toBe('lose');
    expect(r.result!.dealerCards.length).toBe(2);
  });

  it('atteindre 21 par tirage passe automatiquement', () => {
    // Joueur 10+9 tire 2 -> 21 auto-stand ; croupier 10+7 = 17 -> joueur gagne.
    const r = new Round(RULES, rig(['10S', '10D', '9H', '7C', '2S']), bet(10_00));
    r.hit();
    expect(r.phase).toBe('settled');
    expect(r.result!.hands[0].outcome).toBe('win');
  });

  it('push sur égalité', () => {
    const r = new Round(RULES, rig(['10S', '10D', '8H', '8C']), bet(10_00));
    r.stand();
    expect(r.result!.hands[0].outcome).toBe('push');
    expect(r.result!.hands[0].returned).toBe(10_00);
  });

  it('le croupier tire jusqu\u2019à 17 et saute', () => {
    // Croupier 6+6=12 tire K -> 22 bust.
    const r = new Round(RULES, rig(['10S', '6D', '9H', '6C', 'KS']), bet(10_00));
    r.stand();
    const res = r.result!;
    expect(res.dealerBust).toBe(true);
    expect(res.hands[0].outcome).toBe('win');
    expect(res.hands[0].returned).toBe(20_00);
  });
});

describe('règle soft 17', () => {
  it('S17 : le croupier reste sur A+6', () => {
    const r = new Round(RULES, rig(['10S', 'AD', '8H', '6C']), bet(10_00));
    r.resolveInsurance(0);
    r.stand();
    expect(r.result!.dealerCards.length).toBe(2);
    expect(r.result!.dealerTotal).toBe(17);
    expect(r.result!.hands[0].outcome).toBe('win'); // 18 > 17
  });

  it('H17 : le croupier tire sur A+6', () => {
    const r = new Round(H17_RULES, rig(['10S', 'AD', '8H', '6C', '4S']), bet(25_00));
    r.resolveInsurance(0);
    r.stand();
    expect(r.result!.dealerCards.length).toBe(3);
    expect(r.result!.dealerTotal).toBe(21);
    expect(r.result!.hands[0].outcome).toBe('lose');
  });

  it('H17 : le croupier reste sur 17 dur', () => {
    const r = new Round(H17_RULES, rig(['10S', '10D', '8H', '7C']), bet(25_00));
    r.stand();
    expect(r.result!.dealerCards.length).toBe(2);
  });
});

describe('double', () => {
  it('double la mise, une seule carte, paiement correct', () => {
    // Joueur 6+5=11 double, reçoit 10 -> 21. Croupier 10+8=18.
    const r = new Round(RULES, rig(['6S', '10D', '5H', '8C', '10S']), bet(10_00));
    expect(r.availableActions(100_00)).toContain('double');
    r.double();
    expect(r.phase).toBe('settled');
    const res = r.result!;
    expect(res.hands[0].bet).toBe(20_00);
    expect(res.hands[0].returned).toBe(40_00);
    expect(res.totalNet).toBe(20_00);
  });

  it('double perdant : la mise doublée est perdue', () => {
    // Joueur 6+5=11 double, reçoit 2 -> 13. Croupier 10+8=18.
    const r = new Round(RULES, rig(['6S', '10D', '5H', '8C', '2S']), bet(10_00));
    r.double();
    expect(r.result!.hands[0].net).toBe(-20_00);
  });

  it('double indisponible sans solde suffisant', () => {
    const r = new Round(RULES, rig(['6S', '10D', '5H', '8C', '2S']), bet(10_00));
    expect(r.availableActions(9_99)).not.toContain('double');
    expect(r.availableActions(10_00)).toContain('double');
  });

  it('double busté perd immédiatement', () => {
    // Joueur 10+9 double (any2), reçoit K -> 29 bust.
    const r = new Round(RULES, rig(['10S', '5D', '9H', '8C', 'KS', '10C']), bet(10_00));
    r.double();
    expect(r.result!.hands[0].outcome).toBe('lose');
    expect(r.result!.hands[0].bet).toBe(20_00);
  });
});

describe('split et re-split', () => {
  it('split de 8 : deux mains jouées séparément avec paiements distincts', () => {
    // Joueur 8♠ 8♥ contre 6. Split :
    //   main 1 : 8♠ + 10♦ = 18, stand
    //   main 2 : 8♥ + 3♣ = 11, hit 10♠ = 21, auto-stand
    // Croupier : 6♦ + 10♥ = 16, tire 4♦ = 20.
    const r = new Round(
      RULES,
      rig(['8S', '6D', '8H', '10H', '10D', '3C', '10S', '4D']),
      bet(10_00),
    );
    expect(r.availableActions(100_00)).toContain('split');
    r.split();
    expect(r.hands.length).toBe(2);
    r.stand(); // main 1 : 18
    expect(r.phase).toBe('player'); // main 2 : 8 + 3 = 11
    r.hit(); // 11 + 10 = 21, auto-stand
    expect(r.phase).toBe('settled');
    const res = r.result!;
    expect(res.hands[0].outcome).toBe('lose'); // 18 < 20
    expect(res.hands[1].outcome).toBe('win'); // 21 > 20
    expect(res.totalNet).toBe(0);
  });

  it('re-split jusqu\u2019à 4 mains puis interdiction', () => {
    // 8,8 -> split -> 8,8 -> split -> 8,8 -> split = 4 mains max.
    const r = new Round(
      RULES,
      rig(['8S', '10D', '8H', '7C', '8D', '8C', '2S', '3S', '4S', '5S']),
      bet(10_00),
    );
    r.split(); // mains : [8S+8D], [8H]
    expect(r.availableActions(1000_00)).toContain('split');
    r.split(); // mains : [8S+8C], [8D], [8H]
    expect(r.hands.length).toBe(3);
    r.split(); // 4 mains : plafond atteint
    expect(r.hands.length).toBe(4);
    expect(r.availableActions(1000_00)).not.toContain('split');
  });

  it('21 en deux cartes après split n\u2019est pas un blackjack (payé 1:1)', () => {
    // A♠ A♥ split. Main 1 : A♠ + K♦ = 21 (une carte, As splitté).
    // Main 2 : A♥ + 9♣ = 20. Croupier 10+8 = 18.
    const r = new Round(RULES, rig(['AS', '10D', 'AH', '8C', 'KD', '9C']), bet(10_00));
    r.split();
    expect(r.phase).toBe('settled'); // As splittés : une carte chacun, auto-stand
    const res = r.result!;
    expect(res.hands[0].outcome).toBe('win'); // 21 simple, pas blackjack
    expect(res.hands[0].returned).toBe(20_00); // 1:1 et non 3:2
    expect(res.hands[1].outcome).toBe('win');
  });

  it('As splittés : une seule carte, pas de hit possible', () => {
    const r = new Round(RULES, rig(['AS', '10D', 'AH', '8C', '5D', '9C']), bet(10_00));
    r.split();
    // Les deux mains sont automatiquement terminées.
    expect(r.phase).toBe('settled');
    expect(r.hands[0].cards.length).toBe(2);
    expect(r.hands[1].cards.length).toBe(2);
  });

  it('pas de re-split des As sur table Émeraude, autorisé sur Impériale', () => {
    // A,A split -> main 1 reçoit un As : re-split ?
    const seq = ['AS', '10D', 'AH', '8C', 'AD', '9C', '9D', '8H'];
    const r1 = new Round(RULES, rig(seq), bet(10_00));
    r1.split();
    // Émeraude : pas de re-split -> tout est auto-terminé.
    expect(r1.phase).toBe('settled');

    const r2 = new Round(RSA_RULES, rig(seq), bet(100_00));
    r2.split();
    expect(r2.phase).toBe('player');
    expect(r2.availableActions(10_000_00)).toContain('split');
  });

  it('double après split (DAS) autorisé', () => {
    // 8,8 contre 6 -> split. Main 1 : 8+3 = 11 -> double -> 10 = 21.
    const r = new Round(
      RULES,
      rig(['8S', '6D', '8H', '10C', '3D', '10S', '10D', 'KD']),
      bet(10_00),
    );
    r.split();
    expect(r.availableActions(1000_00)).toContain('double');
    r.double();
    // Main 2 : 8H + 10D = 18, stand. Croupier 6+10 = 16, tire K -> 26 bust.
    r.stand();
    const res = r.result!;
    expect(res.hands[0].bet).toBe(20_00);
    expect(res.hands[0].outcome).toBe('win');
    expect(res.hands[1].outcome).toBe('win');
    expect(res.totalNet).toBe(30_00);
  });

  it('split de K+Q autorisé (valeur 10 mixte)', () => {
    const r = new Round(RULES, rig(['KS', '6D', 'QH', '10C', '5D', '4S', '10D', 'KD']), bet(10_00));
    expect(r.availableActions(100_00)).toContain('split');
  });

  it('surrender indisponible après split', () => {
    const r = new Round(RULES, rig(['8S', '6D', '8H', '10C', '3D', '2C', '9D', 'KD']), bet(10_00));
    expect(r.availableActions(100_00)).toContain('surrender');
    r.split();
    expect(r.availableActions(100_00)).not.toContain('surrender');
  });
});

describe('surrender', () => {
  it('abandon : le joueur récupère la moitié de sa mise', () => {
    const r = new Round(RULES, rig(['10S', '10D', '6H', '9C']), bet(10_00));
    expect(r.availableActions(0)).toContain('surrender');
    r.surrender();
    expect(r.phase).toBe('settled');
    const res = r.result!;
    expect(res.hands[0].outcome).toBe('surrender');
    expect(res.hands[0].returned).toBe(5_00);
    expect(res.totalNet).toBe(-5_00);
  });

  it('abandon impossible après un hit', () => {
    const r = new Round(RULES, rig(['10S', '10D', '2H', '9C', '3S', '4C']), bet(10_00));
    r.hit();
    expect(r.availableActions(100_00)).not.toContain('surrender');
  });

  it('abandon non proposé sur la Suite Impériale', () => {
    const r = new Round(RSA_RULES, rig(['10S', '10D', '6H', '9C']), bet(100_00));
    expect(r.availableActions(0)).not.toContain('surrender');
  });

  it('late surrender : impossible contre un blackjack croupier (la main perd)', () => {
    // Croupier A + K : le peek règle la manche avant toute action.
    const r = new Round(RULES, rig(['10S', 'AD', '6H', 'KC']), bet(10_00));
    r.resolveInsurance(0);
    expect(r.phase).toBe('settled');
    expect(r.result!.hands[0].outcome).toBe('lose');
  });
});

describe('Bust It : procédure croupier', () => {
  it('le croupier complète sa main si Bust It est en jeu, même si le joueur a sauté', () => {
    // Joueur 10+9 tire 5 -> bust. Croupier 6+10 = 16 doit tirer : K -> 26 bust (3 cartes).
    const r = new Round(
      ALL_SIDE_BETS_RULES,
      rig(['10S', '6D', '9H', '10C', '5S', 'KD']),
      bet(10_00, { bustIt: 5_00 }),
    );
    r.hit();
    const res = r.result!;
    expect(res.dealerBust).toBe(true);
    const bust = res.sideBets.find((b) => b.id === 'bustIt')!;
    expect(bust.paysMultiplier).toBe(2);
    expect(bust.returned).toBe(15_00);
    expect(res.hands[0].outcome).toBe('lose');
  });

  it('sans Bust It, le croupier ne tire pas quand tout le monde a sauté', () => {
    const r = new Round(RULES, rig(['10S', '6D', '9H', '10C', '5S']), bet(10_00));
    r.hit();
    expect(r.result!.dealerCards.length).toBe(2);
  });
});

describe('validation des mises', () => {
  it('rejette une mise principale hors limites', () => {
    expect(() => new Round(RULES, rig(['AS', '9D', 'KH', '5C']), bet(1_00))).toThrow();
    expect(() => new Round(RULES, rig(['AS', '9D', 'KH', '5C']), bet(501_00))).toThrow();
  });

  it('rejette un side bet hors limites', () => {
    expect(
      () => new Round(RULES, rig(['AS', '9D', 'KH', '5C']), bet(10_00, { perfectPairs: 101_00 })),
    ).toThrow();
  });
});

describe('cohérence comptable', () => {
  it('totalReturned - totalWagered = totalNet sur une manche complexe', () => {
    // Split + double + side bets, tout mélangé.
    const r = new Round(
      ALL_SIDE_BETS_RULES,
      rig(['8S', '6D', '8H', '10C', '3D', '10S', '10D', 'KD']),
      bet(10_00, { perfectPairs: 2_00, bustIt: 3_00 }),
    );
    r.split();
    r.double();
    r.stand();
    const res = r.result!;
    expect(res.totalNet).toBe(res.totalReturned - res.totalWagered);
    // Mises : 10 + 10 (split) + 10 (double) + 2 + 3 = 35.
    expect(res.totalWagered).toBe(35_00);
  });
});
