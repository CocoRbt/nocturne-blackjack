import { create } from 'zustand';
import { sounds } from '../audio/sounds';
import { handValue, isNaturalBlackjack } from '../engine/hand';
import { Round } from '../engine/round';
import {
  canSitAtTable,
  getTable,
  PRIVATE_TABLE_ID,
  setPrivateLimits as setEnginePrivateLimits,
  type PrivateLimits,
} from '../engine/rules';
import { DealingShoe } from '../engine/shoe';
import type { BetLayout, PlayerActionType, SideBetId } from '../engine/types';
import {
  ALL_CHIP_DENOMS,
  chipsForLimits,
  defaultChipForLimits,
  decomposeAmount,
} from './chips';
import {
  emptyStats,
  loadSave,
  persistSave,
  STARTING_BALANCE,
  type HistoryEntry,
  type SaveData,
  type Stats,
} from './persistence';
import { TIMING, type GameSpeed } from './timing';

export type BetSpot = 'main' | SideBetId;

/** @deprecated préférer ALL_CHIP_DENOMS / chipsForLimits — conservé pour imports existants. */
export const CHIP_DENOMS = ALL_CHIP_DENOMS;

export type GoalId = 'none' | 'reach6100' | 'hands20' | 'bj2';

export interface SessionState {
  startedAt: number;
  startBalance: number;
  net: number;
  hands: number;
  currentStreak: number;
  bestStreakThisSession: number;
  blackjacks: number;
  goalId: GoalId;
  goalProgress: number;
  goalDone: boolean;
}

export interface PayoutFlyItem {
  id: string;
  amount: number;
  won: boolean;
  push: boolean;
}

export interface DisplayState {
  dealing: boolean;
  holeShown: boolean;
  dealerShown: number;
  resultsShown: boolean;
  payoutPhase: 'idle' | 'flying' | 'done';
  payoutFlies: PayoutFlyItem[];
  /** Side bets gagnants flashés dès la fin de donne. */
  dealFlashIds: SideBetId[];
  /** Net animé affiché pendant le fly (0 → totalNet). */
  animatedNet: number;
}

interface GameState {
  balance: number;
  peakBalance: number;
  refills: number;
  screen: 'lobby' | 'table';
  tableId: string;
  soundMuted: boolean;
  gameSpeed: GameSpeed;
  privateLimits: PrivateLimits;

  selectedChip: number;
  stacks: Record<BetSpot, number[]>;
  placementOrder: BetSpot[];
  lastBets: Record<string, BetLayout>;

  round: Round | null;
  v: number;
  display: DisplayState;
  notice: string | null;
  session: SessionState | null;

  history: HistoryEntry[];
  stats: Stats;

  shoeSize: number;
  shoeDealt: number;

  enterTable(tableId: string): void;
  leaveTable(): void;
  configurePrivateLimits(limits: PrivateLimits): void;
  selectChip(denom: number): void;
  addChip(spot: BetSpot): void;
  undoLastChip(): void;
  clearBets(): void;
  rebet(): boolean;
  deal(): void;
  rebetAndDeal(): void;
  action(a: PlayerActionType): void;
  takeInsurance(): void;
  declineInsurance(): void;
  takeEvenMoney(): void;
  nextRound(): void;
  toggleSound(): void;
  setGameSpeed(speed: GameSpeed): void;
  refill(): void;
  resetAll(): void;
  dismissNotice(): void;
}

const emptyStacks = (): Record<BetSpot, number[]> => ({
  main: [],
  perfectPairs: [],
  twentyOnePlusThree: [],
  luckyLadies: [],
  bustIt: [],
  royalMatch: [],
});

const idleDisplay = (): DisplayState => ({
  dealing: false,
  holeShown: false,
  dealerShown: 0,
  resultsShown: false,
  payoutPhase: 'idle',
  payoutFlies: [],
  dealFlashIds: [],
  animatedNet: 0,
});

const freshSession = (balance: number, goalId: GoalId = 'hands20'): SessionState => ({
  startedAt: Date.now(),
  startBalance: balance,
  net: 0,
  hands: 0,
  currentStreak: 0,
  bestStreakThisSession: 0,
  blackjacks: 0,
  goalId,
  goalProgress: 0,
  goalDone: false,
});

const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

export function decompose(amount: number, denoms: readonly number[] = ALL_CHIP_DENOMS): number[] {
  return decomposeAmount(amount, denoms);
}

function withPeak(balance: number, peak: number): number {
  return Math.max(peak, balance);
}

function goalProgressOf(session: SessionState, balance: number): number {
  switch (session.goalId) {
    case 'reach6100':
      return Math.min(1, Math.max(0, (balance - session.startBalance) / 1_100_00));
    case 'hands20':
      return Math.min(1, session.hands / 20);
    case 'bj2':
      return Math.min(1, session.blackjacks / 2);
    default:
      return 0;
  }
}

function goalLabel(id: GoalId): string {
  switch (id) {
    case 'reach6100':
      return 'Atteindre +1 100 cette session';
    case 'hands20':
      return 'Jouer 20 manches';
    case 'bj2':
      return 'Deux blackjacks naturels';
    default:
      return '';
  }
}

let shoe: DealingShoe | null = null;
let presentToken = 0;

const saved = loadSave();
const initialBalance = saved?.balance ?? STARTING_BALANCE;
const initialPeak = saved?.peakBalance ?? Math.max(initialBalance, STARTING_BALANCE);
const initialPrivate = saved?.privateLimits ?? { minBet: 250_00, maxBet: 25_000_00 };
setEnginePrivateLimits(initialPrivate);

export const useGame = create<GameState>((set, get) => {
  const bump = () => set((s) => ({ v: s.v + 1 }));
  const timing = () => TIMING[get().gameSpeed];

  const syncShoe = () => {
    if (shoe) set({ shoeSize: shoe.size(), shoeDealt: shoe.cardsDealt() });
  };

  const persist = () => {
    const s = get();
    const data: SaveData = {
      version: 2,
      balance: s.balance,
      peakBalance: s.peakBalance,
      tableId: s.tableId,
      history: s.history,
      stats: s.stats,
      lastBets: s.lastBets,
      soundMuted: s.soundMuted,
      refills: s.refills,
      gameSpeed: s.gameSpeed,
      privateLimits: s.privateLimits,
    };
    persistSave(data);
  };

  const applySummary = () => {
    const s = get();
    const round = s.round;
    const summary = round?.result;
    if (!round || !summary) return;

    const balance = s.balance + summary.totalReturned;

    const stats: Stats = structuredClone(s.stats);
    stats.rounds += 1;
    stats.handsPlayed += summary.hands.length;
    stats.netTotal += summary.totalNet;
    stats.totalWagered += summary.totalWagered;
    if (summary.totalNet > stats.biggestWin) stats.biggestWin = summary.totalNet;
    stats.currentStreak =
      summary.totalNet > 0
        ? Math.max(1, stats.currentStreak + 1)
        : summary.totalNet < 0
          ? Math.min(-1, stats.currentStreak - 1)
          : 0;
    if (stats.currentStreak > stats.longestWinStreak) stats.longestWinStreak = stats.currentStreak;

    summary.hands.forEach((h, i) => {
      if (h.outcome === 'win' || h.outcome === 'evenMoney') stats.wins += 1;
      else if (h.outcome === 'blackjack') {
        stats.wins += 1;
        stats.blackjacks += 1;
      } else if (h.outcome === 'push') stats.pushes += 1;
      else if (h.outcome === 'surrender') stats.surrenders += 1;
      else stats.losses += 1;
      if (round.hands[i]?.doubled) stats.doubles += 1;
    });
    stats.splits += Math.max(0, round.hands.length - 1);

    if (summary.insurance) {
      stats.insuranceTaken += 1;
      if (summary.insurance.won) stats.insuranceWon += 1;
      stats.insuranceNet += summary.insurance.net;
    }
    for (const sb of summary.sideBets) {
      const st = stats.sideBets[sb.id];
      st.placed += 1;
      st.wagered += sb.bet;
      if (sb.returned > 0) st.won += 1;
      st.net += sb.net;
    }

    const entry: HistoryEntry = {
      id: Date.now(),
      at: Date.now(),
      tableId: s.tableId,
      hands: summary.hands.map((h, i) => ({
        outcome: h.outcome,
        bet: h.bet,
        net: h.net,
        cards: round.hands[i].cards.map((c) => c.rank + c.suit),
        total: handValue(round.hands[i].cards).total,
      })),
      dealerCards: summary.dealerCards.map((c) => c.rank + c.suit),
      dealerTotal: summary.dealerTotal,
      dealerBust: summary.dealerBust,
      sideBets: summary.sideBets.map((b) => ({ id: b.id, bet: b.bet, label: b.label, net: b.net })),
      insuranceNet: summary.insurance?.net ?? null,
      net: summary.totalNet,
      wagered: summary.totalWagered,
      balanceAfter: balance,
    };

    let session = s.session;
    let notice: string | null = s.notice;
    if (session) {
      const bjCount = summary.hands.filter((h) => h.outcome === 'blackjack').length;
      const next: SessionState = {
        ...session,
        net: balance - session.startBalance,
        hands: session.hands + 1,
        blackjacks: session.blackjacks + bjCount,
        currentStreak:
          summary.totalNet > 0
            ? Math.max(1, session.currentStreak + 1)
            : summary.totalNet < 0
              ? 0
              : session.currentStreak,
        bestStreakThisSession: session.bestStreakThisSession,
        goalDone: session.goalDone,
        goalProgress: session.goalProgress,
      };
      if (next.currentStreak > next.bestStreakThisSession) {
        next.bestStreakThisSession = next.currentStreak;
      }
      next.goalProgress = goalProgressOf(next, balance);
      if (!next.goalDone && next.goalProgress >= 1 && next.goalId !== 'none') {
        next.goalDone = true;
        notice = `Objectif atteint — ${goalLabel(next.goalId)}`;
      }
      session = next;
    }

    const hasBj = summary.hands.some((h) => h.outcome === 'blackjack');
    if (hasBj) sounds.play('blackjack');
    else if (summary.totalNet >= summary.totalWagered && summary.totalNet > 0) sounds.play('bigWin');
    else if (summary.totalNet > 0) sounds.play('win');
    else if (summary.totalNet === 0) sounds.play('push');
    else sounds.play('lose');

    set({
      balance,
      peakBalance: withPeak(balance, s.peakBalance),
      stats,
      history: [entry, ...s.history].slice(0, 60),
      session,
      notice,
      display: {
        ...get().display,
        resultsShown: true,
        payoutPhase: 'done',
        animatedNet: summary.totalNet,
      },
    });

    persist();
    bump();
  };

  const presentSettlement = () => {
    const round = get().round;
    if (!round || round.phase !== 'settled') return;
    const token = ++presentToken;
    const totalDealer = round.dealerCards.length;
    const t = timing();
    syncShoe();

    let delay = t.holeDelay;
    setTimeout(() => {
      if (presentToken !== token) return;
      sounds.play('flip');
      set((s) => ({ display: { ...s.display, holeShown: true, dealerShown: 2 } }));
      bump();
    }, delay);
    delay += t.postHoleGap;

    for (let n = 3; n <= totalDealer; n++) {
      const shown = n;
      setTimeout(() => {
        if (presentToken !== token) return;
        sounds.play('card');
        set((s) => ({ display: { ...s.display, dealerShown: shown } }));
        bump();
      }, delay);
      delay += t.dealerCardGap;
    }

    // Phase fly : jetons avant crédit du solde.
    setTimeout(() => {
      if (presentToken !== token) return;
      const summary = get().round?.result;
      if (!summary) return;
      const flies: PayoutFlyItem[] = [];
      for (const h of summary.hands) {
        flies.push({
          id: `hand-${h.handIndex}`,
          amount: Math.abs(h.net || h.bet),
          won: h.net > 0,
          push: h.net === 0,
        });
      }
      for (const b of summary.sideBets) {
        if (b.bet <= 0) continue;
        flies.push({
          id: `side-${b.id}`,
          amount: Math.abs(b.net || b.bet),
          won: b.net > 0,
          push: b.net === 0,
        });
      }
      sounds.play(summary.totalNet > 0 ? 'chipStack' : 'chip');
      set((s) => ({
        display: {
          ...s.display,
          payoutPhase: 'flying',
          payoutFlies: flies,
          animatedNet: 0,
        },
      }));
      bump();

      // Compteur net pendant le fly.
      const steps = 8;
      const stepMs = Math.max(30, Math.floor(t.payoutFly / steps));
      for (let i = 1; i <= steps; i++) {
        setTimeout(() => {
          if (presentToken !== token) return;
          set((st) => ({
            display: {
              ...st.display,
              animatedNet: Math.round((summary.totalNet * i) / steps),
            },
          }));
        }, i * stepMs);
      }
    }, delay);

    setTimeout(() => {
      if (presentToken !== token) return;
      applySummary();
    }, delay + t.payoutFly);
  };

  const afterAction = () => {
    const round = get().round!;
    syncShoe();
    bump();
    if (round.phase === 'settled') presentSettlement();
  };

  return {
    balance: initialBalance,
    peakBalance: initialPeak,
    refills: saved?.refills ?? 0,
    screen: 'lobby',
    tableId: saved?.tableId === PRIVATE_TABLE_ID ? PRIVATE_TABLE_ID : (saved?.tableId ?? 'emeraude'),
    soundMuted: saved?.soundMuted ?? false,
    gameSpeed: saved?.gameSpeed === 'fast' ? 'fast' : 'classic',
    privateLimits: initialPrivate,
    selectedChip: 5_00,
    stacks: emptyStacks(),
    placementOrder: [],
    lastBets: saved?.lastBets ?? {},
    round: null,
    v: 0,
    display: idleDisplay(),
    notice: null,
    session: null,
    history: saved?.history ?? [],
    stats: saved?.stats ?? emptyStats(),
    shoeSize: 0,
    shoeDealt: 0,

    enterTable(tableId) {
      const s = get();
      if (tableId === PRIVATE_TABLE_ID) {
        setEnginePrivateLimits(s.privateLimits);
      }
      if (!canSitAtTable(tableId, s.balance, s.peakBalance, s.privateLimits)) {
        const table = getTable(tableId);
        if (s.peakBalance < table.unlockPeak) {
          set({
            notice: `Table verrouillée — atteins ${table.unlockPeak / 100} crédits (pic actuel : ${Math.floor(s.peakBalance / 100)}).`,
          });
        } else {
          set({
            notice: `Crédit insuffisant — mise minimale ${table.rules.minBet / 100}.`,
          });
        }
        return;
      }
      const table = getTable(tableId);
      shoe = new DealingShoe(table.rules.decks, table.rules.penetration);
      sounds.setMuted(s.soundMuted);
      sounds.setAmbienceProfile(table.identity.ambienceHz);
      sounds.startAmbience();
      sounds.play('shuffle');
      const chip = defaultChipForLimits(table.rules.minBet, table.rules.maxBet);
      const goals: GoalId[] = ['hands20', 'reach6100', 'bj2'];
      const goalId = goals[Math.floor(Math.random() * goals.length)];
      set({
        screen: 'table',
        tableId,
        round: null,
        stacks: emptyStacks(),
        placementOrder: [],
        display: idleDisplay(),
        selectedChip: chip,
        notice: null,
        shoeSize: shoe.size(),
        shoeDealt: 0,
        session: freshSession(s.balance, goalId),
      });
      persist();
    },

    configurePrivateLimits(limits) {
      const minBet = limits.minBet;
      const maxBet = Math.max(limits.maxBet, minBet * 10);
      const next = { minBet, maxBet };
      setEnginePrivateLimits(next);
      set({ privateLimits: next });
      persist();
    },

    leaveTable() {
      presentToken++;
      shoe = null;
      set({
        screen: 'lobby',
        round: null,
        stacks: emptyStacks(),
        placementOrder: [],
        display: idleDisplay(),
        session: null,
      });
    },

    selectChip(denom) {
      sounds.play('click');
      set({ selectedChip: denom });
    },

    addChip(spot) {
      const s = get();
      if (s.round) return;
      const table = getTable(s.tableId);
      const denom = s.selectedChip;
      const staged = sum(Object.values(s.stacks).flat());
      if (staged + denom > s.balance) {
        set({ notice: 'Solde insuffisant pour ce jeton.' });
        return;
      }
      const max = spot === 'main' ? table.rules.maxBet : table.rules.sideBetMax;
      if (sum(s.stacks[spot]) + denom > max) {
        set({ notice: `Limite de mise atteinte sur cette zone.` });
        return;
      }
      sounds.play('chip');
      set({
        stacks: { ...s.stacks, [spot]: [...s.stacks[spot], denom] },
        placementOrder: [...s.placementOrder, spot],
        notice: null,
      });
    },

    undoLastChip() {
      const s = get();
      if (s.round || s.placementOrder.length === 0) return;
      const spot = s.placementOrder[s.placementOrder.length - 1];
      sounds.play('chip');
      set({
        stacks: { ...s.stacks, [spot]: s.stacks[spot].slice(0, -1) },
        placementOrder: s.placementOrder.slice(0, -1),
      });
    },

    clearBets() {
      const s = get();
      if (s.round) return;
      sounds.play('chipStack');
      set({ stacks: emptyStacks(), placementOrder: [] });
    },

    rebet() {
      const s = get();
      if (s.round) return false;
      const last = s.lastBets[s.tableId];
      if (!last) return false;
      const total =
        last.main + sum(Object.values(last.sideBets).filter((x): x is number => x !== undefined));
      if (total > s.balance) {
        set({ notice: 'Solde insuffisant pour rejouer la mise précédente.' });
        return false;
      }
      const table = getTable(s.tableId);
      const denoms = chipsForLimits(table.rules.minBet, table.rules.maxBet);
      const stacks = emptyStacks();
      stacks.main = decompose(last.main, denoms);
      const order: BetSpot[] = stacks.main.map(() => 'main' as BetSpot);
      for (const [id, amount] of Object.entries(last.sideBets)) {
        if (!amount) continue;
        stacks[id as SideBetId] = decompose(amount, denoms);
        for (let i = 0; i < stacks[id as SideBetId].length; i++) order.push(id as SideBetId);
      }
      sounds.play('chipStack');
      set({ stacks, placementOrder: order, notice: null });
      return true;
    },

    deal() {
      const s = get();
      if (s.round || !shoe) return;
      const table = getTable(s.tableId);
      const main = sum(s.stacks.main);
      if (main < table.rules.minBet) {
        set({ notice: `Mise principale minimale : ${table.rules.minBet / 100}.` });
        return;
      }
      const sideBets: BetLayout['sideBets'] = {};
      for (const id of table.rules.sideBets) {
        const amount = sum(s.stacks[id]);
        if (amount > 0) {
          if (amount < table.rules.sideBetMin) {
            set({ notice: `Side bet minimal : ${table.rules.sideBetMin / 100}.` });
            return;
          }
          sideBets[id] = amount;
        }
      }
      const bets: BetLayout = { main, sideBets };
      const total = main + sum(Object.values(sideBets) as number[]);
      if (total > s.balance) {
        set({ notice: 'Solde insuffisant.' });
        return;
      }

      if (shoe.shuffleIfNeeded()) {
        sounds.play('shuffle');
        set({ notice: 'Le sabot a été mélangé.' });
      } else {
        set({ notice: null });
      }

      const round = new Round(table.rules, shoe, bets);
      const token = ++presentToken;
      const t = timing();
      const dealFlashIds = round.dealSideBetResults
        .filter((r) => r.returned > 0)
        .map((r) => r.id);

      set({
        balance: s.balance - total,
        round,
        lastBets: { ...s.lastBets, [s.tableId]: bets },
        display: {
          dealing: true,
          holeShown: false,
          dealerShown: 2,
          resultsShown: false,
          payoutPhase: 'idle',
          payoutFlies: [],
          dealFlashIds: [],
          animatedNet: 0,
        },
      });
      syncShoe();
      persist();
      bump();

      // Chorégraphie : 4 battements synchronisés.
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          if (presentToken !== token) return;
          sounds.play('card');
        }, i * t.dealGap);
      }

      setTimeout(() => {
        if (presentToken !== token) return;
        set((st) => ({
          display: {
            ...st.display,
            dealing: false,
            dealFlashIds,
          },
        }));
        bump();
        const r = get().round;
        if (r && r.phase === 'settled') presentSettlement();
      }, t.dealUnlock);
    },

    rebetAndDeal() {
      const s = get();
      if (!s.display.resultsShown) return;
      // Remet la manche, remiser, puis donner.
      presentToken++;
      set({ round: null, stacks: emptyStacks(), placementOrder: [], display: idleDisplay() });
      bump();
      if (!get().rebet()) {
        // Solde insuffisant : rester en mode mise pour ajuster.
        return;
      }
      setTimeout(() => get().deal(), timing().rebetPause);
    },

    action(a) {
      const s = get();
      const round = s.round;
      if (!round || round.phase !== 'player' || s.display.dealing) return;
      const available = round.availableActions(s.balance);
      if (!available.includes(a)) return;
      const hand = round.hands[round.activeHandIndex];
      switch (a) {
        case 'hit':
          sounds.play('card');
          round.hit();
          break;
        case 'stand':
          sounds.play('click');
          round.stand();
          break;
        case 'double':
          sounds.play('chipStack');
          set({ balance: s.balance - hand.bet });
          setTimeout(() => sounds.play('card'), 150);
          round.double();
          break;
        case 'split':
          sounds.play('chipStack');
          set({ balance: s.balance - hand.bet });
          setTimeout(() => sounds.play('card'), 200);
          round.split();
          break;
        case 'surrender':
          sounds.play('click');
          round.surrender();
          break;
      }
      afterAction();
    },

    takeInsurance() {
      const s = get();
      const round = s.round;
      if (!round || round.phase !== 'insurance') return;
      const amount = Math.min(round.maxInsurance, s.balance);
      if (amount <= 0) return;
      sounds.play('chipStack');
      set({ balance: s.balance - amount });
      round.resolveInsurance(amount);
      afterAction();
    },

    declineInsurance() {
      const round = get().round;
      if (!round || round.phase !== 'insurance') return;
      sounds.play('click');
      round.resolveInsurance(0);
      afterAction();
    },

    takeEvenMoney() {
      const round = get().round;
      if (!round || !round.canTakeEvenMoney) return;
      sounds.play('chipStack');
      round.takeEvenMoney();
      afterAction();
    },

    nextRound() {
      const s = get();
      if (!s.round || !s.display.resultsShown) return;
      presentToken++;
      sounds.play('click');
      set({ round: null, stacks: emptyStacks(), placementOrder: [], display: idleDisplay() });
      if (shoe?.needsShuffle()) {
        set({ notice: 'Fin de sabot : mélange à la prochaine donne.' });
      }
      bump();
    },

    toggleSound() {
      const muted = !get().soundMuted;
      sounds.setMuted(muted);
      set({ soundMuted: muted });
      persist();
    },

    setGameSpeed(speed) {
      if (get().round) return;
      set({ gameSpeed: speed });
      persist();
      sounds.play('click');
    },

    refill() {
      const s = get();
      if (s.round) return;
      sounds.play('chipStack');
      const balance = s.balance + STARTING_BALANCE;
      set({
        balance,
        peakBalance: withPeak(balance, s.peakBalance),
        refills: s.refills + 1,
        notice: 'Crédit reconstitué.',
      });
      persist();
    },

    resetAll() {
      presentToken++;
      shoe = null;
      const privateLimits = { minBet: 250_00, maxBet: 25_000_00 };
      setEnginePrivateLimits(privateLimits);
      set({
        balance: STARTING_BALANCE,
        peakBalance: STARTING_BALANCE,
        refills: 0,
        screen: 'lobby',
        tableId: 'emeraude',
        privateLimits,
        round: null,
        stacks: emptyStacks(),
        placementOrder: [],
        display: idleDisplay(),
        history: [],
        stats: emptyStats(),
        lastBets: {},
        notice: null,
        session: null,
      });
      persist();
    },

    dismissNotice() {
      set({ notice: null });
    },
  };
});

export function stagedTotal(stacks: Record<BetSpot, number[]>): number {
  return sum(Object.values(stacks).flat());
}

export { isNaturalBlackjack };
