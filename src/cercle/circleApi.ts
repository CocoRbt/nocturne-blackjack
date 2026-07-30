import { getSupabase, isSupabaseConfigured } from './supabaseClient';

export interface LeaderboardRow {
  rank: number;
  nickname: string;
  balance: number;
  peak_balance: number;
  updated_at: string;
  is_me: boolean;
}

export interface Leaderboards {
  live: LeaderboardRow[];
  peak: LeaderboardRow[];
}

export interface JoinResult {
  profile_id: string;
  nickname: string;
  circle_id: string;
  circle_code: string;
  circle_name: string;
}

function rpcMessage(error: { message?: string; details?: string; hint?: string }): string {
  const raw = [error.message, error.details, error.hint].filter(Boolean).join(' — ');
  if (/introuvable/i.test(raw)) {
    return 'Code cercle introuvable — vérifie bien chaque lettre (EVJ ≠ EJV).';
  }
  if (/déjà pris/i.test(raw)) {
    return 'Pseudo déjà pris dans ce cercle — choisis-en un autre.';
  }
  if (/Pseudo invalide/i.test(raw)) {
    return 'Pseudo invalide (2–16 caractères).';
  }
  if (/Non authentifié/i.test(raw)) {
    return 'Session expirée — réessaie dans un instant.';
  }
  return raw || 'Impossible de rejoindre le cercle';
}

async function ensureAnonSession() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  const { data: sessionData } = await sb.auth.getSession();
  if (sessionData.session) return sessionData.session;
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  if (!data.session) throw new Error('Session anonyme impossible');
  return data.session;
}

export async function joinCircleCloud(nickname: string, code?: string): Promise<JoinResult> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  await ensureAnonSession();
  const { data, error } = await sb.rpc('join_circle', {
    p_nickname: nickname.trim(),
    p_code: code?.trim() ? code.trim().toUpperCase() : null,
  });
  if (error) throw new Error(rpcMessage(error));
  return data as JoinResult;
}

export async function syncScoreCloud(input: {
  balance: number;
  peakBalance: number;
  handsPlayed: number;
  blackjacks: number;
  bestStreak: number;
  highestTable: string;
}): Promise<{ balance: number; peak_balance: number }> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  await ensureAnonSession();
  const { data, error } = await sb.rpc('sync_my_score', {
    p_balance: input.balance,
    p_peak_balance: input.peakBalance,
    p_hands_played: input.handsPlayed,
    p_blackjacks: input.blackjacks,
    p_best_streak: input.bestStreak,
    p_highest_table: input.highestTable,
  });
  if (error) throw new Error(rpcMessage(error));
  return data as { balance: number; peak_balance: number };
}

export async function fetchLeaderboards(): Promise<Leaderboards> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  await ensureAnonSession();
  const { data, error } = await sb.rpc('get_leaderboards');
  if (error) throw new Error(rpcMessage(error));
  const raw = data as { live: LeaderboardRow[]; peak: LeaderboardRow[] };
  return {
    live: raw?.live ?? [],
    peak: raw?.peak ?? [],
  };
}

/** Quitte le cercle côté cloud puis déconnecte la session anonyme locale. */
export async function leaveCircleCloud(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data: sessionData } = await sb.auth.getSession();
  if (sessionData.session) {
    const { error } = await sb.rpc('leave_circle');
    if (error) {
      // même si RPC absente / échoue, on continue le cleanup local
      console.warn('[cercle] leave_circle', error.message);
    }
  }
  await sb.auth.signOut({ scope: 'local' });
}

export { isSupabaseConfigured };
