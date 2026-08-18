/**
 * Stratégie wallet cloud — Phase 2c.
 *
 * `hasServerWallet` est la condition centrale pour activer le chemin ledger.
 * Elle NE REQUIERT PAS d'appartenir à un cercle : un joueur avec compte
 * synchronisé (email ou multi-device) peut aussi bénéficier du ledger.
 *
 * Règles :
 *  - Supabase configuré (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
 *  - Session active côté client (anon ou email)
 *  - Profil présent dans `profiles` (circle_id peut être null)
 *
 * `requireCircleUid` reste utilisé côté SQL pour les jeux de cercle
 * (lecture du leaderboard), mais les mutations financières n'en ont
 * PAS besoin : elles opèrent sur `profile_id = auth.uid()`.
 */

import { getSupabase, isSupabaseConfigured } from './supabaseClient';

let _hasServerWalletCache: boolean | null = null;
let _hasServerWalletTs = 0;
const CACHE_MS = 30_000;

/**
 * Vérifie que le joueur courant dispose d'un profil cloud (wallet ledger actif).
 * Résultat mis en cache 30 s pour éviter les appels répétés.
 */
export async function checkHasServerWallet(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const now = Date.now();
  if (_hasServerWalletCache !== null && now - _hasServerWalletTs < CACHE_MS) {
    return _hasServerWalletCache;
  }
  const sb = getSupabase();
  if (!sb) return false;
  const { data: session } = await sb.auth.getSession();
  if (!session?.session?.user?.id) {
    _hasServerWalletCache = false;
    _hasServerWalletTs = now;
    return false;
  }
  const { data, error } = await sb
    .from('profiles')
    .select('id')
    .eq('id', session.session.user.id)
    .maybeSingle();
  const has = !error && data != null;
  _hasServerWalletCache = has;
  _hasServerWalletTs = now;
  return has;
}

/** Invalide le cache (ex. : après connexion / déconnexion). */
export function invalidateServerWalletCache(): void {
  _hasServerWalletCache = null;
}
