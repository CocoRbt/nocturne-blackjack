/**
 * Fusion coffre local ↔ cloud.
 * Ne remonte JAMAIS un coffre cloud plus haut si la richesse totale
 * (solde + coffre) n’a pas augmenté — sinon un retrait local est
 * écrasé par un pull stale et on duplique l’argent.
 */
export function mergeIncomingVault(input: {
  localBalance: number;
  localVault: number;
  cloudBalance: number;
  cloudVault: number;
}): number {
  const localBal = Math.max(0, Math.floor(input.localBalance));
  const localVault = Math.max(0, Math.floor(input.localVault));
  const cloudBal = Math.max(0, Math.floor(input.cloudBalance));
  const cloudVault = Math.max(0, Math.floor(input.cloudVault));

  if (cloudVault <= localVault) return localVault;

  const localWealth = localBal + localVault;
  const cloudWealth = cloudBal + cloudVault;

  // Cadeau / sync serveur : richesse cloud > locale → accepter le coffre cloud.
  if (cloudWealth > localWealth + 1) return cloudVault;

  // Retrait (ou dépôt inverse) en cours : richesse ≈ égale, coffre cloud
  // encore haut → garder le coffre local plus bas.
  return localVault;
}
