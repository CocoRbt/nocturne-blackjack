import type { BetLayout, HandOutcome, SideBetId } from '../engine/types';
import type { PrivateLimits } from '../engine/rules';

/** Solde de départ : assez pour Émeraude, sous le seuil Onyx (500). */
export const STARTING_BALANCE = 100_00;

export interface HistoryHand {
  seatIndex?: number;
  outcome: HandOutcome;
  bet: number;
  cards: string[];
  total: number;
  net: number;
}

export interface HistoryEntry {
  id: number;
  at: number;
  tableId: string;
  hands: HistoryHand[];
  dealerCards: string[];
  dealerTotal: number;
  dealerBust: boolean;
  sideBets: { seatIndex?: number; id: SideBetId; bet: number; net: number; label: string | null }[];
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

export interface CircleProfileLocal {
  nickname: string;
  circleCode: string | null;
}

export interface StoredSeatBet {
  seatIndex: number;
  bets: BetLayout;
}

export interface SaveData {
  version: 2;
  balance: number;
  /** Plus haut solde atteint (progression / unlock). */
  peakBalance: number;
  refills: number;
  soundMuted: boolean;
  tableId: string;
  history: HistoryEntry[];
  stats: Stats;
  lastBets: Record<string, StoredSeatBet[]>;
  gameSpeed?: 'classic' | 'fast';
  privateLimits?: PrivateLimits;
  /** Profil local du cercle (sync Supabase plus tard). */
  circle?: CircleProfileLocal | null;
}

const KEY = 'nocturne-blackjack-save';

function isBetLayout(value: unknown): value is BetLayout {
  if (!value || typeof value !== 'object') return false;
  const bet = value as Partial<BetLayout>;
  return typeof bet.main === 'number' && !!bet.sideBets && typeof bet.sideBets === 'object';
}

function normalizeLastBets(value: unknown): SaveData['lastBets'] {
  if (!value || typeof value !== 'object') return {};
  const out: SaveData['lastBets'] = {};
  for (const [tableId, rawTableBets] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(rawTableBets)) {
      const seats: StoredSeatBet[] = [];
      rawTableBets.forEach((rawSeatBet, index) => {
        if (!rawSeatBet || typeof rawSeatBet !== 'object') return;
        const entry = rawSeatBet as Partial<StoredSeatBet>;
        const seatIndex = typeof entry.seatIndex === 'number' ? entry.seatIndex : index;
        if (Number.isInteger(seatIndex) && seatIndex >= 0 && isBetLayout(entry.bets)) {
          seats.push({ seatIndex, bets: entry.bets });
        }
      });
      if (seats.length > 0) out[tableId] = seats;
    } else if (isBetLayout(rawTableBets)) {
      out[tableId] = [{ seatIndex: 0, bets: rawTableBets }];
    }
  }
  return out;
}

function migrate(raw: Record<string, unknown>): SaveData | null {
  const version = raw.version;
  if (version !== 1 && version !== 2) return null;
  if (typeof raw.balance !== 'number') return null;

  const balance = raw.balance as number;
  const peakBalance =
    typeof raw.peakBalance === 'number'
      ? Math.max(raw.peakBalance as number, balance)
      : Math.max(balance, STARTING_BALANCE);

  return {
    version: 2,
    balance,
    peakBalance,
    refills: typeof raw.refills === 'number' ? raw.refills : 0,
    soundMuted: Boolean(raw.soundMuted),
    tableId: typeof raw.tableId === 'string' ? raw.tableId : 'emeraude',
    history: Array.isArray(raw.history) ? (raw.history as HistoryEntry[]) : [],
    stats: (raw.stats as Stats) ?? emptyStats(),
    lastBets: normalizeLastBets(raw.lastBets),
    gameSpeed: raw.gameSpeed === 'fast' ? 'fast' : 'classic',
    privateLimits: raw.privateLimits as PrivateLimits | undefined,
    circle: (raw.circle as CircleProfileLocal | null | undefined) ?? null,
  };
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function persistSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, version: 2 }));
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
