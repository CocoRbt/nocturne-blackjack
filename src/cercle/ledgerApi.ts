import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import { loadCircle } from './circleStore';
import { isGameOnLedger, type LedgerGame } from './ledgerGames';

function rpcMessage(error: { message?: string; details?: string; hint?: string }): string {
  const raw = [error.message, error.details, error.hint].filter(Boolean).join(' — ');
  if (/Solde insuffisant/i.test(raw)) return 'Solde insuffisant.';
  if (/Manche Mines déjà/i.test(raw)) return 'Une manche Mines est déjà en cours.';
  if (/Révéle au moins/i.test(raw)) return 'Révéle au moins un diamant avant d’encaisser.';
  if (/Non authentifié/i.test(raw)) return 'Session expirée — réessaie dans un instant.';
  if (/Rejoins un cercle/i.test(raw)) return 'Rejoins un cercle d’abord.';
  if (/Compte existant/i.test(raw)) return 'Compte existant : migration ledger dédiée requise.';
  return raw || 'Opération serveur impossible';
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(rpcMessage(error));
  return data as T;
}

export function walletFromLedger(res: LedgerWallet): {
  balance: number;
  vault: number;
  peakBalance: number;
  gamesPlayed: number;
  gamesBeforePeak: number;
} {
  return {
    balance: res.balance,
    vault: res.vault,
    peakBalance: res.peak_balance,
    gamesPlayed: res.games_played,
    gamesBeforePeak: res.games_before_peak,
  };
}

export function shouldUseLedger(game: LedgerGame): boolean {
  if (!isGameOnLedger(game)) return false;
  if (!isSupabaseConfigured()) return false;
  return Boolean(loadCircle()?.cloud);
}

export interface LedgerWallet {
  status?: string;
  balance: number;
  vault: number;
  peak_balance: number;
  games_played: number;
  games_before_peak: number;
}

export interface PlinkoRoundDto {
  round_id: string;
  game: 'plinko';
  state: string;
  stake: number;
  payout: number;
  rows: number;
  risk: 'low' | 'medium' | 'high';
  path: boolean[];
  slot: number;
  multiplier: number;
}

export interface MinesRoundDto {
  round_id: string;
  game: 'mines';
  state: string;
  stake: number;
  payout: number;
  mines: number;
  revealed: number[];
  multiplier: number;
  next_multiplier: number;
  mine_set: number[];
  hit_mine: boolean;
}

export type LedgerPlinkoDrop = LedgerWallet & { round: PlinkoRoundDto };
export type LedgerMinesOp = LedgerWallet & { round: MinesRoundDto };

export async function plinkoDrop(input: {
  roundId: string;
  stake: number;
  rows: number;
  risk: string;
}): Promise<LedgerPlinkoDrop> {
  return rpc('plinko_drop', {
    p_round_id: input.roundId,
    p_stake: input.stake,
    p_rows: input.rows,
    p_risk: input.risk,
  });
}

export async function plinkoSettle(roundId: string): Promise<LedgerPlinkoDrop> {
  return rpc('plinko_settle', { p_round_id: roundId });
}

export async function minesStart(input: {
  roundId: string;
  stake: number;
  mines: number;
}): Promise<LedgerMinesOp> {
  return rpc('mines_start', {
    p_round_id: input.roundId,
    p_stake: input.stake,
    p_mines: input.mines,
  });
}

export async function minesReveal(roundId: string, tile: number): Promise<LedgerMinesOp> {
  return rpc('mines_reveal', { p_round_id: roundId, p_tile: tile });
}

export async function minesCashout(roundId: string): Promise<LedgerMinesOp> {
  return rpc('mines_cashout', { p_round_id: roundId });
}

export async function recoverMyRounds(): Promise<
  LedgerWallet & { settled?: number; settled_plinko?: number; open?: unknown[] }
> {
  return rpc('recover_my_rounds', {});
}

export async function getMyOpenRounds(): Promise<{ rounds: Array<PlinkoRoundDto | MinesRoundDto> }> {
  return rpc('get_my_open_rounds', {});
}
