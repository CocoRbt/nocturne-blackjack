import { getSupabase, isSupabaseConfigured } from './supabaseClient';

export interface LeaderboardRow {
  rank: number;
  nickname: string;
  balance: number;
  peak_balance: number;
  /** Parties jouées avant d’atteindre ce record (onglet Record). */
  games_before_peak?: number;
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
  gamesBeforePeak: number;
  gamesPlayed: number;
}): Promise<{ balance: number; peak_balance: number; games_before_peak?: number }> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  await ensureAnonSession();

  const full = await sb.rpc('sync_my_score', {
    p_balance: input.balance,
    p_peak_balance: input.peakBalance,
    p_hands_played: input.handsPlayed,
    p_blackjacks: input.blackjacks,
    p_best_streak: input.bestStreak,
    p_highest_table: input.highestTable,
    p_games_before_peak: input.gamesBeforePeak,
    p_games_played: input.gamesPlayed,
  });

  if (!full.error) {
    return full.data as { balance: number; peak_balance: number; games_before_peak?: number };
  }

  // Migration games_before_peak pas encore appliquée → retombe sur l’ancienne signature.
  const legacy = await sb.rpc('sync_my_score', {
    p_balance: input.balance,
    p_peak_balance: input.peakBalance,
    p_hands_played: input.handsPlayed,
    p_blackjacks: input.blackjacks,
    p_best_streak: input.bestStreak,
    p_highest_table: input.highestTable,
  });
  if (legacy.error) throw new Error(rpcMessage(full.error));
  return legacy.data as { balance: number; peak_balance: number; games_before_peak?: number };
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

export type MyScore = {
  found: boolean;
  nickname?: string | null;
  circle_id?: string | null;
  circle_code?: string | null;
  in_circle?: boolean;
  balance?: number;
  peak_balance?: number;
  hands_played?: number;
  blackjacks?: number;
  best_streak?: number;
  highest_table?: string;
  games_before_peak?: number;
  games_played?: number;
};

export async function fetchMyScore(): Promise<MyScore> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session) throw new Error('Non authentifié');
  const { data, error } = await sb.rpc('get_my_score');
  if (error) throw new Error(rpcMessage(error));
  return data as MyScore;
}

export type CreditSeriesPoint = {
  nickname: string;
  balance: number;
  t: string;
  is_me: boolean;
};

export async function fetchCreditSeries(hours = 48): Promise<CreditSeriesPoint[]> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  await ensureAnonSession();
  const { data, error } = await sb.rpc('get_circle_credit_series', { p_hours: hours });
  if (error) throw new Error(rpcMessage(error));
  return (data as CreditSeriesPoint[]) ?? [];
}

/**
 * Quitte le cercle côté cloud (soft leave).
 * Ne signOut PAS — ça cassait le compte / recréait un anon sans cercle.
 */
export async function leaveCircleCloud(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session?.user?.id) return;

  const { error: rpcErr } = await sb.rpc('leave_circle');
  if (rpcErr) {
    console.warn('[cercle] leave_circle', rpcErr.message);
  }
}

export { isSupabaseConfigured };
