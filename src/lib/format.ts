/** Formate un montant en centimes : "1 250" ou "12,50". */
export function fmt(cents: number): string {
  const v = cents / 100;
  return v.toLocaleString('fr-FR', {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Formate un net signé : "+150" / "−75". */
export function fmtNet(cents: number): string {
  if (cents === 0) return '±0';
  return (cents > 0 ? '+' : '−') + fmt(Math.abs(cents));
}

export function fmtPays(mult: number): string {
  if (Number.isInteger(mult)) return `${mult}:1`;
  // 2.5 -> 5:2
  return `${mult * 2}:2`;
}
