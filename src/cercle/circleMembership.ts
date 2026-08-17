/** Erreurs RPC = session plus rattachée au cercle (cache UI encore plein). */
export function isCircleMembershipError(message: string): boolean {
  return /rejoins un cercle/i.test(message);
}

export function isNicknameTakenError(message: string): boolean {
  return /déjà pris/i.test(message);
}
