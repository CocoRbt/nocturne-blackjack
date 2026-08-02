/**
 * Cercle potes — état local + sync Supabase.
 * Auth anonyme (pas de compte email) : pseudo + code cercle.
 * Classements : crédit actuel (live) + record (peak).
 */

import {
  fetchLeaderboards,
  isSupabaseConfigured,
  joinCircleCloud,
  leaveCircleCloud,
  syncScoreCloud,
  type LeaderboardRow,
  type Leaderboards,
} from './circleApi';

export interface CircleMemberScore {
  nickname: string;
  balance: number;
  peakBalance: number;
  vault: number;
  handsPlayed: number;
  blackjacks: number;
  bestStreak: number;
  highestTable: string;
  gamesBeforePeak: number;
  gamesPlayed: number;
  updatedAt: number;
}

export interface LocalCircleState {
  nickname: string;
  circleCode: string | null;
  members: CircleMemberScore[];
  cloud?: boolean;
}

const KEY = 'nocturne-cercle';

export function loadCircle(): LocalCircleState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalCircleState;
    return {
      ...parsed,
      members: (parsed.members ?? []).map((m) => ({
        ...m,
        vault: m.vault ?? 0,
        gamesBeforePeak: m.gamesBeforePeak ?? 0,
        gamesPlayed: m.gamesPlayed ?? 0,
      })),
    };
  } catch {
    return null;
  }
}

export function saveCircle(state: LocalCircleState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function clearCircleLocal(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function generateCircleCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'NOC-';
  for (let i = 0; i < 4; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function upsertSelfScore(
  state: LocalCircleState,
  score: Omit<CircleMemberScore, 'nickname' | 'updatedAt'> & { nickname?: string },
): LocalCircleState {
  const nickname = score.nickname ?? state.nickname;
  const next: CircleMemberScore = {
    nickname,
    balance: score.balance,
    peakBalance: score.peakBalance,
    vault: score.vault ?? 0,
    handsPlayed: score.handsPlayed,
    blackjacks: score.blackjacks,
    bestStreak: score.bestStreak,
    highestTable: score.highestTable,
    gamesBeforePeak: score.gamesBeforePeak,
    gamesPlayed: score.gamesPlayed,
    updatedAt: Date.now(),
  };
  const others = state.members.filter((m) => m.nickname !== nickname);
  return {
    ...state,
    nickname,
    members: [next, ...others].sort((a, b) => b.peakBalance - a.peakBalance),
  };
}

export function leaderboardsFromLocal(state: LocalCircleState): Leaderboards {
  const live = [...state.members]
    .sort((a, b) => b.balance - a.balance)
    .map((m, i) => ({
      rank: i + 1,
      nickname: m.nickname,
      balance: m.balance,
      peak_balance: m.peakBalance,
      vault: m.vault,
      games_before_peak: m.gamesBeforePeak,
      updated_at: new Date(m.updatedAt).toISOString(),
      is_me: m.nickname === state.nickname,
    }));
  const peak = [...state.members]
    .sort((a, b) => b.peakBalance - a.peakBalance)
    .map((m, i) => ({
      rank: i + 1,
      nickname: m.nickname,
      balance: m.balance,
      peak_balance: m.peakBalance,
      vault: m.vault,
      games_before_peak: m.gamesBeforePeak,
      updated_at: new Date(m.updatedAt).toISOString(),
      is_me: m.nickname === state.nickname,
    }));
  return { live, peak };
}

export async function enterCircle(nickname: string, code: string | undefined, seed: Omit<CircleMemberScore, 'nickname' | 'updatedAt'>): Promise<LocalCircleState> {
  const name = nickname.trim().slice(0, 16);
  if (isSupabaseConfigured()) {
    const joined = await joinCircleCloud(name, code);
    await syncScoreCloud({
      balance: seed.balance,
      peakBalance: seed.peakBalance,
      handsPlayed: seed.handsPlayed,
      blackjacks: seed.blackjacks,
      bestStreak: seed.bestStreak,
      highestTable: seed.highestTable,
      gamesBeforePeak: seed.gamesBeforePeak,
      gamesPlayed: seed.gamesPlayed,
      vault: seed.vault,
    });
    const boards = await fetchLeaderboards();
    const members = mergeBoardMembers(boards, name, []);
    const state: LocalCircleState = {
      nickname: joined.nickname,
      circleCode: joined.circle_code,
      members,
      cloud: true,
    };
    saveCircle(state);
    return state;
  }

  const finalCode = (code?.trim() || generateCircleCode()).toUpperCase();
  const base: LocalCircleState = {
    nickname: name,
    circleCode: finalCode,
    members: [],
    cloud: false,
  };
  const state = upsertSelfScore(base, { ...seed, nickname: name });
  saveCircle(state);
  return state;
}

export async function refreshLeaderboards(state: LocalCircleState): Promise<{ state: LocalCircleState; boards: Leaderboards }> {
  if (state.cloud && isSupabaseConfigured()) {
    try {
      const boards = await fetchLeaderboards();
      const merged = mergeBoardMembers(boards, state.nickname, state.members);
      // Session cassée / nouveau anon → boards vides : ne pas écraser le cache local.
      const boardEmpty = (boards.live?.length ?? 0) === 0 && (boards.peak?.length ?? 0) === 0;
      if (boardEmpty && state.members.length > 0) {
        return { state, boards: leaderboardsFromLocal(state) };
      }
      const next: LocalCircleState = {
        ...state,
        members: merged.length > 0 ? merged : state.members,
      };
      saveCircle(next);
      return { state: next, boards };
    } catch {
      return { state, boards: leaderboardsFromLocal(state) };
    }
  }
  return { state, boards: leaderboardsFromLocal(state) };
}

/** Restaure le cercle local après connexion compte (même uid / membership cloud). */
export async function restoreCircleFromCloud(
  score: {
    nickname?: string | null;
    circle_code?: string | null;
    in_circle?: boolean;
    balance?: number;
    peak_balance?: number;
    vault?: number;
    hands_played?: number;
    blackjacks?: number;
    best_streak?: number;
    highest_table?: string;
    games_before_peak?: number;
    games_played?: number;
  },
): Promise<LocalCircleState | null> {
  if (!score.in_circle || !score.circle_code || !score.nickname) return null;
  const seed = {
    balance: score.balance ?? 0,
    peakBalance: score.peak_balance ?? 0,
    vault: score.vault ?? 0,
    handsPlayed: score.hands_played ?? 0,
    blackjacks: score.blackjacks ?? 0,
    bestStreak: score.best_streak ?? 0,
    highestTable: score.highest_table ?? 'emeraude',
    gamesBeforePeak: score.games_before_peak ?? 0,
    gamesPlayed: score.games_played ?? 0,
  };
  const base: LocalCircleState = {
    nickname: score.nickname,
    circleCode: score.circle_code,
    members: [],
    cloud: true,
  };
  let state = upsertSelfScore(base, { ...seed, nickname: score.nickname });
  saveCircle(state);
  try {
    const refreshed = await refreshLeaderboards(state);
    return refreshed.state;
  } catch {
    return state;
  }
}

export async function pushScore(state: LocalCircleState, seed: Omit<CircleMemberScore, 'nickname' | 'updatedAt'>): Promise<LocalCircleState> {
  const local = upsertSelfScore(state, { ...seed, nickname: state.nickname });
  if (state.cloud && isSupabaseConfigured()) {
    try {
      await syncScoreCloud({
        balance: seed.balance,
        peakBalance: seed.peakBalance,
        handsPlayed: seed.handsPlayed,
        blackjacks: seed.blackjacks,
        bestStreak: seed.bestStreak,
        highestTable: seed.highestTable,
        gamesBeforePeak: seed.gamesBeforePeak,
        gamesPlayed: seed.gamesPlayed,
        vault: seed.vault,
      });
      const boards = await fetchLeaderboards();
      const next = {
        ...local,
        members: mergeBoardMembers(boards, state.nickname, local.members),
        cloud: true,
      };
      saveCircle(next);
      return next;
    } catch {
      saveCircle(local);
      return local;
    }
  }
  saveCircle(local);
  return local;
}

export async function exitCircle(): Promise<void> {
  // Local d’abord : l’UI ne reste jamais bloquée si le réseau rame
  clearCircleLocal();
  if (isSupabaseConfigured()) {
    try {
      await leaveCircleCloud();
    } catch {
      // ignore — déjà sorti en local
    }
  }
}

function mergeBoardMembers(
  boards: Leaderboards,
  me: string,
  previous: CircleMemberScore[] = [],
): CircleMemberScore[] {
  const map = new Map<string, CircleMemberScore>();
  for (const m of previous) map.set(m.nickname, m);
  for (const row of [...boards.live, ...boards.peak]) {
    const prev = map.get(row.nickname);
    const peakBalance = Math.max(row.peak_balance, prev?.peakBalance ?? 0);
    const fromPeakRow = row.peak_balance >= (prev?.peakBalance ?? 0);
    map.set(row.nickname, {
      nickname: row.nickname,
      balance: row.balance,
      peakBalance,
      vault: row.vault ?? prev?.vault ?? 0,
      handsPlayed: prev?.handsPlayed ?? 0,
      blackjacks: prev?.blackjacks ?? 0,
      bestStreak: prev?.bestStreak ?? 0,
      highestTable: prev?.highestTable ?? 'emeraude',
      gamesBeforePeak: fromPeakRow
        ? (row.games_before_peak ?? prev?.gamesBeforePeak ?? 0)
        : (prev?.gamesBeforePeak ?? row.games_before_peak ?? 0),
      gamesPlayed: prev?.gamesPlayed ?? 0,
      updatedAt: Date.parse(row.updated_at) || Date.now(),
    });
  }
  if (!map.has(me) && previous.some((m) => m.nickname === me)) {
    const self = previous.find((m) => m.nickname === me);
    if (self) map.set(me, self);
  }
  return [...map.values()].sort((a, b) => b.peakBalance - a.peakBalance);
}

/**
 * Superpose mon score local sur les classements cloud.
 * Évite qu’un refresh stale (migration pas appliquée / sync en échec)
 * n’affiche un ancien crédit ou « dès le départ » pour soi-même.
 */
export function overlaySelfOnBoards(
  boards: Leaderboards,
  me: string,
  self: { balance: number; peakBalance: number; gamesBeforePeak: number; vault: number },
): Leaderboards {
  const patchLive = (rows: LeaderboardRow[]): LeaderboardRow[] => {
    let seen = false;
    const next = rows.map((r) => {
      if (r.nickname !== me && !r.is_me) return r;
      seen = true;
      return {
        ...r,
        balance: self.balance,
        peak_balance: Math.max(r.peak_balance, self.peakBalance),
        vault: self.vault,
        games_before_peak: r.games_before_peak ?? self.gamesBeforePeak,
        is_me: true,
      };
    });
    if (!seen && me) {
      next.push({
        rank: next.length + 1,
        nickname: me,
        balance: self.balance,
        peak_balance: self.peakBalance,
        vault: self.vault,
        games_before_peak: self.gamesBeforePeak,
        updated_at: new Date().toISOString(),
        is_me: true,
      });
    }
    return next
      .sort((a, b) => b.balance - a.balance || a.nickname.localeCompare(b.nickname))
      .map((r, i) => ({ ...r, rank: i + 1 }));
  };

  const patchPeak = (rows: LeaderboardRow[]): LeaderboardRow[] => {
    let seen = false;
    const next = rows.map((r) => {
      if (r.nickname !== me && !r.is_me) return r;
      seen = true;
      const peak = Math.max(r.peak_balance, self.peakBalance);
      const gamesBefore =
        self.peakBalance >= r.peak_balance
          ? self.gamesBeforePeak
          : (r.games_before_peak ?? self.gamesBeforePeak);
      return {
        ...r,
        balance: self.balance,
        peak_balance: peak,
        vault: self.vault,
        games_before_peak: gamesBefore,
        is_me: true,
      };
    });
    if (!seen && me) {
      next.push({
        rank: next.length + 1,
        nickname: me,
        balance: self.balance,
        peak_balance: self.peakBalance,
        vault: self.vault,
        games_before_peak: self.gamesBeforePeak,
        updated_at: new Date().toISOString(),
        is_me: true,
      });
    }
    return next
      .sort((a, b) => b.peak_balance - a.peak_balance || a.nickname.localeCompare(b.nickname))
      .map((r, i) => ({ ...r, rank: i + 1 }));
  };

  return {
    live: patchLive(boards.live),
    peak: patchPeak(boards.peak),
  };
}

export type { LeaderboardRow, Leaderboards };
export { isSupabaseConfigured };
