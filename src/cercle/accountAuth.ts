/**
 * Compte email — convertit la session anonyme (même uid = même cercle/scores)
 * ou connecte un compte existant sur un autre appareil.
 */

import { fetchMyScore, type MyScore } from './circleApi';
import { bumpSyncEpoch, clearScoreDirty } from './scoreSync';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';

const ACCOUNT_KEY = 'nocturne-account-email';

export function savedAccountEmail(): string | null {
  try {
    return localStorage.getItem(ACCOUNT_KEY);
  } catch {
    return null;
  }
}

function rememberEmail(email: string) {
  try {
    localStorage.setItem(ACCOUNT_KEY, email.trim().toLowerCase());
  } catch {
    /* ignore */
  }
}

export function clearSavedAccountEmail() {
  try {
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    /* ignore */
  }
}

/** URL de retour après confirmation email (jamais localhost en prod). */
export function authEmailRedirectTo(): string {
  const fromEnv = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '');
  if (fromEnv && /^https?:\/\//i.test(fromEnv)) return fromEnv;
  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin;
    // Évite de renvoyer un lien useless si on est encore en file:// 
    if (origin.startsWith('http')) return origin;
  }
  return 'https://nocturne-blackjack.vercel.app';
}

export async function getAccountSession(): Promise<{
  email: string | null;
  isAnonymous: boolean;
  userId: string | null;
  emailPending: boolean;
}> {
  const sb = getSupabase();
  if (!sb) return { email: null, isAnonymous: true, userId: null, emailPending: false };
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  if (!user) return { email: null, isAnonymous: true, userId: null, emailPending: false };
  const isAnonymous = Boolean(user.is_anonymous);
  const pending = Boolean(
    (user as { new_email?: string }).new_email ||
      (!user.email_confirmed_at && user.email && !isAnonymous),
  );
  return {
    email: user.email ?? savedAccountEmail(),
    isAnonymous,
    userId: user.id,
    emailPending: pending,
  };
}

export type RegisterResult = {
  needsEmailConfirmation: boolean;
  redirectTo: string;
};

/** Lie email + mot de passe à la session anonyme courante (conserve uid). */
export async function registerAccount(email: string, password: string): Promise<RegisterResult> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('Email invalide');
  if (password.length < 6) throw new Error('Mot de passe trop court (6 caractères min.)');

  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session) {
    const { error } = await sb.auth.signInAnonymously();
    if (error) throw error;
  }

  const redirectTo = authEmailRedirectTo();
  const { data, error } = await sb.auth.updateUser(
    { email: e, password },
    { emailRedirectTo: redirectTo },
  );
  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      throw new Error('Cet email a déjà un compte — utilisez « Se connecter ».');
    }
    throw new Error(error.message || 'Impossible de créer le compte');
  }
  rememberEmail(e);

  const needsEmailConfirmation = Boolean(
    (data.user as { new_email?: string } | null)?.new_email ||
      (data.user && !data.user.email_confirmed_at),
  );

  return { needsEmailConfirmation, redirectTo };
}

/** Connexion sur un autre appareil — remplace la session locale. */
export async function loginAccount(email: string, password: string): Promise<MyScore> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  const e = email.trim().toLowerCase();
  const { error } = await sb.auth.signInWithPassword({ email: e, password });
  if (error) {
    if (/invalid/i.test(error.message)) throw new Error('Email ou mot de passe incorrect');
    if (/confirm|verified|not confirmed/i.test(error.message)) {
      throw new Error('Confirmez d’abord votre email (lien reçu), puis reconnectez-vous.');
    }
    throw new Error(error.message || 'Connexion impossible');
  }
  rememberEmail(e);
  clearScoreDirty();
  bumpSyncEpoch();
  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session) {
    throw new Error('Session expirée — réessaie dans un instant.');
  }
  try {
    return await fetchMyScore();
  } catch {
    await new Promise((r) => setTimeout(r, 250));
    return await fetchMyScore();
  }
}

export async function logoutAccount(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  clearSavedAccountEmail();
  try {
    await sb.auth.signOut({ scope: 'local' });
  } catch {
    /* ignore */
  }
}

export { isSupabaseConfigured };
