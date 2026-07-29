import type { HandOutcome, SideBetId } from '../engine/types';

export const STARTING_BALANCE = 1_000_00; // 1 000 jetons en centimes

export interface HistoryHand {
  outcome: HandOutcome;
  bet: number;
  net: number;
  cards: string[];
  total: number;
}

export interface HistoryEntry {
  id: number;
  at: number;
  tableId: string;
  hands: HistoryHand[];
  dealerCards: string[];
  dealerTotal: number;
  dealerBust: boolean;
  sideBets: { id: SideBetId; bet: number; net: number; label: string | null }[];
  insuranceNet: number | null;
  net: number;
  wagered: number;
  balanceAfter: number;
}

export interface SideBetStat {
  placed: number;
  wagered: number;
  won: number;
  net: number;
}

export interface Stats {
  rounds: number;
  handsPlayed: number;
  wins: number;
  losses: number;
  pushes: number;
  blackjacks: number;
  surrenders: number;
  doubles: number;
  splits: number;
  totalWagered: number;
  netTotal: number;
  biggestWin: number;
  currentStreak: number;
  longestWinStreak: number;
  insuranceTaken: number;
  insuranceWon: number;
  insuranceNet: number;
  sideBets: Record<SideBetId, SideBetStat>;
}

const emptySide = (): SideBetStat => ({ placed: 0, wagered: 0, won: 0, net: 0 });

export function emptyStats(): Stats {
  return {
    rounds: 0,
    handsPlayed: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    blackjacks: 0,
    surrenders: 0,
    doubles: 0,
    splits: 0,
    totalWagered: 0,
    netTotal: 0,
    biggestWin: 0,
    currentStreak: 0,
    longestWinStreak: 0,
    insuranceTaken: 0,
    insuranceWon: 0,
    insuranceNet: 0,
    sideBets: {
      perfectPairs: emptySide(),
      twentyOnePlusThree: emptySide(),
      luckyLadies: emptySide(),
      bustIt: emptySide(),
      royalMatch: emptySide(),
    },
  };
}

export interface SaveData {
  version: 1;
  balance: number;
  refills: number;
  soundMuted: boolean;
  tableId: string;
  history: HistoryEntry[];
  stats: Stats;
  lastBets: Record<string, { main: number; sideBets: Partial<Record<SideBetId, number>> }>;
  /** Mode de rythme — optionnel pour les anciennes sauvegardes. */
  gameSpeed?: 'classic' | 'fast';
}

const KEY = 'nocturne-blackjack-save';

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== 1) return null;
    if (typeof data.balance !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

export function persistSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // stockage indisponible : le jeu reste jouable sans sauvegarde
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
