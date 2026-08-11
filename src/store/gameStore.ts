import { create } from 'zustand';
import { sounds } from '../audio/sounds';
import { handValue, isNaturalBlackjack } from '../engine/hand';
import {
  canSitAtTable,
  getTable,
  PRIVATE_TABLE_ID,
  setPrivateLimits as setEnginePrivateLimits,
  type PrivateLimits,
} from '../engine/rules';
import { DealingShoe, RiggedShoe, type Shoe } from '../engine/shoe';
import {
  maxSeatsForOrientation,
  TableRound,
  type TableSeatInput,
  type TableSeatRoundState,
} from '../engine/tableRound';
import type { BetLayout, PlayerActionType, SideBetId } from '../engine/types';
import { card } from '../engine/cards';
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
import { fmt } from '../lib/format';
import { creditWithoutGame, settleGamePeak } from './peakMeta';
import { depositToVault, vaultableAmount, withdrawFromVault } from './vault';
import { mergeIncomingVault } from './vaultMerge';
import { markScoreDirty } from '../cercle/scoreSync';
import { TIMING, type GameSpeed } from './timing';

export type BetSpot = 'main' | SideBetId;
export type SeatStacks = Record<BetSpot, number[]>;
export type ChipPlacement = { seatIndex: number; spot: BetSpot };

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
  dealFlashIds: string[];
  /** Net animé affiché pendant le fly (0 → totalNet). */
  animatedNet: number;
}

interface GameState {
  balance: number;
  /** Crédit mis de côté — non jouable. */
  vault: number;
  peakBalance: number;
  /** Parties terminées tous jeux confondus. */
  gamesPlayed: number;
  /** Parties jouées avant le record actuel. */
  gamesBeforePeak: number;
  refills: number;
  screen: 'lobby' | 'table' | 'mines' | 'craps' | 'crash' | 'plinko';
  tableId: string;
  soundMuted: boolean;
  gameSpeed: GameSpeed;
  privateLimits: PrivateLimits;

  selectedChip: number;
  seatCapacity: 5 | 7;
  selectedSeat: number;
  stacks: SeatStacks[];
  placementOrder: ChipPlacement[];
  lastBets: SaveData['lastBets'];

  round: TableRound | null;
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
  enterMines(): void;
  leaveMines(): void;
  /** Débite une mise Mines. false si solde insuffisant. */
  minesDebit(bet: number): boolean;
  /** Crédite un payout Mines (cashout / bust). Compte 1 partie par défaut. */
  minesCredit(payout: number, countGame?: boolean): void;
  enterCraps(): void;
  leaveCraps(): void;
  /** Débite une mise Craps. false si solde insuffisant. */
  crapsDebit(bet: number): boolean;
  /** Crédite les gains Craps. countGame pour une décision de ligne. */
  crapsCredit(payout: number, countGame?: boolean): void;
  enterCrash(): void;
  leaveCrash(): void;
  /** Débite une mise Crash. false si solde insuffisant. */
  crashDebit(bet: number): boolean;
  /** Crédite un payout Crash (ou 0 si crash). Compte 1 partie par défaut. */
  crashCredit(payout: number, countGame?: boolean): void;
  enterPlinko(): void;
  leavePlinko(): void;
  /** Débite une mise Plinko. false si solde insuffisant. */
  plinkoDebit(bet: number): boolean;
  /** Crédite un payout Plinko. Compte 1 partie par défaut. */
  plinkoCredit(payout: number, countGame?: boolean): void;
  configurePrivateLimits(limits: PrivateLimits): void;
  selectChip(denom: number): void;
  selectSeat(seatIndex: number): void;
  refreshSeatCapacity(): void;
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
  /** Crédite une récompense de défi (ne compte pas comme partie). */
  creditDefiReward(amountCents: number, label: string): void;
  /** Dépose dans le coffre (max = solde − 100). */
  vaultDeposit(amountCents: number): void;
  /** Retire du coffre vers le solde jouable. */
  vaultWithdraw(amountCents: number): void;
  /** Applique un coffre cloud (cadeau) sans dupliquer après un retrait. */
  applyIncomingVault(cloudVault: number, cloudBalance: number): void;
  /** @deprecated préférer applyIncomingVault — alias richesse-aware. */
  applyVaultAtLeast(vaultCents: number, cloudBalance?: number): void;
  /** Fixe solde + coffre après RPC serveur (retrait / envoi). */
  applyVaultServerState(
    payload: { balance: number; vault: number; peakBalance?: number },
    notice?: string,
  ): void;
  /** Fixe le coffre après un envoi serveur (source de vérité). */
  setVaultFromServer(vaultCents: number, notice?: string): void;
  refill(): void;
  /** Hydrate le portefeuille local depuis le cloud (connexion compte). */
  hydrateFromCloud(payload: {
    balance: number;
    peakBalance: number;
    vault?: number;
    gamesPlayed?: number;
    gamesBeforePeak?: number;
    handsPlayed?: number;
    blackjacks?: number;
    bestStreak?: number;
    highestTable?: string;
  }): void;
  resetAll(): void;
  dismissNotice(): void;
  /** DEV/QA : force une manche multi-places en phase assurance. */
  qaForceInsurance(): void;
}

const emptyStacks = (): SeatStacks => ({
  main: [],
  perfectPairs: [],
  twentyOnePlusThree: [],
  luckyLadies: [],
  bustIt: [],
  royalMatch: [],
});

const emptyTableStacks = (capacity: number): SeatStacks[] =>
  Array.from({ length: capacity }, () => emptyStacks());

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

function orientationSeatCapacity(): 5 | 7 {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 5;
  return maxSeatsForOrientation(window.matchMedia('(orientation: landscape)').matches);
}

function resizeTableStacks(stacks: SeatStacks[], capacity: number): SeatStacks[] {
  return Array.from({ length: capacity }, (_, i) => stacks[i] ?? emptyStacks());
}

function seatStagedTotal(stacks: SeatStacks): number {
  return sum(Object.values(stacks).flat());
}

function betLayoutFromStacks(stacks: SeatStacks, sideBetIds: readonly SideBetId[]): BetLayout {
  const sideBets: BetLayout['sideBets'] = {};
  for (const id of sideBetIds) {
    const amount = sum(stacks[id]);
    if (amount > 0) sideBets[id] = amount;
  }
  return { main: sum(stacks.main), sideBets };
}

function betLayoutTotal(bets: BetLayout): number {
  return bets.main + sum(Object.values(bets.sideBets).filter((x): x is number => x !== undefined));
}

function cloneBetLayout(bets: BetLayout): BetLayout {
  return { main: bets.main, sideBets: { ...bets.sideBets } };
}

function seatByIndex(round: TableRound, seatIndex: number): TableSeatRoundState | undefined {
  return round.seats.find((seat) => seat.seatIndex === seatIndex);
}

export function decompose(amount: number, denoms: readonly number[] = ALL_CHIP_DENOMS): number[] {
  return decomposeAmount(amount, denoms);
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

let shoe: Shoe | null = null;
let presentToken = 0;

const saved = loadSave();
const initialBalance = saved?.balance ?? STARTING_BALANCE;
const initialPeak = saved?.peakBalance ?? Math.max(initialBalance, STARTING_BALANCE);
const initialGamesPlayed = saved?.gamesPlayed ?? saved?.stats.rounds ?? 0;
const initialGamesBeforePeak = saved?.gamesBeforePeak ?? 0;
const initialPrivate = saved?.privateLimits ?? { minBet: 250_00, maxBet: 25_000_00 };
const initialSeatCapacity = orientationSeatCapacity();
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
      vault: s.vault,
      peakBalance: s.peakBalance,
      gamesPlayed: s.gamesPlayed,
      gamesBeforePeak: s.gamesBeforePeak,
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

  const refreshSeatCapacityState = () => {
    const s = get();
    if (s.round) return;
    const seatCapacity = orientationSeatCapacity();
    set({
      seatCapacity,
      selectedSeat: Math.min(s.selectedSeat, seatCapacity - 1),
      stacks: resizeTableStacks(s.stacks, seatCapacity),
      placementOrder: s.placementOrder.filter((p) => p.seatIndex < seatCapacity),
    });
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

    summary.hands.forEach((h) => {
      if (h.outcome === 'win' || h.outcome === 'evenMoney') stats.wins += 1;
      else if (h.outcome === 'blackjack') {
        stats.wins += 1;
        stats.blackjacks += 1;
      } else if (h.outcome === 'push') stats.pushes += 1;
      else if (h.outcome === 'surrender') stats.surrenders += 1;
      else stats.losses += 1;
      if (seatByIndex(round, h.seatIndex)?.hands[h.handIndex]?.doubled) stats.doubles += 1;
    });
    stats.splits += round.seats.reduce((total, seat) => total + Math.max(0, seat.hands.length - 1), 0);

    for (const insurance of summary.insurance) {
      stats.insuranceTaken += 1;
      if (insurance.won) stats.insuranceWon += 1;
      stats.insuranceNet += insurance.net;
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
      hands: summary.hands.map((h) => {
        const hand = seatByIndex(round, h.seatIndex)?.hands[h.handIndex];
        return {
          seatIndex: h.seatIndex,
          outcome: h.outcome,
          bet: h.bet,
          net: h.net,
          cards: hand?.cards.map((c) => c.rank + c.suit) ?? [],
          total: hand ? handValue(hand.cards).total : 0,
        };
      }),
      dealerCards: summary.dealerCards.map((c) => c.rank + c.suit),
      dealerTotal: summary.dealerTotal,
      dealerBust: summary.dealerBust,
      sideBets: summary.sideBets.map((b) => ({
        seatIndex: b.seatIndex,
        id: b.id,
        bet: b.bet,
        label: b.label,
        net: b.net,
      })),
      insuranceNet:
        summary.insurance.length > 0 ? summary.insurance.reduce((total, i) => total + i.net, 0) : null,
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

    // totalReturned déjà dans balance ; settleGamePeak re-crédite → on part du solde avant retour.
    const beforeReturn = s.balance;
    const settled = settleGamePeak(beforeReturn, summary.totalReturned, {
      peakBalance: s.peakBalance,
      gamesPlayed: s.gamesPlayed,
      gamesBeforePeak: s.gamesBeforePeak,
    });

    set({
      balance: settled.balance,
      peakBalance: settled.peakBalance,
      gamesPlayed: settled.gamesPlayed,
      gamesBeforePeak: settled.gamesBeforePeak,
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
    markScoreDirty();
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
          id: `hand-${h.seatIndex}-${h.handIndex}`,
          amount: h.net === 0 ? h.bet : Math.abs(h.net),
          won: h.net > 0,
          push: h.net === 0,
        });
      }
      for (const b of summary.sideBets) {
        if (b.bet <= 0) continue;
        flies.push({
          id: `side-${b.seatIndex}-${b.id}`,
          amount: b.net === 0 ? b.bet : Math.abs(b.net),
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
    vault: saved?.vault ?? 0,
    peakBalance: initialPeak,
    gamesPlayed: initialGamesPlayed,
    gamesBeforePeak: initialGamesBeforePeak,
    refills: saved?.refills ?? 0,
    screen: 'lobby',
    tableId: saved?.tableId === PRIVATE_TABLE_ID ? PRIVATE_TABLE_ID : (saved?.tableId ?? 'emeraude'),
    soundMuted: saved?.soundMuted ?? false,
    gameSpeed: saved?.gameSpeed === 'fast' ? 'fast' : 'classic',
    privateLimits: initialPrivate,
    selectedChip: 5_00,
    seatCapacity: initialSeatCapacity,
    selectedSeat: 0,
    stacks: emptyTableStacks(initialSeatCapacity),
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
      sounds.setAmbience(table.identity.ambienceId);
      sounds.startAmbience();
      sounds.play('shuffle');
      const chip = defaultChipForLimits(table.rules.minBet, table.rules.maxBet);
      const goals: GoalId[] = ['hands20', 'reach6100', 'bj2'];
      const goalId = goals[Math.floor(Math.random() * goals.length)];
      const seatCapacity = orientationSeatCapacity();
      set({
        screen: 'table',
        tableId,
        round: null,
        seatCapacity,
        selectedSeat: 0,
        stacks: emptyTableStacks(seatCapacity),
        placementOrder: [],
        display: idleDisplay(),
        selectedChip: chip,
        notice: null,
        shoeSize: shoe.size(),
        shoeDealt: 0,
        session: freshSession(s.balance, goalId),
      });
      refreshSeatCapacityState();
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
      sounds.setAmbience('lobby');
      set({
        screen: 'lobby',
        round: null,
        stacks: emptyTableStacks(get().seatCapacity),
        placementOrder: [],
        display: idleDisplay(),
        session: null,
      });
      refreshSeatCapacityState();
    },

    enterMines() {
      presentToken++;
      shoe = null;
      sounds.setAmbience('salon');
      sounds.startAmbience();
      set({
        screen: 'mines',
        round: null,
        stacks: emptyTableStacks(get().seatCapacity),
        placementOrder: [],
        display: idleDisplay(),
        session: null,
        notice: null,
      });
    },

    leaveMines() {
      sounds.setAmbience('lobby');
      set({ screen: 'lobby', notice: null });
    },

    minesDebit(bet) {
      const s = get();
      const amount = Math.floor(bet);
      if (amount <= 0 || amount > s.balance) return false;
      set({
        balance: s.balance - amount,
        notice: null,
      });
      persist();
      markScoreDirty();
      return true;
    },

    minesCredit(payout, countGame = true) {
      const s = get();
      const meta = {
        peakBalance: s.peakBalance,
        gamesPlayed: s.gamesPlayed,
        gamesBeforePeak: s.gamesBeforePeak,
      };
      const settled = countGame
        ? settleGamePeak(s.balance, payout, meta)
        : creditWithoutGame(s.balance, payout, meta);
      set({
        balance: settled.balance,
        peakBalance: settled.peakBalance,
        gamesPlayed: settled.gamesPlayed,
        gamesBeforePeak: settled.gamesBeforePeak,
      });
      persist();
      markScoreDirty();
    },

    enterCraps() {
      presentToken++;
      shoe = null;
      sounds.setAmbience('salon');
      sounds.startAmbience();
      set({
        screen: 'craps',
        round: null,
        stacks: emptyTableStacks(get().seatCapacity),
        placementOrder: [],
        display: idleDisplay(),
        session: null,
        notice: null,
      });
    },

    leaveCraps() {
      sounds.setAmbience('lobby');
      set({ screen: 'lobby', notice: null });
    },

    crapsDebit(bet) {
      const s = get();
      const amount = Math.floor(bet);
      if (amount <= 0 || amount > s.balance) return false;
      set({
        balance: s.balance - amount,
        notice: null,
      });
      persist();
      markScoreDirty();
      return true;
    },

    crapsCredit(payout, countGame = true) {
      const s = get();
      const meta = {
        peakBalance: s.peakBalance,
        gamesPlayed: s.gamesPlayed,
        gamesBeforePeak: s.gamesBeforePeak,
      };
      const settled = countGame
        ? settleGamePeak(s.balance, payout, meta)
        : creditWithoutGame(s.balance, payout, meta);
      set({
        balance: settled.balance,
        peakBalance: settled.peakBalance,
        gamesPlayed: settled.gamesPlayed,
        gamesBeforePeak: settled.gamesBeforePeak,
      });
      persist();
      markScoreDirty();
    },

    enterCrash() {
      presentToken++;
      shoe = null;
      sounds.setAmbience('salon');
      sounds.startAmbience();
      set({
        screen: 'crash',
        round: null,
        stacks: emptyTableStacks(get().seatCapacity),
        placementOrder: [],
        display: idleDisplay(),
        session: null,
        notice: null,
      });
    },

    leaveCrash() {
      sounds.setAmbience('lobby');
      set({ screen: 'lobby', notice: null });
    },

    enterPlinko() {
      presentToken++;
      shoe = null;
      sounds.setAmbience('salon');
      sounds.startAmbience();
      set({
        screen: 'plinko',
        round: null,
        stacks: emptyTableStacks(get().seatCapacity),
        placementOrder: [],
        display: idleDisplay(),
        session: null,
        notice: null,
      });
    },

    leavePlinko() {
      sounds.setAmbience('lobby');
      set({ screen: 'lobby', notice: null });
    },

    plinkoDebit(bet) {
      const s = get();
      const amount = Math.floor(bet);
      if (amount <= 0 || amount > s.balance) return false;
      set({
        balance: s.balance - amount,
        notice: null,
      });
      persist();
      markScoreDirty();
      return true;
    },

    plinkoCredit(payout, countGame = true) {
      const s = get();
      const meta = {
        peakBalance: s.peakBalance,
        gamesPlayed: s.gamesPlayed,
        gamesBeforePeak: s.gamesBeforePeak,
      };
      const settled = countGame
        ? settleGamePeak(s.balance, payout, meta)
        : creditWithoutGame(s.balance, payout, meta);
      set({
        balance: settled.balance,
        peakBalance: settled.peakBalance,
        gamesPlayed: settled.gamesPlayed,
        gamesBeforePeak: settled.gamesBeforePeak,
      });
      persist();
      markScoreDirty();
    },

    crashDebit(bet) {
      const s = get();
      const amount = Math.floor(bet);
      if (amount <= 0 || amount > s.balance) return false;
      set({
        balance: s.balance - amount,
        notice: null,
      });
      persist();
      markScoreDirty();
      return true;
    },

    crashCredit(payout, countGame = true) {
      const s = get();
      const meta = {
        peakBalance: s.peakBalance,
        gamesPlayed: s.gamesPlayed,
        gamesBeforePeak: s.gamesBeforePeak,
      };
      const settled = countGame
        ? settleGamePeak(s.balance, payout, meta)
        : creditWithoutGame(s.balance, payout, meta);
      set({
        balance: settled.balance,
        peakBalance: settled.peakBalance,
        gamesPlayed: settled.gamesPlayed,
        gamesBeforePeak: settled.gamesBeforePeak,
      });
      persist();
      markScoreDirty();
    },

    selectChip(denom) {
      sounds.play('click');
      set({ selectedChip: denom });
    },

    selectSeat(seatIndex) {
      const s = get();
      if (s.round || seatIndex < 0 || seatIndex >= s.seatCapacity) return;
      sounds.play('click');
      set({ selectedSeat: seatIndex });
    },

    refreshSeatCapacity() {
      refreshSeatCapacityState();
    },

    addChip(spot) {
      const s = get();
      if (s.round) return;
      const table = getTable(s.tableId);
      const denom = s.selectedChip;
      const seatIndex = Math.min(s.selectedSeat, s.seatCapacity - 1);
      const seatStacks = s.stacks[seatIndex] ?? emptyStacks();
      const staged = stagedTotal(s.stacks);
      if (staged + denom > s.balance) {
        set({ notice: 'Solde insuffisant pour ce jeton.' });
        return;
      }
      const max = spot === 'main' ? table.rules.maxBet : table.rules.sideBetMax;
      if (sum(seatStacks[spot]) + denom > max) {
        set({ notice: `Limite de mise atteinte sur cette zone.` });
        return;
      }
      const stacks = resizeTableStacks(s.stacks, s.seatCapacity);
      stacks[seatIndex] = {
        ...stacks[seatIndex],
        [spot]: [...stacks[seatIndex][spot], denom],
      };
      sounds.play('chip');
      set({
        stacks,
        selectedSeat: seatIndex,
        placementOrder: [...s.placementOrder, { seatIndex, spot }],
        notice: null,
      });
    },

    undoLastChip() {
      const s = get();
      if (s.round || s.placementOrder.length === 0) return;
      const { seatIndex, spot } = s.placementOrder[s.placementOrder.length - 1];
      if (!s.stacks[seatIndex]) return;
      const stacks = resizeTableStacks(s.stacks, s.seatCapacity);
      stacks[seatIndex] = {
        ...stacks[seatIndex],
        [spot]: stacks[seatIndex][spot].slice(0, -1),
      };
      sounds.play('chip');
      set({
        stacks,
        selectedSeat: Math.min(seatIndex, s.seatCapacity - 1),
        placementOrder: s.placementOrder.slice(0, -1),
      });
    },

    clearBets() {
      const s = get();
      if (s.round) return;
      sounds.play('chipStack');
      set({ stacks: emptyTableStacks(s.seatCapacity), placementOrder: [] });
    },

    rebet() {
      const s = get();
      if (s.round) return false;
      const last = s.lastBets[s.tableId];
      if (!last || last.length === 0) return false;
      if (last.some((seatBet) => seatBet.seatIndex >= s.seatCapacity)) {
        set({ notice: 'Passe en paysage pour rejouer les 7 places.' });
        return false;
      }
      const total = last.reduce((acc, seatBet) => acc + betLayoutTotal(seatBet.bets), 0);
      if (total > s.balance) {
        set({ notice: 'Solde insuffisant pour rejouer la mise précédente.' });
        return false;
      }
      const table = getTable(s.tableId);
      const denoms = chipsForLimits(table.rules.minBet, table.rules.maxBet);
      const stacks = emptyTableStacks(s.seatCapacity);
      const order: ChipPlacement[] = [];
      for (const { seatIndex, bets } of last) {
        if (seatIndex < 0 || seatIndex >= s.seatCapacity) continue;
        stacks[seatIndex].main = decompose(bets.main, denoms);
        for (let i = 0; i < stacks[seatIndex].main.length; i++) {
          order.push({ seatIndex, spot: 'main' });
        }
        for (const [id, amount] of Object.entries(bets.sideBets)) {
          if (!amount) continue;
          const spot = id as SideBetId;
          stacks[seatIndex][spot] = decompose(amount, denoms);
          for (let i = 0; i < stacks[seatIndex][spot].length; i++) {
            order.push({ seatIndex, spot });
          }
        }
      }
      sounds.play('chipStack');
      set({ stacks, placementOrder: order, selectedSeat: last[0]?.seatIndex ?? 0, notice: null });
      return true;
    },

    deal() {
      const s = get();
      if (s.round || !shoe) return;
      const table = getTable(s.tableId);
      const seats: TableSeatInput[] = [];
      let total = 0;
      for (let seatIndex = 0; seatIndex < s.seatCapacity; seatIndex++) {
        const seatStacks = s.stacks[seatIndex] ?? emptyStacks();
        const bets = betLayoutFromStacks(seatStacks, table.rules.sideBets);
        const sideTotal = sum(Object.values(bets.sideBets).filter((x): x is number => x !== undefined));
        if (bets.main === 0 && sideTotal > 0) {
          set({ notice: `Place ${seatIndex + 1} : ajoute une mise principale.` });
          return;
        }
        if (bets.main > 0 && bets.main < table.rules.minBet) {
          set({ notice: `Place ${seatIndex + 1} : mise principale minimale ${table.rules.minBet / 100}.` });
          return;
        }
        for (const [id, amount] of Object.entries(bets.sideBets)) {
          if (!amount) continue;
          if (amount < table.rules.sideBetMin) {
            set({ notice: `Place ${seatIndex + 1} : side bet minimal ${table.rules.sideBetMin / 100}.` });
            return;
          }
          if (!table.rules.sideBets.includes(id as SideBetId)) {
            set({ notice: `Side bet non proposée à cette table.` });
            return;
          }
        }
        if (bets.main >= table.rules.minBet) {
          seats.push({ seatIndex, bets });
          total += betLayoutTotal(bets);
        }
      }
      if (seats.length === 0) {
        set({ notice: `Mise principale minimale : ${table.rules.minBet / 100}.` });
        return;
      }
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

      const round = new TableRound(table.rules, shoe, seats);
      const token = ++presentToken;
      const t = timing();
      const dealCardCount = seats.length * 2 + 2;
      const dealUnlock = t.dealUnlock + Math.max(0, dealCardCount - 4) * t.dealGap;
      const dealFlashIds = round.seats.flatMap((seat) =>
        seat.dealSideBetResults
          .filter((r) => r.returned > 0)
          .map((r) => `${seat.seatIndex}:${r.id}`),
      );

      set({
        balance: s.balance - total,
        round,
        lastBets: {
          ...s.lastBets,
          [s.tableId]: seats.map((seatBet) => ({
            seatIndex: seatBet.seatIndex,
            bets: cloneBetLayout(seatBet.bets),
          })),
        },
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
      markScoreDirty();

      // Chorégraphie : une pulsation par carte distribuée sur la table.
      for (let i = 0; i < dealCardCount; i++) {
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
      }, dealUnlock);
    },

    rebetAndDeal() {
      const s = get();
      if (!s.display.resultsShown) return;
      // Remet la manche, remiser, puis donner.
      presentToken++;
      set({
        round: null,
        stacks: emptyTableStacks(get().seatCapacity),
        placementOrder: [],
        display: idleDisplay(),
      });
      refreshSeatCapacityState();
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
      const hand = round.activeHand;
      if (!hand) return;
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
      set({
        round: null,
        stacks: emptyTableStacks(s.seatCapacity),
        placementOrder: [],
        display: idleDisplay(),
      });
      refreshSeatCapacityState();
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

    creditDefiReward(amountCents, label) {
      const amount = Math.max(0, Math.floor(amountCents));
      if (amount <= 0) return;
      const s = get();
      const settled = creditWithoutGame(s.balance, amount, {
        peakBalance: s.peakBalance,
        gamesPlayed: s.gamesPlayed,
        gamesBeforePeak: s.gamesBeforePeak,
      });
      set({
        balance: settled.balance,
        peakBalance: settled.peakBalance,
        gamesBeforePeak: settled.gamesBeforePeak,
        notice: `Défi accompli — ${label} · +${Math.floor(amount / 100)} crédit`,
      });
      persist();
      markScoreDirty();
    },

    vaultDeposit(amountCents) {
      const s = get();
      if (s.round) {
        set({ notice: 'Terminez la manche avant d’utiliser le coffre.' });
        return;
      }
      const result = depositToVault(s.balance, s.vault, amountCents);
      if (!result.ok) {
        set({ notice: result.error });
        return;
      }
      sounds.play('chipStack');
      set({
        balance: result.balance,
        vault: result.vault,
        notice:
          vaultableAmount(result.balance) <= 0
            ? `Coffré — ${fmt(result.vault)} à l’abri. Les ${STARTING_BALANCE / 100} de base restent jouables.`
            : `Coffré. Coffre : ${fmt(result.vault)}.`,
      });
      persist();
      markScoreDirty();
    },

    vaultWithdraw(amountCents) {
      const s = get();
      if (s.round) {
        set({ notice: 'Terminez la manche avant d’utiliser le coffre.' });
        return;
      }
      const result = withdrawFromVault(s.balance, s.vault, amountCents);
      if (!result.ok) {
        set({ notice: result.error });
        return;
      }
      sounds.play('chipStack');
      const settled = creditWithoutGame(s.balance, result.balance - s.balance, {
        peakBalance: s.peakBalance,
        gamesPlayed: s.gamesPlayed,
        gamesBeforePeak: s.gamesBeforePeak,
      });
      set({
        balance: settled.balance,
        vault: result.vault,
        peakBalance: settled.peakBalance,
        gamesBeforePeak: settled.gamesBeforePeak,
        notice: `Retiré du coffre. Crédit : ${fmt(settled.balance)}.`,
      });
      persist();
      markScoreDirty();
    },

    applyIncomingVault(cloudVault, cloudBalance) {
      const s = get();
      const next = mergeIncomingVault({
        localBalance: s.balance,
        localVault: s.vault,
        cloudBalance,
        cloudVault,
      });
      if (next === s.vault) return;
      set({ vault: next });
      persist();
    },

    applyVaultAtLeast(vaultCents, cloudBalance) {
      const s = get();
      if (typeof cloudBalance === 'number') {
        get().applyIncomingVault(vaultCents, cloudBalance);
        return;
      }
      // Sans solde cloud : ne jamais remonter le coffre (évite le glitch).
      // Les cadeaux passent par peekIncomingVault qui fournit le solde.
      void s;
      void vaultCents;
    },

    applyVaultServerState(payload, notice) {
      const balance = Math.max(0, Math.floor(payload.balance));
      const vault = Math.max(0, Math.floor(payload.vault));
      const peakBalance =
        typeof payload.peakBalance === 'number'
          ? Math.max(balance, Math.floor(payload.peakBalance))
          : Math.max(get().peakBalance, balance);
      set({
        balance,
        vault,
        peakBalance,
        ...(notice ? { notice } : {}),
      });
      persist();
      markScoreDirty();
    },

    setVaultFromServer(vaultCents, notice) {
      const next = Math.max(0, Math.floor(vaultCents));
      set({
        vault: next,
        ...(notice ? { notice } : {}),
      });
      persist();
    },

    refill() {
      const s = get();
      if (s.round) return;
      /** Seulement à crédit épuisé (< 1) — on remet à 100, on n’ajoute pas. */
      if (s.balance >= 1_00) return;
      sounds.play('chipStack');
      set({
        balance: STARTING_BALANCE,
        peakBalance: Math.max(s.peakBalance, STARTING_BALANCE),
        refills: s.refills + 1,
        notice: 'Crédit reconstitué.',
      });
      persist();
      markScoreDirty();
    },

    hydrateFromCloud(payload) {
      const s = get();
      if (s.round) {
        set({ notice: 'Terminez la manche avant de synchroniser le compte.' });
        return;
      }
      const balance = Math.max(0, Math.floor(payload.balance));
      const peakBalance = Math.max(balance, Math.floor(payload.peakBalance));
      const vault =
        typeof payload.vault === 'number'
          ? Math.max(0, Math.floor(payload.vault))
          : s.vault;
      set({
        balance,
        vault,
        peakBalance,
        gamesPlayed: payload.gamesPlayed ?? s.gamesPlayed,
        gamesBeforePeak: payload.gamesBeforePeak ?? s.gamesBeforePeak,
        stats: {
          ...s.stats,
          handsPlayed: payload.handsPlayed ?? s.stats.handsPlayed,
          blackjacks: payload.blackjacks ?? s.stats.blackjacks,
          longestWinStreak: payload.bestStreak ?? s.stats.longestWinStreak,
        },
        tableId: payload.highestTable ?? s.tableId,
        notice: 'Compte connecté — crédit synchronisé.',
      });
      persist();
    },

    resetAll() {
      presentToken++;
      shoe = null;
      const privateLimits = { minBet: 250_00, maxBet: 25_000_00 };
      const seatCapacity = orientationSeatCapacity();
      setEnginePrivateLimits(privateLimits);
      set({
        balance: STARTING_BALANCE,
        vault: 0,
        peakBalance: STARTING_BALANCE,
        gamesPlayed: 0,
        gamesBeforePeak: 0,
        refills: 0,
        screen: 'lobby',
        tableId: 'emeraude',
        privateLimits,
        round: null,
        seatCapacity,
        selectedSeat: 0,
        stacks: emptyTableStacks(seatCapacity),
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

    qaForceInsurance() {
      const s = get();
      const table = getTable(s.tableId || 'emeraude');
      // Ordre TableRound : S0c1, S1c1, Up(As), S0c2, S1c2, Hole
      const codes = ['4S', '2D', 'AH', '8C', '4C', '9D'];
      const rigged = new RiggedShoe(codes.map((c, i) => card(c, `qa-${c}-${i}`)));
      shoe = rigged;
      const seats: TableSeatInput[] = [
        { seatIndex: 0, bets: { main: 10_00, sideBets: {} } },
        { seatIndex: 1, bets: { main: 5_00, sideBets: {} } },
      ];
      const round = new TableRound(table.rules, rigged, seats);
      presentToken++;
      set({
        screen: 'table',
        tableId: s.tableId || 'emeraude',
        balance: Math.max(s.balance, 100_00),
        round,
        session: s.session ?? freshSession(Math.max(s.balance, 100_00)),
        display: {
          dealing: false,
          holeShown: false,
          dealerShown: 2,
          resultsShown: false,
          payoutPhase: 'idle',
          payoutFlies: [],
          dealFlashIds: [],
          animatedNet: 0,
        },
        notice: null,
        shoeSize: rigged.size(),
        shoeDealt: rigged.cardsDealt(),
      });
      bump();
    },
  };
});

export function stagedTotal(stacks: SeatStacks[] | SeatStacks): number {
  return Array.isArray(stacks)
    ? stacks.reduce((total, seatStacks) => total + seatStagedTotal(seatStacks), 0)
    : seatStagedTotal(stacks);
}

export { isNaturalBlackjack };
