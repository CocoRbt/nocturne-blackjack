import { mergeIncomingVault } from '../store/vaultMerge';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';

export interface LeaderboardRow {
  rank: number;
  nickname: string;
  balance: number;
  peak_balance: number;
  /** Crédit mis de côté (coffre). */
  vault?: number;
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
  if (/Pas assez dans le coffre/i.test(raw)) {
    return 'Pas assez dans le coffre.';
  }
  if (/Pote introuvable/i.test(raw)) {
    return 'Pote introuvable dans ton cercle.';
  }
  if (/ne peux pas t/i.test(raw)) {
    return 'Tu ne peux pas t’envoyer des crédits.';
  }
  if (/Montant invalide/i.test(raw)) {
    return 'Montant invalide.';
  }
  if (/Rejoins un cercle/i.test(raw)) {
    return 'Rejoins un cercle d’abord';
  }
  if (/player_scores_profile_id_fkey|is not present in table "profiles"/i.test(raw)) {
    return 'Session hors cercle — reconnexion en cours. Réessaie Coffrer.';
  }
  return raw || 'Impossible de rejoindre le cercle';
}

async function ensureAnonSession() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  const { data: sessionData } = await sb.auth.getSession();
  if (sessionData.session) {
    const exp = sessionData.session.expires_at;
    if (exp && exp * 1000 < Date.now() + 15_000) {
      const refreshed = await sb.auth.refreshSession();
      if (refreshed.data.session) return refreshed.data.session;
    } else {
      return sessionData.session;
    }
  }
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  if (!data.session) throw new Error('Session anonyme impossible');
  return data.session;
}

export type EnsureCircleResult = {
  ok: true;
  profile_id: string;
  nickname: string;
  circle_id: string;
  circle_code: string;
  reclaimed?: boolean;
};

/** Rattache la session au cercle local (idempotent). */
export async function ensureCircleMembershipCloud(
  nickname: string,
  code: string,
): Promise<EnsureCircleResult> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  await ensureAnonSession();
  const { data, error } = await sb.rpc('ensure_circle_membership', {
    p_nickname: nickname.trim(),
    p_code: code.trim().toUpperCase(),
  });
  if (!error) return data as EnsureCircleResult;
  if (/ensure_circle_membership|Could not find the function|schema cache/i.test(error.message)) {
    const joined = await joinCircleCloud(nickname, code);
    return {
      ok: true,
      profile_id: joined.profile_id,
      nickname: joined.nickname,
      circle_id: joined.circle_id,
      circle_code: joined.circle_code,
      reclaimed: false,
    };
  }
  throw new Error(rpcMessage(error));
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
  vault: number;
}): Promise<{ balance: number; peak_balance: number; vault?: number; games_before_peak?: number }> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  await ensureAnonSession();

  const withVault = await sb.rpc('sync_my_score', {
    p_balance: input.balance,
    p_peak_balance: input.peakBalance,
    p_hands_played: input.handsPlayed,
    p_blackjacks: input.blackjacks,
    p_best_streak: input.bestStreak,
    p_highest_table: input.highestTable,
    p_games_before_peak: input.gamesBeforePeak,
    p_games_played: input.gamesPlayed,
    p_vault: input.vault,
  });

  if (!withVault.error) {
    return withVault.data as {
      balance: number;
      peak_balance: number;
      vault?: number;
      games_before_peak?: number;
    };
  }

  // Migration vault pas encore appliquée → signature sans p_vault.
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

  // Ancienne signature (avant games_before_peak).
  const legacy = await sb.rpc('sync_my_score', {
    p_balance: input.balance,
    p_peak_balance: input.peakBalance,
    p_hands_played: input.handsPlayed,
    p_blackjacks: input.blackjacks,
    p_best_streak: input.bestStreak,
    p_highest_table: input.highestTable,
  });
  if (legacy.error) throw new Error(rpcMessage(withVault.error));
  return legacy.data as { balance: number; peak_balance: number; games_before_peak?: number };
}

export async function fetchLeaderboards(): Promise<Leaderboards> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  await ensureAnonSession();
  const { data, error } = await sb.rpc('get_leaderboards');
  if (error) throw new Error(rpcMessage(error));
  return normalizeLeaderboards(data);
}

export function normalizeLeaderboards(data: unknown): Leaderboards {
  const raw = data as { live?: unknown; peak?: unknown } | null;
  return {
    live: asLeaderboardRows(raw?.live),
    peak: asLeaderboardRows(raw?.peak),
  };
}

function asLeaderboardRows(value: unknown): LeaderboardRow[] {
  if (Array.isArray(value)) return value as LeaderboardRow[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as LeaderboardRow[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export type MyScore = {
  found: boolean;
  nickname?: string | null;
  circle_id?: string | null;
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

export type SendVaultResult = {
  ok: true;
  amount: number;
  to_nickname: string;
  vault: number;
  to_vault: number;
};

/** Envoie des crédits coffre → coffre (même cercle). Atomicité serveur. */
export async function sendVaultCloud(
  toNickname: string,
  amountCents: number,
): Promise<SendVaultResult> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  await ensureAnonSession();
  const { data, error } = await sb.rpc('send_circle_vault', {
    p_to_nickname: toNickname.trim(),
    p_amount: Math.floor(amountCents),
  });
  if (error) throw new Error(rpcMessage(error));
  return data as SendVaultResult;
}

export type WithdrawVaultResult = {
  ok: true;
  amount: number;
  balance: number;
  vault: number;
  peak_balance: number;
};

export type DepositVaultResult = {
  ok: true;
  amount: number;
  balance: number;
  vault: number;
  peak_balance: number;
};

/** Dépôt solde → coffre atomique côté serveur. */
export async function depositVaultCloud(amountCents: number): Promise<DepositVaultResult> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  await ensureAnonSession();
  const { data, error } = await sb.rpc('deposit_my_vault', {
    p_amount: Math.floor(amountCents),
  });
  if (error) throw new Error(rpcMessage(error));
  return data as DepositVaultResult;
}

/** Retrait coffre → solde atomique côté serveur. */
export async function withdrawVaultCloud(amountCents: number): Promise<WithdrawVaultResult> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  await ensureAnonSession();
  const { data, error } = await sb.rpc('withdraw_my_vault', {
    p_amount: Math.floor(amountCents),
  });
  if (error) throw new Error(rpcMessage(error));
  return data as WithdrawVaultResult;
}

/**
 * Si le cloud a un coffre plus haut *et* une richesse supérieure (cadeau), on le prend.
 * Sinon on garde le local — évite de re-créditer après un retrait.
 */
export async function pullIncomingVault(
  localVault: number,
  localBalance: number,
): Promise<number> {
  try {
    const mine = await fetchMyScore();
    if (typeof mine.vault !== 'number' || typeof mine.balance !== 'number') {
      return localVault;
    }
    return mergeIncomingVault({
      localBalance,
      localVault,
      cloudBalance: mine.balance,
      cloudVault: mine.vault,
    });
  } catch {
    /* ignore */
  }
  return localVault;
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

export type CircleJackpotsPayload = {
  ok: boolean;
  in_circle?: boolean;
  mini?: number;
  major?: number;
  grand?: number;
  updated_at?: string;
  hits?: Array<{
    tier: 'mini' | 'major' | 'grand';
    amount: number;
    created_at: string;
    nickname: string;
  }>;
};

export async function fetchCircleJackpots(): Promise<CircleJackpotsPayload> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  await ensureAnonSession();
  const { data, error } = await sb.rpc('get_circle_jackpots');
  if (error) throw new Error(rpcMessage(error));
  return data as CircleJackpotsPayload;
}

export type ContributeJackpotResult = {
  ok: true;
  mini: number;
  major: number;
  grand: number;
  added: { mini: number; major: number; grand: number };
};

export async function contributeStampedeJackpot(
  betCents: number,
): Promise<ContributeJackpotResult> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  await ensureAnonSession();
  const { data, error } = await sb.rpc('contribute_stampede_jackpot', {
    p_bet: Math.floor(betCents),
  });
  if (error) throw new Error(rpcMessage(error));
  return data as ContributeJackpotResult;
}

export type ClaimJackpotResult = {
  ok: true;
  tier: 'mini' | 'major' | 'grand';
  amount: number;
  balance: number;
  peak_balance: number;
  mini: number;
  major: number;
  grand: number;
};

export async function claimStampedeJackpot(
  tier: 'mini' | 'major' | 'grand',
  betCents: number,
): Promise<ClaimJackpotResult> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  await ensureAnonSession();
  const { data, error } = await sb.rpc('claim_stampede_jackpot', {
    p_tier: tier,
    p_bet: Math.floor(betCents),
  });
  if (error) throw new Error(rpcMessage(error));
  return data as ClaimJackpotResult;
}

export { isSupabaseConfigured };
