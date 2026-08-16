/**
 * Décide si on peut appliquer le portefeuille cloud sur le local
 * sans détruire de richesse (anti-wipe sync).
 */
export function shouldApplyCloudWallet(input: {
  localBalance: number;
  localVault: number;
  cloudBalance: number;
  cloudVault: number;
}): 'apply' | 'keep_local' {
  const localW =
    Math.max(0, Math.floor(input.localBalance)) + Math.max(0, Math.floor(input.localVault));
  const cloudW =
    Math.max(0, Math.floor(input.cloudBalance)) + Math.max(0, Math.floor(input.cloudVault));

  // Cloud plus riche (cadeau) ou même patrimoine (simple redistrib solde/coffre).
  if (cloudW + 1 >= localW) return 'apply';
  return 'keep_local';
}
