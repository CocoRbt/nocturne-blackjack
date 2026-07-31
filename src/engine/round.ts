import { dealerMustHit, handValue, isNaturalBlackjack, isPair } from './hand';
import { applyRatio, type RulesConfig } from './rules';
import { evaluateBustIt, evaluateDealSideBet, SIDE_BET_DEFS } from './sidebets';
import type { Shoe } from './shoe';
import type {
  BetLayout,
  Card,
  HandOutcome,
  HandResult,
  InsuranceResult,
  PlayerActionType,
  PlayerHandState,
  RoundPhase,
  RoundSummary,
  SideBetId,
  SideBetResult,
} from './types';

/**
 * Machine à états d'une manche de blackjack. Pure logique : aucune notion
 * d'interface. Le solde du joueur est géré par l'appelant ; le moteur expose
 * le coût des actions (double, split, assurance) et un résumé de règlement.
 *
 * Déroulé : dealing → (insurance) → player → dealer → settled
 */
export class Round {
  phase: RoundPhase = 'dealing';
  dealerCards: Card[] = [];
  holeRevealed = false;
  hands: PlayerHandState[] = [];
  activeHandIndex = 0;

  insuranceBet: number | null = null; // null = pas encore décidé
  private insuranceOffered = false;
  private evenMoneyTaken = false;

  /** Résultats des side bets résolus à la donne. */
  dealSideBetResults: SideBetResult[] = [];
  private bustItBet = 0;
  private summary: RoundSummary | null = null;

  /** Montants rendus tôt (blackjack payé, abandon) mémorisés par main. */
  private earlyReturns = new Map<number, { outcome: HandOutcome; returned: number }>();

  private readonly dealerBlackjack: boolean;

  readonly rules: RulesConfig;
  private readonly shoe: Shoe;
  readonly bets: BetLayout;

  constructor(rules: RulesConfig, shoe: Shoe, bets: BetLayout) {
    this.rules = rules;
    this.shoe = shoe;
    this.bets = bets;
    if (bets.main < rules.minBet || bets.main > rules.maxBet) {
      throw new Error('Mise principale hors limites');
    }
    for (const [id, amount] of Object.entries(bets.sideBets)) {
      if (amount === undefined || amount === 0) continue;
      if (!rules.sideBets.includes(id as SideBetId)) throw new Error(`Side bet non proposé : ${id}`);
      if (amount < rules.sideBetMin || amount > rules.sideBetMax) {
        throw new Error(`Side bet ${id} hors limites`);
      }
    }
    this.bustItBet = bets.sideBets.bustIt ?? 0;

    // Donne : joueur, croupier (visible), joueur, croupier (cachée).
    const p1 = shoe.draw();
    const up = shoe.draw();
    const p2 = shoe.draw();
    const hole = shoe.draw();
    this.dealerCards = [up, hole];
    this.hands = [
      {
        cards: [p1, p2],
        bet: bets.main,
        fromSplit: false,
        fromSplitAces: false,
        doubled: false,
        surrendered: false,
        stood: false,
        settledEarly: false,
      },
    ];

    this.dealerBlackjack = isNaturalBlackjack(this.dealerCards, false);

    // Side bets résolus à la donne (le peek rend le BJ croupier connu).
    for (const id of Object.keys(bets.sideBets) as SideBetId[]) {
      const amount = bets.sideBets[id] ?? 0;
      if (amount <= 0 || id === 'bustIt') continue;
      const { row } = evaluateDealSideBet(id, [p1, p2], up, this.dealerBlackjack);
      const returned = row ? amount + Math.round(amount * row.pays) : 0;
      this.dealSideBetResults.push({
        id,
        bet: amount,
        label: row?.label ?? null,
        paysMultiplier: row?.pays ?? 0,
        returned,
        net: returned - amount,
      });
    }

    // Assurance proposée uniquement sur As visible.
    if (up.rank === 'A') {
      this.insuranceOffered = true;
      this.phase = 'insurance';
      return;
    }

    // Peek silencieux sur 10 visible (hole card américaine).
    this.afterInsuranceResolved();
  }

  get dealerUpCard(): Card {
    return this.dealerCards[0];
  }

  get activeHand(): PlayerHandState | null {
    return this.phase === 'player' ? this.hands[this.activeHandIndex] : null;
  }

  get isInsuranceOffered(): boolean {
    return this.insuranceOffered;
  }

  /** Even money possible : blackjack joueur face à un As visible. */
  get canTakeEvenMoney(): boolean {
    return (
      this.phase === 'insurance' &&
      isNaturalBlackjack(this.hands[0].cards, false) &&
      !this.evenMoneyTaken
    );
  }

  get maxInsurance(): number {
    return Math.floor(this.bets.main / 2);
  }

  get result(): RoundSummary | null {
    return this.summary;
  }

  /** Décision d'assurance : montant 0 = refus. */
  resolveInsurance(amount: number): void {
    if (this.phase !== 'insurance') throw new Error('Assurance non proposée');
    if (amount < 0 || amount > this.maxInsurance) throw new Error('Montant d\u2019assurance invalide');
    this.insuranceBet = amount;
    this.afterInsuranceResolved();
  }

  /** Even money : blackjack payé 1:1 immédiatement, avant le peek. */
  takeEvenMoney(): void {
    if (!this.canTakeEvenMoney) throw new Error('Even money indisponible');
    this.evenMoneyTaken = true;
    this.insuranceBet = 0;
    const bet = this.hands[0].bet;
    this.hands[0].settledEarly = true;
    this.earlyReturns.set(0, { outcome: 'evenMoney', returned: bet * 2 });
    this.afterInsuranceResolved();
  }

  private afterInsuranceResolved(): void {
    if (this.dealerBlackjack) {
      this.holeRevealed = true;
      this.settle();
      return;
    }

    // Pas de BJ croupier : un blackjack joueur est payé 3:2 immédiatement.
    const hand = this.hands[0];
    if (!hand.settledEarly && isNaturalBlackjack(hand.cards, false)) {
      hand.settledEarly = true;
      const winnings = applyRatio(hand.bet, this.rules.blackjackPays);
      this.earlyReturns.set(0, { outcome: 'blackjack', returned: hand.bet + winnings });
    }

    if (hand.settledEarly) {
      this.goToDealer();
      return;
    }
    this.phase = 'player';
    this.activeHandIndex = 0;
  }

  /** Actions disponibles pour la main active, filtrées par le solde restant. */
  availableActions(balance: number): PlayerActionType[] {
    if (this.phase !== 'player') return [];
    const hand = this.hands[this.activeHandIndex];
    const actions: PlayerActionType[] = [];
    const value = handValue(hand.cards);
    const isTwoCards = hand.cards.length === 2;

    const splitAceLocked =
      hand.fromSplitAces && this.rules.splitAcesOneCard;

    if (!splitAceLocked) {
      actions.push('hit');
    }
    actions.push('stand');

    if (isTwoCards && !splitAceLocked && balance >= hand.bet) {
      const doubleAllowed =
        this.rules.doubleOn === 'any2' || (value.total >= 9 && value.total <= 11 && !value.soft);
      const dasOk = !hand.fromSplit || this.rules.doubleAfterSplit;
      if (doubleAllowed && dasOk) actions.push('double');
    }

    if (
      isTwoCards &&
      isPair(hand.cards, this.rules.splitMixedTens) &&
      this.hands.length < this.rules.maxSplitHands &&
      balance >= hand.bet
    ) {
      const isAces = hand.cards[0].rank === 'A' && hand.cards[1].rank === 'A';
      const acesOk = !isAces || !hand.fromSplitAces || this.rules.resplitAces;
      if (acesOk) actions.push('split');
    }

    if (
      this.rules.lateSurrender &&
      this.hands.length === 1 &&
      isTwoCards &&
      !hand.fromSplit &&
      !hand.doubled
    ) {
      actions.push('surrender');
    }

    return actions;
  }

  hit(): void {
    const hand = this.requireActive();
    hand.cards.push(this.shoe.draw());
    const v = handValue(hand.cards);
    if (v.bust || v.total === 21) {
      hand.stood = !v.bust;
      this.advance();
    }
  }

  stand(): void {
    const hand = this.requireActive();
    hand.stood = true;
    this.advance();
  }

  /** Double : l'appelant doit avoir débité `hand.bet` supplémentaire. */
  double(): void {
    const hand = this.requireActive();
    if (hand.cards.length !== 2) throw new Error('Double impossible');
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(this.shoe.draw());
    hand.stood = !handValue(hand.cards).bust;
    this.advance();
  }

  /** Split : l'appelant doit avoir débité `hand.bet` supplémentaire. */
  split(): void {
    const hand = this.requireActive();
    if (!isPair(hand.cards, this.rules.splitMixedTens)) throw new Error('Split impossible');
    if (this.hands.length >= this.rules.maxSplitHands) throw new Error('Nombre de mains maximal atteint');

    const isAces = hand.cards[0].rank === 'A' && hand.cards[1].rank === 'A';
    const second = hand.cards.pop()!;
    const newHand: PlayerHandState = {
      cards: [second],
      bet: this.bets.main,
      fromSplit: true,
      fromSplitAces: isAces,
      doubled: false,
      surrendered: false,
      stood: false,
      settledEarly: false,
    };
    hand.fromSplit = true;
    hand.fromSplitAces = isAces;
    this.hands.splice(this.activeHandIndex + 1, 0, newHand);

    // La main courante reçoit immédiatement sa seconde carte.
    this.dealToActiveSplitHand();
  }

  surrender(): void {
    const hand = this.requireActive();
    if (!this.rules.lateSurrender) throw new Error('Abandon non autorisé');
    hand.surrendered = true;
    hand.settledEarly = true;
    this.earlyReturns.set(this.activeHandIndex, {
      outcome: 'surrender',
      returned: Math.round(hand.bet / 2),
    });
    this.advance();
  }

  private requireActive(): PlayerHandState {
    if (this.phase !== 'player') throw new Error('Aucune main active');
    return this.hands[this.activeHandIndex];
  }

  /** Donne la 2e carte à une main issue d'un split, gère la règle des As. */
  private dealToActiveSplitHand(): void {
    const hand = this.hands[this.activeHandIndex];
    hand.cards.push(this.shoe.draw());

    if (hand.fromSplitAces && this.rules.splitAcesOneCard) {
      // Une seule carte, sauf re-split possible sur une nouvelle paire d'As.
      const canResplit =
        this.rules.resplitAces &&
        hand.cards[1].rank === 'A' &&
        this.hands.length < this.rules.maxSplitHands;
      if (!canResplit) {
        hand.stood = true;
        this.advance();
        return;
      }
    }
    if (handValue(hand.cards).total === 21) {
      hand.stood = true;
      this.advance();
    }
  }

  /** Passe à la main suivante non terminée, sinon au croupier. */
  private advance(): void {
    for (let i = this.activeHandIndex; i < this.hands.length; i++) {
      const h = this.hands[i];
      const done = h.stood || h.surrendered || h.settledEarly || handValue(h.cards).bust;
      if (!done) {
        this.activeHandIndex = i;
        if (h.cards.length === 1) {
          // Main issue d'un split qui devient active : elle reçoit sa carte.
          this.dealToActiveSplitHand();
        }
        return;
      }
    }
    this.goToDealer();
  }

  private goToDealer(): void {
    this.phase = 'dealer';
    this.holeRevealed = true;

    const hasLiveHand = this.hands.some(
      (h) => !h.surrendered && !h.settledEarly && !handValue(h.cards).bust,
    );
    // Le croupier complète sa main s'il reste une main vivante,
    // ou si un pari Bust It est en jeu (procédure Buster Blackjack).
    if (hasLiveHand || this.bustItBet > 0) {
      while (dealerMustHit(this.dealerCards, this.rules.dealerHitsSoft17)) {
        this.dealerCards.push(this.shoe.draw());
      }
    }
    this.settle();
  }

  private settle(): void {
    const dealerV = handValue(this.dealerCards);
    const dealerBust = dealerV.bust;
    this.holeRevealed = true;

    const handResults: HandResult[] = this.hands.map((hand, i) => {
      const early = this.earlyReturns.get(i);
      if (early) {
        return {
          handIndex: i,
          outcome: early.outcome,
          bet: hand.bet,
          returned: early.returned,
          net: early.returned - hand.bet,
        };
      }
      const v = handValue(hand.cards);
      let outcome: HandOutcome;
      let returned: number;
      if (this.dealerBlackjack) {
        // Seul cas restant possible ici : le joueur n'a pas even money.
        if (isNaturalBlackjack(hand.cards, hand.fromSplit)) {
          outcome = 'push';
          returned = hand.bet;
        } else {
          outcome = 'lose';
          returned = 0;
        }
      } else if (v.bust) {
        outcome = 'lose';
        returned = 0;
      } else if (dealerBust || v.total > dealerV.total) {
        outcome = 'win';
        returned = hand.bet * 2;
      } else if (v.total === dealerV.total) {
        outcome = 'push';
        returned = hand.bet;
      } else {
        outcome = 'lose';
        returned = 0;
      }
      return { handIndex: i, outcome, bet: hand.bet, returned, net: returned - hand.bet };
    });

    const sideBetResults: SideBetResult[] = [...this.dealSideBetResults];
    if (this.bustItBet > 0) {
      const { row } = evaluateBustIt(this.dealerCards, dealerBust);
      const returned = row ? this.bustItBet + Math.round(this.bustItBet * row.pays) : 0;
      sideBetResults.push({
        id: 'bustIt',
        bet: this.bustItBet,
        label: row?.label ?? null,
        paysMultiplier: row?.pays ?? 0,
        returned,
        net: returned - this.bustItBet,
      });
    }

    let insurance: InsuranceResult | null = null;
    if (this.insuranceBet !== null && this.insuranceBet > 0) {
      const won = this.dealerBlackjack;
      const returned = won
        ? this.insuranceBet + applyRatio(this.insuranceBet, this.rules.insurancePays)
        : 0;
      insurance = { bet: this.insuranceBet, won, returned, net: returned - this.insuranceBet };
    }

    const totalWagered =
      handResults.reduce((s, h) => s + h.bet, 0) +
      sideBetResults.reduce((s, b) => s + b.bet, 0) +
      (insurance?.bet ?? 0);
    const totalReturned =
      handResults.reduce((s, h) => s + h.returned, 0) +
      sideBetResults.reduce((s, b) => s + b.returned, 0) +
      (insurance?.returned ?? 0);

    this.summary = {
      hands: handResults,
      sideBets: sideBetResults,
      insurance,
      dealerCards: this.dealerCards,
      dealerTotal: dealerV.total,
      dealerBust,
      dealerBlackjack: this.dealerBlackjack,
      totalReturned,
      totalNet: totalReturned - totalWagered,
      totalWagered,
    };
    this.phase = 'settled';
  }

  /** Nom du side bet (pour messages). */
  static sideBetName(id: SideBetId): string {
    return SIDE_BET_DEFS[id].name;
  }
}
