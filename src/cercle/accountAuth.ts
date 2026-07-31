/**
 * Compte email — convertit la session anonyme (même uid = même cercle/scores)
 * ou connecte un compte existant sur un autre appareil.
 */

import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import { fetchMyScore, type MyScore } from './circleApi';

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

export async function getAccountSession(): Promise<{
  email: string | null;
  isAnonymous: boolean;
  userId: string | null;
}> {
  const sb = getSupabase();
  if (!sb) return { email: null, isAnonymous: true, userId: null };
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  if (!user) return { email: null, isAnonymous: true, userId: null };
  const isAnonymous = Boolean(user.is_anonymous);
  return {
    email: user.email ?? savedAccountEmail(),
    isAnonymous,
    userId: user.id,
  };
}

/** Lie email + mot de passe à la session anonyme courante (conserve uid). */
export async function registerAccount(email: string, password: string): Promise<void> {
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

  const { data, error } = await sb.auth.updateUser({ email: e, password });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      throw new Error('Cet email a déjà un compte — utilisez « Se connecter ».');
    }
    throw new Error(error.message || 'Impossible de créer le compte');
  }
  if (data.user?.email) rememberEmail(data.user.email);
  else rememberEmail(e);
}

/** Connexion sur un autre appareil — remplace la session locale. */
export async function loginAccount(email: string, password: string): Promise<MyScore | null> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  const e = email.trim().toLowerCase();
  const { error } = await sb.auth.signInWithPassword({ email: e, password });
  if (error) {
    if (/invalid/i.test(error.message)) throw new Error('Email ou mot de passe incorrect');
    throw new Error(error.message || 'Connexion impossible');
  }
  rememberEmail(e);
  try {
    return await fetchMyScore();
  } catch {
    return null;
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
