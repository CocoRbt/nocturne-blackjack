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
  pullIncomingVault,
  syncScoreCloud,
  type LeaderboardRow,
  type Leaderboards,
} from './circleApi';
import { mergeBoardMembers, boardsAreEmpty } from './boardMerge';
import { enqueueScorePush, getSyncEpoch } from './scoreSync';
import { peakWealthCents, wealthCents } from './wealth';
import { shouldApplyCloudWallet } from './walletReconcile';
import { useGame } from '../store/gameStore';

const CIRCLE_CHANGED = 'nocturne-circle-changed';

export function notifyCircleChanged(): void {
  try {
    window.dispatchEvent(new Event(CIRCLE_CHANGED));
  } catch {
    /* ignore */
  }
}

export function onCircleChanged(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(CIRCLE_CHANGED, handler);
  return () => window.removeEventListener(CIRCLE_CHANGED, handler);
}

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
    .sort(
      (a, b) =>
        wealthCents(b.balance, b.vault) - wealthCents(a.balance, a.vault) ||
        a.nickname.localeCompare(b.nickname),
    )
    .map((m, i) => ({
      rank: i + 1,
      nickname: m.nickname,
      balance: m.balance,
      peak_balance: peakWealthCents(m.peakBalance, m.balance, m.vault),
      vault: m.vault,
      games_before_peak: m.gamesBeforePeak,
      updated_at: new Date(m.updatedAt).toISOString(),
      is_me: m.nickname === state.nickname,
    }));
  const peak = [...state.members]
    .sort(
      (a, b) =>
        peakWealthCents(b.peakBalance, b.balance, b.vault) -
          peakWealthCents(a.peakBalance, a.balance, a.vault) ||
        a.nickname.localeCompare(b.nickname),
    )
    .map((m, i) => ({
      rank: i + 1,
      nickname: m.nickname,
      balance: m.balance,
      peak_balance: peakWealthCents(m.peakBalance, m.balance, m.vault),
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
      if (boardsAreEmpty(boards) && state.members.length > 0) {
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
  const existing = loadCircle();
  const keepMembers =
    existing?.circleCode === score.circle_code ? existing.members : [];
  const base: LocalCircleState = {
    nickname: score.nickname,
    circleCode: score.circle_code,
    members: keepMembers,
    cloud: true,
  };
  const state = upsertSelfScore(base, { ...seed, nickname: score.nickname });
  saveCircle(state);
  try {
    const refreshed = await refreshLeaderboards(state);
    notifyCircleChanged();
    return refreshed.state;
  } catch {
    notifyCircleChanged();
    return state;
  }
}

export async function pushScore(state: LocalCircleState, seed: Omit<CircleMemberScore, 'nickname' | 'updatedAt'>): Promise<LocalCircleState> {
  let result = state;
  await enqueueScorePush(async () => {
    const epoch = getSyncEpoch();
    let vault = seed.vault;
    if (state.cloud && isSupabaseConfigured()) {
      vault = await pullIncomingVault(seed.vault, seed.balance);
    }
    if (epoch !== getSyncEpoch()) {
      result = state;
      return;
    }
    const mergedSeed = { ...seed, vault };
    if (state.cloud && isSupabaseConfigured()) {
      try {
        if (epoch !== getSyncEpoch()) {
          result = state;
          return;
        }
        const synced = await syncScoreCloud({
          balance: mergedSeed.balance,
          peakBalance: mergedSeed.peakBalance,
          handsPlayed: mergedSeed.handsPlayed,
          blackjacks: mergedSeed.blackjacks,
          bestStreak: mergedSeed.bestStreak,
          highestTable: mergedSeed.highestTable,
          gamesBeforePeak: mergedSeed.gamesBeforePeak,
          gamesPlayed: mergedSeed.gamesPlayed,
          vault: mergedSeed.vault,
        });
        if (epoch !== getSyncEpoch()) {
          result = state;
          return;
        }
        let reconciledSeed = mergedSeed;
        if (
          typeof synced.balance === 'number' &&
          typeof synced.vault === 'number' &&
          (synced.balance !== mergedSeed.balance || synced.vault !== mergedSeed.vault)
        ) {
          const decision = shouldApplyCloudWallet({
            localBalance: mergedSeed.balance,
            localVault: mergedSeed.vault,
            cloudBalance: synced.balance,
            cloudVault: synced.vault,
          });
          // Jamais écraser un patrimoine local plus riche (sync qui refuse un gain).
          if (decision === 'apply') {
            useGame.getState().applyVaultServerState(
              {
                balance: synced.balance,
                vault: synced.vault,
                peakBalance:
                  typeof synced.peak_balance === 'number'
                    ? synced.peak_balance
                    : mergedSeed.peakBalance,
              },
              Math.abs(
                wealthCents(synced.balance, synced.vault) -
                  wealthCents(mergedSeed.balance, mergedSeed.vault),
              ) <= 1
                ? 'Coffre aligné avec le cloud.'
                : 'Coffre mis à jour depuis le cloud.',
              { dirty: false },
            );
            reconciledSeed = {
              ...mergedSeed,
              balance: synced.balance,
              vault: synced.vault,
              peakBalance:
                typeof synced.peak_balance === 'number'
                  ? synced.peak_balance
                  : mergedSeed.peakBalance,
            };
          }
        }
        const boards = await fetchLeaderboards();
        const localAfter = upsertSelfScore(state, {
          ...reconciledSeed,
          nickname: state.nickname,
        });
        const next = {
          ...localAfter,
          members: mergeBoardMembers(boards, state.nickname, localAfter.members),
          cloud: true,
        };
        saveCircle(next);
        result = next;
        return;
      } catch {
        const local = upsertSelfScore(state, { ...mergedSeed, nickname: state.nickname });
        saveCircle(local);
        result = local;
        return;
      }
    }
    const local = upsertSelfScore(state, { ...mergedSeed, nickname: state.nickname });
    saveCircle(local);
    result = local;
  });
  return result;
}

/** Expose le coffre fusionné après pull (cadeaux reçus). */
export async function peekIncomingVault(
  localVault: number,
  localBalance: number,
): Promise<number> {
  if (!isSupabaseConfigured()) return localVault;
  return pullIncomingVault(localVault, localBalance);
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

export { mergeBoardMembers };

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
  const selfPeak = peakWealthCents(self.peakBalance, self.balance, self.vault);
  const patchLive = (rows: LeaderboardRow[]): LeaderboardRow[] => {
    let seen = false;
    const next = rows.map((r) => {
      if (r.nickname !== me) return r;
      seen = true;
      return {
        ...r,
        balance: self.balance,
        peak_balance: Math.max(r.peak_balance, selfPeak),
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
        peak_balance: selfPeak,
        vault: self.vault,
        games_before_peak: self.gamesBeforePeak,
        updated_at: new Date().toISOString(),
        is_me: true,
      });
    }
    return next
      .sort(
        (a, b) =>
          wealthCents(b.balance, b.vault ?? 0) - wealthCents(a.balance, a.vault ?? 0) ||
          a.nickname.localeCompare(b.nickname),
      )
      .map((r, i) => ({ ...r, rank: i + 1 }));
  };

  const patchPeak = (rows: LeaderboardRow[]): LeaderboardRow[] => {
    let seen = false;
    const next = rows.map((r) => {
      if (r.nickname !== me) return r;
      seen = true;
      const peak = Math.max(r.peak_balance, selfPeak);
      const gamesBefore =
        selfPeak >= r.peak_balance
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
        peak_balance: selfPeak,
        vault: self.vault,
        games_before_peak: self.gamesBeforePeak,
        updated_at: new Date().toISOString(),
        is_me: true,
      });
    }
    return next
      .sort(
        (a, b) =>
          peakWealthCents(b.peak_balance, b.balance, b.vault ?? 0) -
            peakWealthCents(a.peak_balance, a.balance, a.vault ?? 0) ||
          a.nickname.localeCompare(b.nickname),
      )
      .map((r, i) => ({ ...r, rank: i + 1 }));
  };

  return {
    live: patchLive(boards.live),
    peak: patchPeak(boards.peak),
  };
}

export type { LeaderboardRow, Leaderboards };
export { isSupabaseConfigured };
