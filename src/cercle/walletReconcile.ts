/**
 * Décide si on peut appliquer le portefeuille cloud sur le local
 * sans détruire de richesse (anti-wipe sync).
 *
 * intent 'sync' (défaut) : un coffrage local pas encore accepté par le
 * serveur (même patrimoine, plus de coffre en local) ne doit pas être
 * écrasé à chaque push.
 * intent 'align' : l’utilisateur retire / on force l’alignement cloud
 * (coffre fantôme → solde déjà jouable).
 */
export function shouldApplyCloudWallet(input: {
  localBalance: number;
  localVault: number;
  cloudBalance: number;
  cloudVault: number;
  intent?: 'sync' | 'align';
}): 'apply' | 'keep_local' {
  const localBal = Math.max(0, Math.floor(input.localBalance));
  const localVault = Math.max(0, Math.floor(input.localVault));
  const cloudBal = Math.max(0, Math.floor(input.cloudBalance));
  const cloudVault = Math.max(0, Math.floor(input.cloudVault));
  const localW = localBal + localVault;
  const cloudW = cloudBal + cloudVault;

  if (cloudW + 1 < localW) return 'keep_local';

  // Ne jamais annuler une perte locale en réappliquant un solde cloud plus haut.
  if ((input.intent ?? 'sync') === 'sync' && cloudBal > localBal + 1) {
    return 'keep_local';
  }

  if (
    (input.intent ?? 'sync') !== 'align' &&
    localVault > cloudVault + 1 &&
    Math.abs(cloudW - localW) <= 1
  ) {
    return 'keep_local';
  }

  return 'apply';
}
