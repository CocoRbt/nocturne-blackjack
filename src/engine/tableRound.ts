import { handValue, isNaturalBlackjack, isPair } from './hand';
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
  SideBetId,
  SideBetResult,
} from './types';

export interface TableSeatInput {
  seatIndex: number;
  bets: BetLayout;
}

export type SeatHandResult = HandResult & { seatIndex: number };
export type SeatSideBetResult = SideBetResult & { seatIndex: number };
export type SeatInsuranceResult = InsuranceResult & { seatIndex: number };

export interface TableSeatSummary {
  seatIndex: number;
  hands: SeatHandResult[];
  sideBets: SeatSideBetResult[];
  insurance: SeatInsuranceResult | null;
  totalReturned: number;
  totalNet: number;
  totalWagered: number;
}

export interface TableRoundSummary {
  seats: TableSeatSummary[];
  hands: SeatHandResult[];
  sideBets: SeatSideBetResult[];
  insurance: SeatInsuranceResult[];
  dealerCards: Card[];
  dealerTotal: number;
  dealerBust: boolean;
  dealerBlackjack: boolean;
  totalReturned: number;
  totalNet: number;
  totalWagered: number;
}

export interface TableSeatRoundState {
  seatIndex: number;
  bets: BetLayout;
  hands: PlayerHandState[];
  activeHandIndex: number;
  insuranceBet: number | null;
  isInsuranceOffered: boolean;
  evenMoneyTaken: boolean;
  dealSideBetResults: SeatSideBetResult[];
}

interface InternalSeatState extends TableSeatRoundState {
  bustItBet: number;
  earlyReturns: Map<number, { outcome: HandOutcome; returned: number }>;
}

export function maxSeatsForOrientation(landscape: boolean): 5 | 7 {
  return landscape ? 7 : 5;
}

/**
 * Multi-seat blackjack round state machine. Seats share one dealer hand, while
 * each occupied seat owns its own main bet, side bets, splits, insurance, and
 * hand settlement.
 */
export class TableRound {
  phase: RoundPhase = 'dealing';
  dealerCards: Card[] = [];
  holeRevealed = false;
  readonly seats: TableSeatRoundState[] = [];

  private activeSeatCursor = 0;
  private insuranceSeatCursor = 0;
  private summary: TableRoundSummary | null = null;
  private readonly dealerBlackjack: boolean;

  readonly rules: RulesConfig;
  private readonly shoe: Shoe;

  constructor(rules: RulesConfig, shoe: Shoe, seats: TableSeatInput[]) {
    this.rules = rules;
    this.shoe = shoe;
    this.seats = this.validateAndBuildSeats(seats);

    const firstCards = this.seats.map(() => shoe.draw());
    const up = shoe.draw();
    const secondCards = this.seats.map(() => shoe.draw());
    const hole = shoe.draw();
    this.dealerCards = [up, hole];

    this.seats.forEach((seat, i) => {
      seat.hands = [
        {
          cards: [firstCards[i], secondCards[i]],
          bet: seat.bets.main,
          fromSplit: false,
          fromSplitAces: false,
          doubled: false,
          surrendered: false,
          stood: false,
          settledEarly: false,
        },
      ];
    });

    this.dealerBlackjack = isNaturalBlackjack(this.dealerCards, false);
    this.resolveDealSideBets(up);

    if (up.rank === 'A') {
      this.seats.forEach((seat) => {
        seat.isInsuranceOffered = true;
      });
      this.phase = 'insurance';
      this.insuranceSeatCursor = 0;
      this.activeSeatCursor = 0;
      return;
    }

    this.afterInsuranceResolved();
  }

  get dealerUpCard(): Card {
    return this.dealerCards[0];
  }

  get activeSeatIndex(): number | null {
    const cursor = this.phase === 'insurance' ? this.insuranceSeatCursor : this.activeSeatCursor;
    return this.phase === 'insurance' || this.phase === 'player'
      ? (this.seats[cursor]?.seatIndex ?? null)
      : null;
  }

  get activeSeat(): TableSeatRoundState | null {
    if (this.phase !== 'player' && this.phase !== 'insurance') return null;
    const cursor = this.phase === 'insurance' ? this.insuranceSeatCursor : this.activeSeatCursor;
    return this.seats[cursor] ?? null;
  }

  get activeHandIndex(): number {
    return this.currentPlayerSeat().activeHandIndex;
  }

  get activeHand(): PlayerHandState | null {
    if (this.phase !== 'player') return null;
    const seat = this.currentPlayerSeat();
    return seat.hands[seat.activeHandIndex];
  }

  get isInsuranceOffered(): boolean {
    return this.phase === 'insurance';
  }

  /** Even money is decided one eligible insurance seat at a time. */
  get canTakeEvenMoney(): boolean {
    if (this.phase !== 'insurance') return false;
    const seat = this.currentInsuranceSeat();
    return (
      isNaturalBlackjack(seat.hands[0].cards, false) &&
      !seat.evenMoneyTaken &&
      !seat.hands[0].settledEarly
    );
  }

  get maxInsurance(): number {
    if (this.phase !== 'insurance') return 0;
    return Math.floor(this.currentInsuranceSeat().bets.main / 2);
  }

  get result(): TableRoundSummary | null {
    return this.summary;
  }

  /** Insurance decision for the currently active insurance seat. */
  resolveInsurance(amount: number): void {
    if (this.phase !== 'insurance') throw new Error('Assurance non proposée');
    if (amount < 0 || amount > this.maxInsurance) throw new Error('Montant d’assurance invalide');
    const seat = this.currentInsuranceSeat();
    seat.insuranceBet = amount;
    this.advanceInsurance();
  }

  /** Even money for the currently active insurance seat. */
  takeEvenMoney(): void {
    if (!this.canTakeEvenMoney) throw new Error('Even money indisponible');
    const seat = this.currentInsuranceSeat();
    const hand = seat.hands[0];
    seat.evenMoneyTaken = true;
    seat.insuranceBet = 0;
    hand.settledEarly = true;
    seat.earlyReturns.set(0, { outcome: 'evenMoney', returned: hand.bet * 2 });
    this.advanceInsurance();
  }

  /** Actions available for the active seat's active hand, filtered by balance. */
  availableActions(balance: number): PlayerActionType[] {
    if (this.phase !== 'player') return [];
    const seat = this.currentPlayerSeat();
    const hand = seat.hands[seat.activeHandIndex];
    const actions: PlayerActionType[] = [];
    const value = handValue(hand.cards);
    const isTwoCards = hand.cards.length === 2;
    const splitAceLocked = hand.fromSplitAces && this.rules.splitAcesOneCard;

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
      seat.hands.length < this.rules.maxSplitHands &&
      balance >= hand.bet
    ) {
      const isAces = hand.cards[0].rank === 'A' && hand.cards[1].rank === 'A';
      const acesOk = !isAces || !hand.fromSplitAces || this.rules.resplitAces;
      if (acesOk) actions.push('split');
    }

    if (
      this.rules.lateSurrender &&
      seat.hands.length === 1 &&
      isTwoCards &&
      !hand.fromSplit &&
      !hand.doubled
    ) {
      actions.push('surrender');
    }

    return actions;
  }

  hit(): void {
    const hand = this.requireActiveHand();
    hand.cards.push(this.shoe.draw());
    const v = handValue(hand.cards);
    if (v.bust || v.total === 21) {
      hand.stood = !v.bust;
      this.advance();
    }
  }

  stand(): void {
    const hand = this.requireActiveHand();
    hand.stood = true;
    this.advance();
  }

  /** Double: the caller must have debited the additional hand bet. */
  double(): void {
    const hand = this.requireActiveHand();
    if (hand.cards.length !== 2) throw new Error('Double impossible');
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(this.shoe.draw());
    hand.stood = !handValue(hand.cards).bust;
    this.advance();
  }

  /** Split: the caller must have debited the additional main bet. */
  split(): void {
    const seat = this.currentPlayerSeat();
    const hand = this.requireActiveHand();
    if (!isPair(hand.cards, this.rules.splitMixedTens)) throw new Error('Split impossible');
    if (seat.hands.length >= this.rules.maxSplitHands) {
      throw new Error('Nombre de mains maximal atteint');
    }

    const isAces = hand.cards[0].rank === 'A' && hand.cards[1].rank === 'A';
    const second = hand.cards.pop()!;
    const newHand: PlayerHandState = {
      cards: [second],
      bet: seat.bets.main,
      fromSplit: true,
      fromSplitAces: isAces,
      doubled: false,
      surrendered: false,
      stood: false,
      settledEarly: false,
    };
    hand.fromSplit = true;
    hand.fromSplitAces = isAces;
    seat.hands.splice(seat.activeHandIndex + 1, 0, newHand);

    this.dealToActiveSplitHand();
  }

  surrender(): void {
    const seat = this.currentPlayerSeat();
    const hand = this.requireActiveHand();
    if (!this.rules.lateSurrender) throw new Error('Abandon non autorisé');
    hand.surrendered = true;
    hand.settledEarly = true;
    seat.earlyReturns.set(seat.activeHandIndex, {
      outcome: 'surrender',
      returned: Math.round(hand.bet / 2),
    });
    this.advance();
  }

  private validateAndBuildSeats(seats: TableSeatInput[]): InternalSeatState[] {
    if (seats.length === 0) throw new Error('Aucun siège occupé');

    const seen = new Set<number>();
    return [...seats]
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map(({ seatIndex, bets }) => {
        if (!Number.isInteger(seatIndex) || seatIndex < 0) throw new Error('Index de siège invalide');
        if (seen.has(seatIndex)) throw new Error(`Siège dupliqué : ${seatIndex}`);
        seen.add(seatIndex);
        this.validateBets(bets);
        return {
          seatIndex,
          bets,
          hands: [],
          activeHandIndex: 0,
          insuranceBet: null,
          isInsuranceOffered: false,
          evenMoneyTaken: false,
          dealSideBetResults: [],
          bustItBet: bets.sideBets.bustIt ?? 0,
          earlyReturns: new Map<number, { outcome: HandOutcome; returned: number }>(),
        };
      });
  }

  private validateBets(bets: BetLayout): void {
    if (bets.main < this.rules.minBet || bets.main > this.rules.maxBet) {
      throw new Error('Mise principale hors limites');
    }
    for (const [id, amount] of Object.entries(bets.sideBets)) {
      if (amount === undefined || amount === 0) continue;
      if (!this.rules.sideBets.includes(id as SideBetId)) throw new Error(`Side bet non proposé : ${id}`);
      if (amount < this.rules.sideBetMin || amount > this.rules.sideBetMax) {
        throw new Error(`Side bet ${id} hors limites`);
      }
    }
  }

  private resolveDealSideBets(up: Card): void {
    for (const seat of this.internalSeats()) {
      const initialCards = seat.hands[0].cards;
      for (const id of Object.keys(seat.bets.sideBets) as SideBetId[]) {
        const amount = seat.bets.sideBets[id] ?? 0;
        if (amount <= 0 || id === 'bustIt') continue;
        const { row } = evaluateDealSideBet(
          id,
          [initialCards[0], initialCards[1]],
          up,
          this.dealerBlackjack,
        );
        const returned = row ? amount + Math.round(amount * row.pays) : 0;
        seat.dealSideBetResults.push({
          seatIndex: seat.seatIndex,
          id,
          bet: amount,
          label: row?.label ?? null,
          paysMultiplier: row?.pays ?? 0,
          returned,
          net: returned - amount,
        });
      }
    }
  }

  private advanceInsurance(): void {
    this.insuranceSeatCursor += 1;
    this.activeSeatCursor = this.insuranceSeatCursor;
    if (this.insuranceSeatCursor < this.seats.length) return;
    this.afterInsuranceResolved();
  }

  private afterInsuranceResolved(): void {
    if (this.dealerBlackjack) {
      this.holeRevealed = true;
      this.settle();
      return;
    }

    for (const seat of this.internalSeats()) {
      const hand = seat.hands[0];
      if (!hand.settledEarly && isNaturalBlackjack(hand.cards, false)) {
        hand.settledEarly = true;
        const winnings = applyRatio(hand.bet, this.rules.blackjackPays);
        seat.earlyReturns.set(0, { outcome: 'blackjack', returned: hand.bet + winnings });
      }
    }

    this.advanceFrom(0, 0);
  }

  private requireActiveHand(): PlayerHandState {
    if (this.phase !== 'player') throw new Error('Aucune main active');
    const seat = this.currentPlayerSeat();
    return seat.hands[seat.activeHandIndex];
  }

  private currentPlayerSeat(): InternalSeatState {
    if (this.phase !== 'player') throw new Error('Aucun siège actif');
    return this.internalSeats()[this.activeSeatCursor];
  }

  private currentInsuranceSeat(): InternalSeatState {
    if (this.phase !== 'insurance') throw new Error('Assurance non proposée');
    return this.internalSeats()[this.insuranceSeatCursor];
  }

  /** Deals the second card to a split hand and applies split-ace rules. */
  private dealToActiveSplitHand(): void {
    const seat = this.currentPlayerSeat();
    const hand = seat.hands[seat.activeHandIndex];
    hand.cards.push(this.shoe.draw());

    if (hand.fromSplitAces && this.rules.splitAcesOneCard) {
      const canResplit =
        this.rules.resplitAces &&
        hand.cards[1].rank === 'A' &&
        seat.hands.length < this.rules.maxSplitHands;
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

  /** Advances through hands in a seat, then seats, then the shared dealer. */
  private advance(): void {
    this.advanceFrom(this.activeSeatCursor, this.currentPlayerSeat().activeHandIndex);
  }

  private advanceFrom(startSeatCursor: number, startHandIndex: number): void {
    for (let seatCursor = startSeatCursor; seatCursor < this.seats.length; seatCursor++) {
      const seat = this.internalSeats()[seatCursor];
      const handStart = seatCursor === startSeatCursor ? startHandIndex : 0;
      for (let handIndex = handStart; handIndex < seat.hands.length; handIndex++) {
        const hand = seat.hands[handIndex];
        if (this.isHandDone(hand)) continue;

        this.phase = 'player';
        this.activeSeatCursor = seatCursor;
        seat.activeHandIndex = handIndex;
        if (hand.cards.length === 1) {
          this.dealToActiveSplitHand();
        }
        return;
      }
    }
    this.goToDealer();
  }

  private isHandDone(hand: PlayerHandState): boolean {
    return hand.stood || hand.surrendered || hand.settledEarly || handValue(hand.cards).bust;
  }

  private goToDealer(): void {
    this.phase = 'dealer';
    this.holeRevealed = true;

    const hasLiveHand = this.seats.some((seat) =>
      seat.hands.some((hand) => !hand.surrendered && !hand.settledEarly && !handValue(hand.cards).bust),
    );
    const hasBustIt = this.internalSeats().some((seat) => seat.bustItBet > 0);

    if (hasLiveHand || hasBustIt) {
      const mustHit = (): boolean => {
        const v = handValue(this.dealerCards);
        if (v.total < 17) return true;
        return v.total === 17 && v.soft && this.rules.dealerHitsSoft17;
      };
      while (mustHit()) {
        this.dealerCards.push(this.shoe.draw());
      }
    }
    this.settle();
  }

  private settle(): void {
    const dealerV = handValue(this.dealerCards);
    const dealerBust = dealerV.bust;
    this.holeRevealed = true;

    const seatSummaries: TableSeatSummary[] = this.internalSeats().map((seat) => {
      const hands = this.settleSeatHands(seat, dealerV.total, dealerBust);
      const sideBets = this.settleSeatSideBets(seat, dealerBust);
      const insurance = this.settleSeatInsurance(seat);
      const totalWagered =
        hands.reduce((sum, hand) => sum + hand.bet, 0) +
        sideBets.reduce((sum, sideBet) => sum + sideBet.bet, 0) +
        (insurance?.bet ?? 0);
      const totalReturned =
        hands.reduce((sum, hand) => sum + hand.returned, 0) +
        sideBets.reduce((sum, sideBet) => sum + sideBet.returned, 0) +
        (insurance?.returned ?? 0);

      return {
        seatIndex: seat.seatIndex,
        hands,
        sideBets,
        insurance,
        totalReturned,
        totalNet: totalReturned - totalWagered,
        totalWagered,
      };
    });

    const hands = seatSummaries.flatMap((seat) => seat.hands);
    const sideBets = seatSummaries.flatMap((seat) => seat.sideBets);
    const insurance = seatSummaries.flatMap((seat) => (seat.insurance ? [seat.insurance] : []));
    const totalWagered = seatSummaries.reduce((sum, seat) => sum + seat.totalWagered, 0);
    const totalReturned = seatSummaries.reduce((sum, seat) => sum + seat.totalReturned, 0);

    this.summary = {
      seats: seatSummaries,
      hands,
      sideBets,
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

  private settleSeatHands(
    seat: InternalSeatState,
    dealerTotal: number,
    dealerBust: boolean,
  ): SeatHandResult[] {
    return seat.hands.map((hand, handIndex) => {
      const early = seat.earlyReturns.get(handIndex);
      if (early) {
        return {
          seatIndex: seat.seatIndex,
          handIndex,
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
      } else if (dealerBust || v.total > dealerTotal) {
        outcome = 'win';
        returned = hand.bet * 2;
      } else if (v.total === dealerTotal) {
        outcome = 'push';
        returned = hand.bet;
      } else {
        outcome = 'lose';
        returned = 0;
      }

      return {
        seatIndex: seat.seatIndex,
        handIndex,
        outcome,
        bet: hand.bet,
        returned,
        net: returned - hand.bet,
      };
    });
  }

  private settleSeatSideBets(seat: InternalSeatState, dealerBust: boolean): SeatSideBetResult[] {
    const sideBetResults: SeatSideBetResult[] = [...seat.dealSideBetResults];
    if (seat.bustItBet > 0) {
      const { row } = evaluateBustIt(this.dealerCards, dealerBust);
      const returned = row ? seat.bustItBet + Math.round(seat.bustItBet * row.pays) : 0;
      sideBetResults.push({
        seatIndex: seat.seatIndex,
        id: 'bustIt',
        bet: seat.bustItBet,
        label: row?.label ?? null,
        paysMultiplier: row?.pays ?? 0,
        returned,
        net: returned - seat.bustItBet,
      });
    }
    return sideBetResults;
  }

  private settleSeatInsurance(seat: InternalSeatState): SeatInsuranceResult | null {
    if (seat.insuranceBet === null || seat.insuranceBet <= 0) return null;
    const won = this.dealerBlackjack;
    const returned = won
      ? seat.insuranceBet + applyRatio(seat.insuranceBet, this.rules.insurancePays)
      : 0;
    return {
      seatIndex: seat.seatIndex,
      bet: seat.insuranceBet,
      won,
      returned,
      net: returned - seat.insuranceBet,
    };
  }

  private internalSeats(): InternalSeatState[] {
    return this.seats as InternalSeatState[];
  }

  /** Side bet display name helper kept aligned with Round. */
  static sideBetName(id: SideBetId): string {
    return SIDE_BET_DEFS[id].name;
  }
}
