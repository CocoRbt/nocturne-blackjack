/** Erreurs RPC = session plus rattachée au cercle (cache UI encore plein). */
export function isCircleMembershipError(message: string): boolean {
  return /rejoins un cercle/i.test(message);
}

export function isNicknameTakenError(message: string): boolean {
  return /déjà pris/i.test(message);
}

/** Session sans ligne profiles → player_scores refuse l’insert (cas Kikiloki). */
export function isMissingProfileFkError(message: string): boolean {
  return /player_scores_profile_id_fkey|is not present in table "profiles"/i.test(message);
}

export function isVaultNeedsSyncError(message: string): boolean {
  return (
    isCircleMembershipError(message) ||
    isMissingProfileFkError(message) ||
    /score introuvable|hors cercle|reconnexion/i.test(message)
  );
}
