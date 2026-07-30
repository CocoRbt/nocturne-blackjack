/**
 * Cercle potes — couche locale + contrat Supabase.
 * Fonctionne offline (localStorage). Sync cloud quand
 * VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY sont définis.
 */

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
  /** Scores du cercle connus localement (soi + amis sync). */
  members: CircleMemberScore[];
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
  return { ...state, nickname, members: [next, ...others].sort((a, b) => b.peakBalance - a.peakBalance) };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

/** Placeholder sync — branché quand le projet Supabase est provisionné. */
export async function syncCircleCloud(_state: LocalCircleState): Promise<LocalCircleState | null> {
  if (!isSupabaseConfigured()) return null;
  // Intentionnellement no-op jusqu'à connexion du projet.
  return null;
}
