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
  const circle = loadCircle();
  if (circle?.cloud) return true;
  return false;
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

export interface CrashRoundDto {
  round_id: string;
  game: 'crash';
  state: string;
  stake: number;
  payout: number;
  crash_at: number | null;
  cashout_at: number | null;
  auto_cashout: number | null;
}

export interface SlotsRoundDto {
  round_id: string;
  game: 'slots';
  state: string;
  stake: number;
  payout: number;
  stops: number[];
  mode: 'base' | 'free';
  free_spins_left: number;
  herd_heads: number;
  jackpot_tier: 'mini' | 'major' | 'grand' | null;
  free_spins_granted?: number;
}

export interface CrapsRoundDto {
  round_id: string;
  game: 'craps';
  state: string;
  stake: number;
  payout: number;
  phase: string;
  point: number | null;
  point_rolls: number;
  last_roll: { d1: number; d2: number; total: number } | null;
  settlements: Array<{ kind: string; amount_cents: number; net: number }>;
  ended?: boolean;
}

export interface BjCard { rank: string; suit: string; id: string }

export interface BjRoundDto {
  round_id: string;
  game: 'blackjack';
  state: string;
  stake: number;
  payout: number;
  phase: string;
  player_cards: BjCard[];
  dealer_up: BjCard | null;
  dealer_cards: BjCard[] | null;
  player_total: number;
  dealer_total: number | null;
}

export type LedgerCrashOp = LedgerWallet & { round: CrashRoundDto };
export type LedgerSlotsOp = LedgerWallet & { round: SlotsRoundDto; free_spins_granted?: number; jackpot_tier?: string | null };
export type LedgerCrapsOp = LedgerWallet & { round: CrapsRoundDto; ended?: boolean };
export type LedgerBjOp = LedgerWallet & { round: BjRoundDto };

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

export async function getMyOpenRounds(): Promise<{
  rounds: Array<PlinkoRoundDto | MinesRoundDto | CrashRoundDto | SlotsRoundDto | CrapsRoundDto | BjRoundDto>;
}> {
  return rpc('get_my_open_rounds', {});
}

// Crash
export async function crashStart(input: {
  roundId: string; stake: number; autoCashout?: number | null;
}): Promise<LedgerCrashOp> {
  return rpc('crash_start', {
    p_round_id: input.roundId, p_stake: input.stake,
    p_auto_cashout: input.autoCashout ?? null,
  });
}
/** Phase 2d : le serveur détermine le mult par temps serveur — pas de mult client. */
export async function crashCashout(roundId: string): Promise<LedgerCrashOp> {
  return rpc('crash_cashout', { p_round_id: roundId });
}
export async function crashResolveLoss(roundId: string): Promise<LedgerCrashOp> {
  return rpc('crash_resolve_loss', { p_round_id: roundId });
}

// Slots
export async function slotsSpin(input: {
  roundId: string; stake: number;
  freeSpinsLeft?: number; herdHeads?: number; mode?: string;
}): Promise<LedgerSlotsOp> {
  return rpc('slots_spin', {
    p_round_id: input.roundId,
    p_stake: input.stake,
    p_free_spins_left: input.freeSpinsLeft ?? 0,
    p_herd_heads: input.herdHeads ?? 0,
    p_mode: input.mode ?? 'base',
  });
}
/** Phase 2d : le mult est calculé 100% serveur depuis les stops. Pas de param mult. */
export async function slotsSettle(roundId: string): Promise<LedgerSlotsOp> {
  return rpc('slots_settle', { p_round_id: roundId });
}

// Craps
export async function crapsPlaceBet(roundId: string, stake: number): Promise<LedgerCrapsOp> {
  return rpc('craps_place_bet', { p_round_id: roundId, p_stake: stake });
}
export async function crapsTakeBack(roundId: string): Promise<LedgerCrapsOp> {
  return rpc('craps_take_back', { p_round_id: roundId });
}
export async function crapsRoll(roundId: string): Promise<LedgerCrapsOp & { ended?: boolean }> {
  return rpc('craps_roll', { p_round_id: roundId });
}

// Blackjack
export async function bjDeal(roundId: string, stake: number): Promise<LedgerBjOp> {
  return rpc('bj_deal', { p_round_id: roundId, p_stake: stake });
}
export async function bjAction(roundId: string, action: string): Promise<LedgerBjOp> {
  return rpc('bj_action', { p_round_id: roundId, p_action: action });
}
export async function bjSettle(roundId: string): Promise<LedgerBjOp> {
  return rpc('bj_settle', { p_round_id: roundId });
}

// Coffre / transfert ledger
export async function ledgerDepositVault(amount: number, idempotencyKey: string): Promise<LedgerWallet> {
  return rpc('ledger_deposit_vault', { p_amount: amount, p_idempotency_key: idempotencyKey });
}
export async function ledgerWithdrawVault(amount: number, idempotencyKey: string): Promise<LedgerWallet> {
  return rpc('ledger_withdraw_vault', { p_amount: amount, p_idempotency_key: idempotencyKey });
}
export async function ledgerSendVault(
  toNickname: string, amount: number, transferId: string,
): Promise<LedgerWallet & { status: string; transfer_id: string }> {
  return rpc('ledger_send_circle_vault', {
    p_to_nickname: toNickname, p_amount: amount, p_transfer_id: transferId,
  });
}
