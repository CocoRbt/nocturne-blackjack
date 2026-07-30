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
  handsPlayed: number;
  blackjacks: number;
  bestStreak: number;
  highestTable: string;
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
    return JSON.parse(raw) as LocalCircleState;
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
    handsPlayed: score.handsPlayed,
    blackjacks: score.blackjacks,
    bestStreak: score.bestStreak,
    highestTable: score.highestTable,
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
    });
    const boards = await fetchLeaderboards();
    const members = mergeBoardMembers(boards, name);
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
    const boards = await fetchLeaderboards();
    const next: LocalCircleState = {
      ...state,
      members: mergeBoardMembers(boards, state.nickname),
    };
    saveCircle(next);
    return { state: next, boards };
  }
  return { state, boards: leaderboardsFromLocal(state) };
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
      });
      const boards = await fetchLeaderboards();
      const next = { ...local, members: mergeBoardMembers(boards, state.nickname), cloud: true };
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
  if (isSupabaseConfigured()) {
    try {
      await leaveCircleCloud();
    } catch {
      // ignore
    }
  }
  clearCircleLocal();
}

function mergeBoardMembers(boards: Leaderboards, me: string): CircleMemberScore[] {
  const map = new Map<string, CircleMemberScore>();
  for (const row of [...boards.live, ...boards.peak]) {
    const prev = map.get(row.nickname);
    map.set(row.nickname, {
      nickname: row.nickname,
      balance: row.balance,
      peakBalance: Math.max(row.peak_balance, prev?.peakBalance ?? 0),
      handsPlayed: prev?.handsPlayed ?? 0,
      blackjacks: prev?.blackjacks ?? 0,
      bestStreak: prev?.bestStreak ?? 0,
      highestTable: prev?.highestTable ?? 'emeraude',
      updatedAt: Date.parse(row.updated_at) || Date.now(),
    });
  }
  if (!map.has(me)) {
    // keep me visible even if board empty
  }
  return [...map.values()].sort((a, b) => b.peakBalance - a.peakBalance);
}

export type { LeaderboardRow, Leaderboards };
export { isSupabaseConfigured };
