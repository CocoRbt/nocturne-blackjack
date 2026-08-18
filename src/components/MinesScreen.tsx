import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { fmt, fmtMult, fmtNet } from '../lib/format';
import {
  MINES_GRID,
  MINES_MAX,
  MINES_MIN,
  cashOut,
  createIdleRound,
  revealTile,
  shouldShowGem,
  shouldShowMine,
  startRound,
  type MinesPhase,
  type MinesRound,
} from '../mines/engine';
import {
  getMyOpenRounds,
  minesCashout,
  minesReveal,
  minesStart,
  recoverMyRounds,
  shouldUseLedger,
  walletFromLedger,
  type MinesRoundDto,
} from '../cercle/ledgerApi';
import { notifyDefi } from '../defis/track';
import { minesMultiplier, payoutCents } from '../mines/math';
import { useGame } from '../store/gameStore';
import { GameShell } from './GameShell';
import { RulesGuide } from './RulesGuide';

const BET_PRESETS = [1_00, 5_00, 25_00, 100_00, 500_00] as const;

/** Affiche des centimes en euros pour l’input (virgule FR). */
function centsToInput(cents: number): string {
  const v = cents / 100;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2).replace('.', ',');
}

/** Parse une saisie euros → centimes, ou null si invalide. */
function parseBetInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!cleaned || cleaned === '.' || cleaned === '-') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function GemIcon() {
  const gid = `gem-${useId().replace(/:/g, '')}`;
  return (
    <svg className="mines-icon gem" viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#b8fff0" />
          <stop offset="45%" stopColor="#3ecfad" />
          <stop offset="100%" stopColor="#1a7a68" />
        </linearGradient>
      </defs>
      <path
        d="M16 3 L28 12 L22 28 H10 L4 12 Z"
        fill={`url(#${gid})`}
        stroke="rgba(200,240,230,0.55)"
        strokeWidth="1"
      />
      <path d="M16 3 L20 12 H12 Z" fill="rgba(255,255,255,0.35)" />
    </svg>
  );
}

function MineIcon() {
  return (
    <svg className="mines-icon mine" viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="9" fill="#2a1c1c" stroke="#c46a6a" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="3.2" fill="#e8a0a0" />
      {[0, 45, 90, 135].map((deg) => (
        <rect
          key={deg}
          x="15.2"
          y="3"
          width="1.6"
          height="6"
          rx="0.6"
          fill="#c46a6a"
          transform={`rotate(${deg} 16 16)`}
        />
      ))}
    </svg>
  );
}

function dtoToMinesRound(dto: MinesRoundDto): MinesRound {
  const ended = dto.state === 'resolved' || dto.state === 'settled' || dto.state === 'void';
  const phase: MinesPhase = !ended ? 'playing' : dto.hit_mine ? 'busted' : 'cashed';
  return {
    phase,
    bet: dto.stake,
    mines: dto.mines,
    mineSet: new Set(dto.mine_set ?? []),
    revealed: dto.revealed ?? [],
    multiplier: Number(dto.multiplier) || 1,
    nextMultiplier: Number(dto.next_multiplier) || 0,
  };
}

export function MinesScreen() {
  const balance = useGame((s) => s.balance);
  const leaveMines = useGame((s) => s.leaveMines);
  const minesDebit = useGame((s) => s.minesDebit);
  const minesCredit = useGame((s) => s.minesCredit);
  const applyCanonicalWallet = useGame((s) => s.applyCanonicalWallet);
  const notice = useGame((s) => s.notice);
  const dismissNotice = useGame((s) => s.dismissNotice);

  const [mines, setMines] = useState(3);
  const [bet, setBet] = useState(5_00);
  const [betDraft, setBetDraft] = useState(() => centsToInput(5_00));
  const [betFocused, setBetFocused] = useState(false);
  const [round, setRound] = useState<MinesRound>(() => createIdleRound(3));
  const [ledgerRoundId, setLedgerRoundId] = useState<string | null>(null);
  const [flash, setFlash] = useState<'win' | 'lose' | null>(null);
  const [lastPayout, setLastPayout] = useState(0);
  const [rulesOpen, setRulesOpen] = useState(false);

  const playing = round.phase === 'playing';
  const idle = round.phase === 'idle';
  const finished = round.phase === 'busted' || round.phase === 'cashed';
  /** Entre deux manches : on peut régler mise / mines et relancer d’un clic. */
  const canConfigure = idle || finished;
  const setGameSessionActive = useGame((s) => s.setGameSessionActive);

  useEffect(() => {
    setGameSessionActive(playing);
    return () => setGameSessionActive(false);
  }, [playing, setGameSessionActive]);

  useEffect(() => {
    if (!shouldUseLedger('mines')) return;
    let cancelled = false;
    void (async () => {
      try {
        const recovered = await recoverMyRounds();
        if (cancelled) return;
        applyCanonicalWallet(walletFromLedger(recovered));
        const open = await getMyOpenRounds();
        const mine = open.rounds?.find((r) => r.game === 'mines' && r.state === 'open');
        if (mine && mine.game === 'mines' && !cancelled) {
          setLedgerRoundId(mine.round_id);
          setRound(dtoToMinesRound(mine));
          setMines(mine.mines);
          setBet(mine.stake);
          useGame.getState().applyCanonicalWallet(walletFromLedger(recovered), { beginSession: true });
        }
      } catch {
        /* hors-ligne */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyCanonicalWallet]);

  const commitBet = (nextCents: number) => {
    const clamped = Math.max(1_00, Math.min(balance, Math.floor(nextCents)));
    setBet(clamped);
    setBetDraft(centsToInput(clamped));
  };

  useEffect(() => {
    if (!canConfigure || bet <= balance) return;
    const clamped = Math.max(1_00, balance);
    setBet(clamped);
    if (!betFocused) setBetDraft(centsToInput(clamped));
  }, [canConfigure, balance, bet, betFocused]);

  useEffect(() => {
    const el = document.querySelector('.mines-screen');
    if (el instanceof HTMLElement) el.scrollTop = 0;
  }, []);

  useEffect(() => {
    if (!betFocused && canConfigure) {
      setBetDraft(centsToInput(bet));
    }
  }, [bet, betFocused, canConfigure]);

  const potential = useMemo(
    () =>
      payoutCents(
        playing ? round.bet : bet,
        playing && round.multiplier > 1 ? round.multiplier : minesMultiplier(1, mines),
      ),
    [bet, mines, playing, round.bet, round.multiplier],
  );

  const profitIfCash = playing && round.revealed.length > 0
    ? payoutCents(round.bet, round.multiplier) - round.bet
    : 0;

  const onStart = () => {
    const stake = Math.min(bet, balance);
    if (stake < 1_00) return;
    if (shouldUseLedger('mines')) {
      const roundId = crypto.randomUUID();
      void minesStart({ roundId, stake, mines })
        .then((res) => {
          applyCanonicalWallet(walletFromLedger(res), { beginSession: true });
          setLedgerRoundId(res.round.round_id);
          setFlash(null);
          setLastPayout(0);
          setRound(dtoToMinesRound(res.round));
          notifyDefi({ type: 'mines_start' });
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Mise Mines refusée';
          useGame.setState({ notice: msg });
        });
      return;
    }
    if (!minesDebit(stake)) return;
    setFlash(null);
    setLastPayout(0);
    setRound(startRound(stake, mines));
    notifyDefi({ type: 'mines_start' });
  };

  const onReveal = useCallback(
    (index: number) => {
      if (round.phase !== 'playing') return;
      if (shouldUseLedger('mines') && ledgerRoundId) {
        void minesReveal(ledgerRoundId, index)
          .then((res) => {
            const next = dtoToMinesRound(res.round);
            setRound(next);
            if (res.round.hit_mine || next.phase === 'busted') {
              applyCanonicalWallet(walletFromLedger(res), { endSession: true });
              setFlash('lose');
              setLastPayout(0);
              return;
            }
            if (next.phase === 'cashed' && res.round.payout > 0) {
              applyCanonicalWallet(walletFromLedger(res), { endSession: true });
              setLastPayout(res.round.payout);
              setFlash('win');
              notifyDefi({ type: 'mines_cashout', mult: next.multiplier });
              return;
            }
            applyCanonicalWallet(walletFromLedger(res));
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : 'Révélation refusée';
            useGame.setState({ notice: msg });
          });
        return;
      }
      const result = revealTile(round, index);
      setRound(result.round);
      if (result.hitMine) {
        minesCredit(0);
        setFlash('lose');
        setLastPayout(0);
        return;
      }
      if (result.autoCashed && result.payout > 0) {
        minesCredit(result.payout);
        setLastPayout(result.payout);
        setFlash('win');
        notifyDefi({ type: 'mines_cashout', mult: result.round.multiplier });
      }
    },
    [round, minesCredit, ledgerRoundId, applyCanonicalWallet],
  );

  const onCashOut = () => {
    if (shouldUseLedger('mines') && ledgerRoundId) {
      void minesCashout(ledgerRoundId)
        .then((res) => {
          const next = dtoToMinesRound(res.round);
          setRound(next);
          applyCanonicalWallet(walletFromLedger(res), { endSession: true });
          setLastPayout(res.round.payout);
          setFlash('win');
          notifyDefi({ type: 'mines_cashout', mult: next.multiplier });
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Encaissement refusé';
          useGame.setState({ notice: msg });
        });
      return;
    }
    const { round: next, payout } = cashOut(round);
    if (payout <= 0) return;
    setRound(next);
    minesCredit(payout);
    setLastPayout(payout);
    setFlash('win');
    notifyDefi({ type: 'mines_cashout', mult: next.multiplier });
  };

  const adjustBet = (delta: number) => {
    if (!canConfigure) return;
    commitBet(bet + delta);
  };

  const onBetDraftChange = (raw: string) => {
    if (!/^[0-9\s.,]*$/.test(raw)) return;
    setBetDraft(raw);
    const parsed = parseBetInput(raw);
    if (parsed != null && parsed >= 1_00) {
      setBet(Math.min(balance, parsed));
    }
  };

  const onBetDraftBlur = () => {
    setBetFocused(false);
    const parsed = parseBetInput(betDraft);
    if (parsed == null || parsed < 1_00) {
      commitBet(bet);
      return;
    }
    commitBet(parsed);
  };

  return (
    <div className="mines-screen grain">
      <GameShell
        accent="mines"
        title="Mines"
        eyebrow="Salon des jeux"
        onBack={leaveMines}
        onRules={() => setRulesOpen(true)}
        rulesLabel="Règles Mines"
      />

      <div className="mines-layout">
        <aside className="mines-panel">
          <div className="mines-panel-block">
            <label className="mines-label" htmlFor="mines-bet-input">
              Mise
            </label>
            <div className="mines-bet-row">
              <button type="button" className="btn ghost" disabled={!canConfigure} onClick={() => adjustBet(-1_00)}>
                −
              </button>
              {canConfigure ? (
                <input
                  id="mines-bet-input"
                  className="mines-bet-input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  value={betDraft}
                  disabled={!canConfigure}
                  aria-label="Mise en euros"
                  onFocus={() => setBetFocused(true)}
                  onChange={(e) => onBetDraftChange(e.target.value)}
                  onBlur={onBetDraftBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <strong className="mines-bet-value">{fmt(round.bet)}</strong>
              )}
              <button type="button" className="btn ghost" disabled={!canConfigure} onClick={() => adjustBet(1_00)}>
                +
              </button>
            </div>
            <div className="mines-presets">
              {BET_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`mines-chip ${bet === p ? 'on' : ''}`}
                  disabled={!canConfigure || p > balance}
                  onClick={() => commitBet(p)}
                >
                  {fmt(p)}
                </button>
              ))}
              <button
                type="button"
                className="mines-chip"
                disabled={!canConfigure || balance < 1_00}
                onClick={() => commitBet(balance)}
              >
                Max
              </button>
            </div>
          </div>

          <div className="mines-panel-block">
            <label className="mines-label" htmlFor="mines-count">
              Mines · {mines}
            </label>
            <input
              id="mines-count"
              className="mines-slider"
              type="range"
              min={MINES_MIN}
              max={MINES_MAX}
              value={mines}
              disabled={!canConfigure}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMines(v);
                if (idle) setRound(createIdleRound(v));
              }}
            />
            <div className="mines-slider-ends">
              <span>1 · prudent</span>
              <span>24 · extrême</span>
            </div>
          </div>

          <div className="mines-stats">
            <div>
              <span className="k">Multiplicateur</span>
              <span className="v brass">{fmtMult(playing || finished ? round.multiplier : 1)}</span>
            </div>
            <div>
              <span className="k">Prochain diamant</span>
              <span className="v">
                {fmtMult(
                  playing
                    ? round.nextMultiplier || minesMultiplier(1, mines)
                    : minesMultiplier(1, mines),
                )}
              </span>
            </div>
            <div>
              <span className="k">Gain potentiel</span>
              <span className="v win">
                {playing && round.revealed.length > 0
                  ? fmt(payoutCents(round.bet, round.multiplier))
                  : fmt(potential)}
              </span>
            </div>
            {playing && round.revealed.length > 0 && (
              <div>
                <span className="k">Profit si encaissé</span>
                <span className={`v ${profitIfCash >= 0 ? 'win' : 'lose'}`}>{fmtNet(profitIfCash)}</span>
              </div>
            )}
          </div>

          <div className="mines-actions">
            {canConfigure && (
              <button
                type="button"
                className="btn primary mines-cta"
                disabled={bet < 1_00 || bet > balance}
                onClick={onStart}
              >
                Jouer · {fmt(Math.min(bet, balance))}
              </button>
            )}
            {playing && (
              <button
                type="button"
                className="btn primary mines-cta cashout"
                disabled={round.revealed.length === 0}
                onClick={onCashOut}
              >
                Encaisser · {fmt(payoutCents(round.bet, round.multiplier))}
              </button>
            )}
          </div>

          <p className="mines-footnote">
            Grille 5×5 · RTP 99&nbsp;% · multiplicateurs progressifs · jetons virtuels uniquement
          </p>
        </aside>

        <main className="mines-board-wrap">
          <AnimatePresence mode="wait">
            {flash && (
              <motion.div
                key={flash + lastPayout}
                className={`mines-banner ${flash}`}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {flash === 'win'
                  ? `Encaissé ${fmt(lastPayout)} · ${fmtMult(round.multiplier)}`
                  : 'Mine · mise perdue'}
              </motion.div>
            )}
          </AnimatePresence>

          <div
            className={`mines-grid ${playing ? 'is-playing' : ''} ${round.phase === 'busted' ? 'is-busted' : ''}`}
            style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}
          >
            {Array.from({ length: MINES_GRID }, (_, i) => {
              const gem = shouldShowGem(round, i);
              const mine = shouldShowMine(round, i);
              const open = gem || mine;
              const justHit = mine && round.revealed[round.revealed.length - 1] === i && round.phase === 'busted';
              return (
                <motion.button
                  key={i}
                  type="button"
                  className={`mines-tile ${open ? 'open' : ''} ${gem ? 'gem' : ''} ${mine ? 'mine' : ''} ${justHit ? 'boom' : ''}`}
                  disabled={!playing || open}
                  onClick={() => onReveal(i)}
                  whileTap={playing && !open ? { scale: 0.96 } : undefined}
                >
                  <span className="mines-tile-face">
                    {gem && <GemIcon />}
                    {mine && <MineIcon />}
                    {!open && <span className="mines-tile-glyph">◆</span>}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </main>
      </div>

      <AnimatePresence>
        {notice && (
          <motion.div
            className="notice"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            onClick={dismissNotice}
          >
            {notice}
          </motion.div>
        )}
      </AnimatePresence>

      <RulesGuide game="mines" open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
