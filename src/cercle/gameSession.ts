/**
 * Session financière explicite — Phase 2a.
 * Le heartbeat cercle ne pousse pas le wallet tant qu’une mise est en jeu.
 * Être sur un écran de jeu (screen !== 'lobby') ne suffit pas.
 */

export type GameSessionSlice = {
  financialSessionDepth: number;
  gameSessionHold: boolean;
  salonStakeOpen: boolean;
};

export function isGameSessionActive(s: GameSessionSlice): boolean {
  return s.financialSessionDepth > 0 || s.gameSessionHold || s.salonStakeOpen;
}

export function beginFinancialSession(depth: number): number {
  return Math.max(0, Math.floor(depth)) + 1;
}

export function endFinancialSession(depth: number): number {
  return Math.max(0, Math.floor(depth) - 1);
}

export function sessionPatch(
  current: GameSessionSlice,
  overrides: Partial<GameSessionSlice> = {},
): GameSessionSlice & { gameSessionActive: boolean } {
  const next: GameSessionSlice = {
    financialSessionDepth: overrides.financialSessionDepth ?? current.financialSessionDepth,
    gameSessionHold: overrides.gameSessionHold ?? current.gameSessionHold,
    salonStakeOpen: overrides.salonStakeOpen ?? current.salonStakeOpen,
  };
  return {
    ...next,
    gameSessionActive: isGameSessionActive(next),
  };
}

export const IDLE_GAME_SESSION: GameSessionSlice & { gameSessionActive: boolean } = {
  financialSessionDepth: 0,
  gameSessionHold: false,
  salonStakeOpen: false,
  gameSessionActive: false,
};

/** Heartbeat : pull classement OK, push wallet interdit pendant une session. */
export function shouldPushWalletSnapshot(s: GameSessionSlice): boolean {
  return !isGameSessionActive(s);
}
