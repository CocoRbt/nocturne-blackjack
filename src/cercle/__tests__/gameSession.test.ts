import { describe, expect, it } from 'vitest';
import {
  beginFinancialSession,
  endFinancialSession,
  IDLE_GAME_SESSION,
  isGameSessionActive,
  sessionPatch,
  shouldPushWalletSnapshot,
} from '../gameSession';

describe('gameSession', () => {
  it('est inactive au repos, même sur un écran de jeu', () => {
    expect(isGameSessionActive(IDLE_GAME_SESSION)).toBe(false);
    expect(shouldPushWalletSnapshot(IDLE_GAME_SESSION)).toBe(true);
  });

  it('bloque le push dès qu’une mise est ouverte (depth)', () => {
    const open = sessionPatch(IDLE_GAME_SESSION, {
      financialSessionDepth: beginFinancialSession(0),
    });
    expect(open.gameSessionActive).toBe(true);
    expect(shouldPushWalletSnapshot(open)).toBe(false);
  });

  it('reste ouverte tant qu’il reste des mises (plinko multi-balles)', () => {
    let depth = 0;
    depth = beginFinancialSession(depth);
    depth = beginFinancialSession(depth);
    depth = endFinancialSession(depth);
    expect(isGameSessionActive({ ...IDLE_GAME_SESSION, financialSessionDepth: depth })).toBe(true);
    depth = endFinancialSession(depth);
    expect(isGameSessionActive({ ...IDLE_GAME_SESSION, financialSessionDepth: depth })).toBe(false);
  });

  it('honore le hold d’écran (spin / vol / mines)', () => {
    const held = sessionPatch(IDLE_GAME_SESSION, { gameSessionHold: true });
    expect(shouldPushWalletSnapshot(held)).toBe(false);
  });

  it('honore salonStakeOpen (craps)', () => {
    const salon = sessionPatch(IDLE_GAME_SESSION, { salonStakeOpen: true });
    expect(shouldPushWalletSnapshot(salon)).toBe(false);
  });

  it('après settlement, le push reprend', () => {
    const mid = sessionPatch(IDLE_GAME_SESSION, { financialSessionDepth: 1, gameSessionHold: true });
    const done = sessionPatch(mid, { financialSessionDepth: 0, gameSessionHold: false });
    expect(shouldPushWalletSnapshot(done)).toBe(true);
  });
});
