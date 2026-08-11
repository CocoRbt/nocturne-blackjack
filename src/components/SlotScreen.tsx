import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notifyDefi } from '../defis/track';
import { fmt, fmtMult } from '../lib/format';
import {
  createIdleRound,
  resetAfterSettle,
  settleSpin,
  startSpin,
  type SlotsRound,
} from '../slots/engine';
import {
  HERD_MULT_THRESHOLDS,
  SLOT_REELS,
  SLOT_ROWS,
  SLOT_WAYS,
  SYMBOL_LABEL,
  herdTransformed,
  herdWinMultiplier,
  type SlotSymbol,
  type WayWin,
} from '../slots/math';
import { useGame } from '../store/gameStore';
import { GameShell } from './GameShell';
import { RulesGuide } from './RulesGuide';

const BET_PRESETS = [1_00, 5_00, 25_00, 100_00, 500_00] as const;
const MIN_BET = 1_00;

/** Premier rouleau immobilisé, puis un toutes les STOP_STAGGER_MS. */
const FIRST_STOP_MS = 620;
const STOP_STAGGER_MS = 230;
/** Suspense : deux médailles déjà tombées → les rouleaux suivants traînent. */
const ANTICIPATION_MS = 520;
/** Temps d’affichage du résultat avant le tour suivant. */
const SETTLE_HOLD_MS = 900;
/** Respiration entre deux tours gratuits enchaînés. */
const FREE_SPIN_GAP_MS = 520;
/** Nombre de têtes affichées dans la jauge troupeau. */
const HERD_METER_MAX = 15;
/** Seuil « gros gain » : pulse renforcé + notif défi. */
const BIG_WIN_MULT = 10;

const NO_WINS: readonly WayWin[] = [];

const BLUR_POOL: readonly SlotSymbol[] = [
  'J', 'Q', 'K', 'A', 'elk', 'wolf', 'cougar', 'eagle', 'bison', 'wild',
  'J', 'Q', 'K', 'A', 'elk', 'wolf', 'scatter',
];

/** Bande floutée d’un rouleau : 8 symboles dupliqués → boucle sans raccord. */
function blurStrip(): SlotSymbol[] {
  const half: SlotSymbol[] = [];
  for (let i = 0; i < 8; i++) {
    half.push(BLUR_POOL[Math.floor(Math.random() * BLUR_POOL.length)]!);
  }
  return [...half, ...half];
}

function blurGrid(): SlotSymbol[][] {
  return Array.from({ length: SLOT_REELS }, () => blurStrip());
}

/**
 * Horodatage d’arrêt de chaque rouleau. L’anticipation ne se déclenche
 * qu’après deux médailles déjà visibles — comme sur une vraie machine.
 */
function reelStopTimes(grid: readonly (readonly SlotSymbol[])[]): number[] {
  const times: number[] = [];
  let t = FIRST_STOP_MS;
  let scatters = 0;
  for (let r = 0; r < SLOT_REELS; r++) {
    if (r >= 2 && scatters >= 2) t += ANTICIPATION_MS;
    times.push(t);
    scatters += (grid[r] ?? []).filter((s) => s === 'scatter').length;
    t += STOP_STAGGER_MS;
  }
  return times;
}

/**
 * Cases participant à un gain — les animaux transformés par le troupeau
 * paient sous leur symbole d’origine, on les rallume quand même.
 */
function winningCells(
  grid: readonly (readonly SlotSymbol[])[],
  wins: readonly WayWin[],
  heads: number,
  freeMode: boolean,
): Set<string> {
  const turns: ReadonlySet<string> = freeMode ? herdTransformed(heads) : new Set<string>();
  const out = new Set<string>();
  for (const w of wins) {
    for (let r = 0; r < w.length; r++) {
      for (let row = 0; row < SLOT_ROWS; row++) {
        const cell = grid[r]?.[row];
        if (!cell) continue;
        if (cell === 'wild' || cell === w.symbol || (cell === 'bison' && turns.has(w.symbol))) {
          out.add(`${r}:${row}`);
        }
      }
    }
  }
  return out;
}

function scatterCells(grid: readonly (readonly SlotSymbol[])[]): Set<string> {
  const out = new Set<string>();
  grid.forEach((col, r) =>
    col.forEach((s, row) => {
      if (s === 'scatter') out.add(`${r}:${row}`);
    }),
  );
  return out;
}

function BisonGlyph() {
  return (
    <svg className="slots-glyph" viewBox="0 0 40 40" aria-hidden>
      <path className="stroke-part" d="M12 16c-4-3-8-2-8 2s3 6 6 6" />
      <path className="stroke-part" d="M28 16c4-3 8-2 8 2s-3 6-6 6" />
      <path
        className="fill-part"
        d="M20 8c5.4 0 9 3.2 9 8 0 3-.8 5.2-1.9 7.3C25 27.8 23 32 20 32s-5-4.2-7.1-8.7C11.8 21.2 11 19 11 16c0-4.8 3.6-8 9-8z"
      />
      <circle className="ink" cx="16.2" cy="18.4" r="1.3" />
      <circle className="ink" cx="23.8" cy="18.4" r="1.3" />
      <path className="ink-stroke" d="M17.4 26.4h5.2" />
    </svg>
  );
}

function EagleGlyph() {
  return (
    <svg className="slots-glyph" viewBox="0 0 40 40" aria-hidden>
      <path
        className="fill-part"
        d="M20 12c1.7 0 3 1.3 3 3v1.6l12-5.2-6.4 8.8 8.4 2.4-9.6 2.4 3 8.4-10.4-6.4L9.6 33l3-8.4L3 22.2l8.4-2.4L5 11l12 5.2V15c0-1.7 1.3-3 3-3z"
      />
      <circle className="ink" cx="20" cy="16.6" r="1.1" />
    </svg>
  );
}

function CougarGlyph() {
  return (
    <svg className="slots-glyph" viewBox="0 0 40 40" aria-hidden>
      <path
        className="fill-part"
        d="M11.4 14.6 12.4 7l5.4 4.2h4.4L27.6 7l1 7.6C30.6 17 32 19.8 32 23c0 6-5.4 10-12 10S8 29 8 23c0-3.2 1.4-6 3.4-8.4z"
      />
      <circle className="ink" cx="16" cy="21" r="1.5" />
      <circle className="ink" cx="24" cy="21" r="1.5" />
      <path className="ink-stroke" d="M17 27c1.8 1.8 4.2 1.8 6 0" />
    </svg>
  );
}

function WolfGlyph() {
  return (
    <svg className="slots-glyph" viewBox="0 0 40 40" aria-hidden>
      <path
        className="fill-part"
        d="M10 13 11 6l5.6 5.4h6.8L29 6l1 7 2.4 7.4L20 34 7.6 20.4z"
      />
      <circle className="ink" cx="15.6" cy="19.4" r="1.4" />
      <circle className="ink" cx="24.4" cy="19.4" r="1.4" />
      <path className="ink-stroke" d="M20 25.4v3" />
    </svg>
  );
}

function ElkGlyph() {
  return (
    <svg className="slots-glyph" viewBox="0 0 40 40" aria-hidden>
      <path className="stroke-part" d="M14 15 8.6 8.4M8.6 8.4 3.6 9.6M8.6 8.4 7.4 3" />
      <path className="stroke-part" d="M26 15l5.4-6.6M31.4 8.4l5 1.2M31.4 8.4 32.6 3" />
      <path
        className="fill-part"
        d="M20 12c4 0 6.4 2.2 6.4 6.2 0 6-2.4 14-6.4 14s-6.4-8-6.4-14c0-4 2.4-6.2 6.4-6.2z"
      />
      <circle className="ink" cx="17.4" cy="19" r="1.2" />
      <circle className="ink" cx="22.6" cy="19" r="1.2" />
    </svg>
  );
}

function WildGlyph() {
  return (
    <svg className="slots-glyph" viewBox="0 0 40 40" aria-hidden>
      <circle className="sun" cx="20" cy="16" r="9" />
      <path className="ridge" d="M2 31l7.6-7.6 5.4 5.4 7-8.6 7 7.6 9 3.2V36H2z" />
      <path className="ink-stroke ray" d="M20 3v3M6.2 16h-3M33.8 16h3M9.6 6.2 7.5 4M30.4 6.2 32.5 4" />
    </svg>
  );
}

function ScatterGlyph() {
  return (
    <svg className="slots-glyph" viewBox="0 0 40 40" aria-hidden>
      <path className="ribbon" d="M13.6 27 11 37l9-4.6 9 4.6-2.6-10" />
      <circle className="disc" cx="20" cy="17" r="11" />
      <circle className="disc-inner" cx="20" cy="17" r="7.6" />
      <path
        className="star"
        d="m20 10 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8z"
      />
    </svg>
  );
}

function SymbolTile({ symbol }: { symbol: SlotSymbol }) {
  if (symbol === 'bison') return <BisonGlyph />;
  if (symbol === 'eagle') return <EagleGlyph />;
  if (symbol === 'cougar') return <CougarGlyph />;
  if (symbol === 'wolf') return <WolfGlyph />;
  if (symbol === 'elk') return <ElkGlyph />;
  if (symbol === 'wild') {
    return (
      <span className="slots-special">
        <WildGlyph />
        <span className="slots-tag">Wild</span>
      </span>
    );
  }
  if (symbol === 'scatter') {
    return (
      <span className="slots-special">
        <ScatterGlyph />
        <span className="slots-tag">Médaille</span>
      </span>
    );
  }
  return <span className="slots-letter">{symbol}</span>;
}

function ReelColumn({
  reel,
  cells,
  spinning,
  winCells,
  dim,
  stripKey,
}: {
  reel: number;
  cells: readonly SlotSymbol[];
  spinning: boolean;
  winCells: ReadonlySet<string>;
  dim: boolean;
  stripKey: string;
}) {
  return (
    <div className={`slots-reel ${spinning ? 'is-spinning' : 'is-stopped'}`}>
      <div
        className="slots-reel-strip"
        key={stripKey}
        style={spinning ? { animationDuration: `${0.34 + reel * 0.025}s` } : undefined}
      >
        {cells.map((s, row) => {
          const win = !spinning && winCells.has(`${reel}:${row}`);
          const dimmed = !spinning && dim && !win;
          return (
            <div
              key={`${row}-${s}`}
              className={`slots-cell sym-${s}${win ? ' is-win' : ''}${dimmed ? ' is-dim' : ''}`}
              title={SYMBOL_LABEL[s]}
            >
              <SymbolTile symbol={s} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HerdMeter({ heads }: { heads: number }) {
  const mult = herdWinMultiplier(heads);
  const next = HERD_MULT_THRESHOLDS.find((t) => heads < t.at);
  return (
    <div className="slots-herd" aria-label={`Troupeau ${heads} têtes`}>
      <div className="slots-herd-head">
        <span className="slots-herd-label">Troupeau</span>
        <strong className="slots-herd-mult">{fmtMult(mult)}</strong>
      </div>
      <div className="slots-herd-pips" aria-hidden>
        {Array.from({ length: HERD_METER_MAX }, (_, i) => {
          const on = i < Math.min(heads, HERD_METER_MAX);
          const step = HERD_MULT_THRESHOLDS.some((t) => t.at === i + 1);
          return <span key={i} className={`slots-pip${on ? ' on' : ''}${step ? ' step' : ''}`} />;
        })}
      </div>
      <p className="slots-herd-hint">
        {heads} tête{heads > 1 ? 's' : ''}
        {next ? ` · ${next.at - heads} avant ${fmtMult(next.mult)}` : ' · harde complète'}
      </p>
    </div>
  );
}

export function SlotScreen() {
  const balance = useGame((s) => s.balance);
  const leaveSlots = useGame((s) => s.leaveSlots);
  const slotsDebit = useGame((s) => s.slotsDebit);
  const slotsCredit = useGame((s) => s.slotsCredit);
  const notice = useGame((s) => s.notice);
  const dismissNotice = useGame((s) => s.dismissNotice);

  const [bet, setBet] = useState(5_00);
  const [betDraft, setBetDraft] = useState('5');
  const [round, setRound] = useState<SlotsRound>(() => createIdleRound());
  const [spinning, setSpinning] = useState(false);
  const [stoppedReels, setStoppedReels] = useState<number>(SLOT_REELS);
  const [blur, setBlur] = useState<SlotSymbol[][]>(() => blurGrid());
  const [spinId, setSpinId] = useState(0);
  const [bonus, setBonus] = useState<{ total: number; spins: number; granted: number } | null>(null);
  const [bonusSummary, setBonusSummary] = useState<{ total: number; spins: number } | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const roundRef = useRef(round);
  const bonusRef = useRef(bonus);
  const spinningRef = useRef(false);
  const timers = useRef<number[]>([]);
  const creditRef = useRef(slotsCredit);
  creditRef.current = slotsCredit;

  const setRoundBoth = useCallback((next: SlotsRound) => {
    roundRef.current = next;
    setRound(next);
  }, []);

  const setBonusBoth = useCallback((next: typeof bonus) => {
    bonusRef.current = next;
    setBonus(next);
  }, []);

  const later = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  }, []);

  /** Un clic pendant l’affichage du résultat annule les minuteries en attente. */
  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current.length = 0;
  }, []);

  useEffect(() => {
    const el = document.querySelector('.slots-screen');
    if (el instanceof HTMLElement) el.scrollTop = 0;
  }, []);

  useEffect(() => {
    const list = timers.current;
    return () => {
      for (const id of list) window.clearTimeout(id);
      list.length = 0;
    };
  }, []);

  const freeLeft = round.freeSpinsLeft;
  const inBonus = freeLeft > 0 || bonus != null;
  const busy = spinning || inBonus;

  useEffect(() => {
    if (busy) return;
    if (bet <= balance) return;
    const next = Math.max(MIN_BET, balance);
    setBet(next);
    setBetDraft(String(next / 100));
  }, [balance, bet, busy]);

  const commitBet = (cents: number) => {
    const floor = balance < MIN_BET ? Math.max(0, balance) : MIN_BET;
    const clamped = Math.max(floor, Math.min(balance, Math.floor(cents)));
    const next = clamped || MIN_BET;
    setBet(next);
    setBetDraft(String(next / 100));
  };

  const spin = useCallback(() => {
    if (spinningRef.current) return;
    const current = roundRef.current;
    const free = current.freeSpinsLeft > 0;
    const stake = free ? current.bet : Math.min(bet, useGame.getState().balance);
    if (stake < MIN_BET) return;
    if (!free && !slotsDebit(stake)) return;
    clearTimers();
    if (!free) {
      notifyDefi({ type: 'slots_spin' });
      setBonusSummary(null);
    }

    const next = startSpin({
      bet: stake,
      freeSpinsLeft: current.freeSpinsLeft,
      herdHeads: current.herdHeads,
    });

    spinningRef.current = true;
    setSpinning(true);
    setStoppedReels(0);
    setBlur(blurGrid());
    setSpinId((n) => n + 1);
    setRoundBoth(next);

    const stops = reelStopTimes(next.grid);
    stops.forEach((t, i) => later(t, () => setStoppedReels(i + 1)));

    later((stops[SLOT_REELS - 1] ?? FIRST_STOP_MS) + 160, () => {
      const settled = settleSpin(roundRef.current);
      setRoundBoth(settled);
      spinningRef.current = false;
      setSpinning(false);

      const isFree = settled.mode === 'free';
      if (isFree) {
        if (settled.payout > 0) creditRef.current(settled.payout, false);
      } else {
        // Compte la partie même à 0 : un spin payé = une manche.
        creditRef.current(settled.payout);
      }
      if (settled.payout > 0 && settled.eval) {
        notifyDefi({ type: 'slots_win', mult: settled.eval.totalMult });
      }

      if (!isFree && settled.freeSpinsGranted > 0) {
        setBonusBoth({ total: 0, spins: 0, granted: settled.freeSpinsGranted });
      } else if (isFree) {
        const prev = bonusRef.current ?? { total: 0, spins: 0, granted: 0 };
        setBonusBoth({
          total: prev.total + settled.payout,
          spins: prev.spins + 1,
          granted: prev.granted + settled.freeSpinsGranted,
        });
      }

      later(SETTLE_HOLD_MS, () => {
        const done = resetAfterSettle(roundRef.current);
        setRoundBoth(done);
        if (done.freeSpinsLeft > 0) {
          later(FREE_SPIN_GAP_MS, () => spin());
          return;
        }
        const finished = bonusRef.current;
        if (finished && finished.spins > 0) {
          setBonusSummary({ total: finished.total, spins: finished.spins });
          later(6_000, () => setBonusSummary(null));
        }
        setBonusBoth(null);
      });
    });
  }, [bet, clearTimers, later, setBonusBoth, setRoundBoth, slotsDebit]);

  const settledEval = round.phase === 'settled' ? round.eval : null;
  const wins = round.phase === 'settled' ? round.wayWins : NO_WINS;
  const highlight = useMemo(() => {
    if (round.phase !== 'settled') return new Set<string>();
    const cells = winningCells(round.grid, wins, round.herdHeads, round.mode === 'free');
    if ((settledEval?.scatterCount ?? 0) >= 3) {
      for (const c of scatterCells(round.grid)) cells.add(c);
    }
    return cells;
  }, [round.phase, round.grid, round.herdHeads, round.mode, wins, settledEval]);

  const topWins = useMemo(
    () => [...wins].sort((a, b) => b.multiplier - a.multiplier).slice(0, 4),
    [wins],
  );

  const totalMult = settledEval?.totalMult ?? 0;
  const bigWin = round.payout > 0 && totalMult >= BIG_WIN_MULT;
  const stakeReady = Math.min(bet, balance);
  const canSpin = !busy && stakeReady >= MIN_BET;
  const lockReason = spinning
    ? 'Rouleaux en rotation'
    : inBonus
      ? 'Tours gratuits en cours'
      : undefined;

  const spinLabel = inBonus
    ? `Tours gratuits · ${freeLeft}`
    : spinning
      ? 'Ruée…'
      : `Lancer · ${fmt(stakeReady)}`;

  return (
    <div className="slots-screen grain">
      <GameShell
        accent="slots"
        title="Stampede"
        eyebrow="Salon des jeux · Ruée dorée"
        onBack={() => {
          if (!busy) leaveSlots();
        }}
        backDisabled={busy}
        backTitle={lockReason ?? 'Retour Lobby'}
        navLocked={busy}
        navLockedReason={lockReason}
        refillLocked={busy}
        refillLockedReason="Attendez la fin de la ruée avant de recharger."
        onRules={() => setRulesOpen(true)}
        rulesLabel="Règles Stampede"
      />

      <AnimatePresence>
        {inBonus && (
          <motion.div
            className="slots-fs-banner"
            initial={{ opacity: 0, y: -14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            role="status"
          >
            <span className="slots-fs-title">Tours gratuits</span>
            <span className="slots-fs-count">{freeLeft} restants</span>
            {bonus && bonus.spins > 0 && (
              <span className="slots-fs-total">Bonus {fmt(bonus.total)}</span>
            )}
          </motion.div>
        )}
        {!inBonus && bonusSummary && (
          <motion.div
            className="slots-fs-banner is-summary"
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            role="status"
          >
            <span className="slots-fs-title">Ruée terminée</span>
            <span className="slots-fs-count">{bonusSummary.spins} tours</span>
            <span className="slots-fs-total">{fmt(bonusSummary.total)}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="slots-layout">
        <main className="slots-stage">
          <div className={`slots-machine${inBonus ? ' is-bonus' : ''}`}>
            <div className="slots-marquee" aria-hidden>
              <span>Stampede</span>
              <em>1024 ways · 5 × 4</em>
            </div>

            <div className="slots-reels" role="grid" aria-label="Rouleaux Stampede">
              {Array.from({ length: SLOT_REELS }, (_, r) => {
                const isSpinning = r >= stoppedReels;
                const cells = isSpinning ? (blur[r] ?? []) : (round.grid[r] ?? []);
                return (
                  <ReelColumn
                    key={r}
                    reel={r}
                    cells={cells}
                    spinning={isSpinning}
                    winCells={highlight}
                    dim={highlight.size > 0}
                    stripKey={isSpinning ? `blur-${spinId}-${r}` : `stop-${spinId}-${r}`}
                  />
                );
              })}
            </div>

            <div className="slots-win-strip">
              <AnimatePresence mode="wait">
                {round.phase === 'settled' && round.payout > 0 ? (
                  <motion.div
                    key={`win-${spinId}`}
                    className={`slots-win${bigWin ? ' is-big' : ''}`}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                  >
                    <strong>{fmt(round.payout)}</strong>
                    <span>{fmtMult(totalMult)}</span>
                  </motion.div>
                ) : round.phase === 'settled' ? (
                  <motion.div
                    key={`nowin-${spinId}`}
                    className="slots-win is-empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <span>La harde passe son chemin</span>
                  </motion.div>
                ) : (
                  <motion.div
                    key={`idle-${spinId}`}
                    className="slots-win is-idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <span>{spinning ? 'La poussière se lève…' : 'Poussière de prairie'}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {inBonus && <HerdMeter heads={round.herdHeads} />}

          {topWins.length > 0 && (
            <ul className="slots-ways" aria-label="Détail des gains">
              {topWins.map((w) => (
                <li key={`${w.symbol}-${w.length}`}>
                  <span className={`slots-ways-sym sym-${w.symbol}`}>{SYMBOL_LABEL[w.symbol]}</span>
                  <span className="slots-ways-len">×{w.length}</span>
                  <span className="slots-ways-count">
                    {w.ways} way{w.ways > 1 ? 's' : ''}
                  </span>
                  <span className="slots-ways-pay">{fmt(Math.floor(round.bet * w.multiplier))}</span>
                </li>
              ))}
              {settledEval && settledEval.scatterMult > 0 && (
                <li className="is-scatter">
                  <span className="slots-ways-sym sym-scatter">Médaille</span>
                  <span className="slots-ways-len">×{settledEval.scatterCount}</span>
                  <span className="slots-ways-count">partout</span>
                  <span className="slots-ways-pay">
                    {fmt(Math.floor(round.bet * settledEval.scatterMult))}
                  </span>
                </li>
              )}
            </ul>
          )}

          <div className="slots-dock">
            <button type="button" className="btn primary slots-cta" disabled={!canSpin} onClick={spin}>
              {spinLabel}
            </button>
            <span className="slots-dock-meta">
              {inBonus
                ? 'Aucune mise prélevée pendant le bonus'
                : `Mise ${fmt(stakeReady)} · 1024 ways`}
            </span>
          </div>
        </main>

        <aside className="slots-panel">
          <div className="slots-panel-block">
            <label className="slots-label" htmlFor="slots-bet">
              Mise
            </label>
            <div className="slots-bet-row">
              <button
                type="button"
                className="btn ghost slots-bet-step"
                aria-label="Diminuer la mise"
                disabled={busy}
                onClick={() => commitBet(bet - 1_00)}
              >
                −
              </button>
              <input
                id="slots-bet"
                className="slots-bet-input"
                type="text"
                inputMode="decimal"
                enterKeyHint="done"
                value={betDraft}
                disabled={busy}
                aria-label="Mise personnalisée"
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!/^[0-9\s.,]*$/.test(raw)) return;
                  setBetDraft(raw);
                }}
                onBlur={() => {
                  const n = Number(betDraft.trim().replace(/\s/g, '').replace(',', '.'));
                  if (Number.isFinite(n) && n > 0) commitBet(Math.round(n * 100));
                  else commitBet(bet);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
              <button
                type="button"
                className="btn ghost slots-bet-step"
                aria-label="Augmenter la mise"
                disabled={busy}
                onClick={() => commitBet(bet + 1_00)}
              >
                +
              </button>
            </div>
            <div className="slots-presets">
              {BET_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`slots-chip${bet === p ? ' on' : ''}`}
                  disabled={busy || p > balance}
                  onClick={() => commitBet(p)}
                >
                  {fmt(p)}
                </button>
              ))}
              <button
                type="button"
                className="slots-chip"
                disabled={busy || balance < MIN_BET}
                onClick={() => commitBet(balance)}
              >
                Max
              </button>
            </div>
          </div>

          <div className="slots-stats">
            <div>
              <span className="k">Ways</span>
              <span className="v brass">{SLOT_WAYS}</span>
            </div>
            <div>
              <span className="k">Dernier gain</span>
              <span className={`v ${round.payout > 0 ? 'win' : ''}`}>
                {round.phase === 'settled' ? fmt(round.payout) : '—'}
              </span>
            </div>
            <div>
              <span className="k">Multiplicateur</span>
              <span className="v">{round.phase === 'settled' ? fmtMult(totalMult) : '—'}</span>
            </div>
            {inBonus && (
              <div>
                <span className="k">Tours restants</span>
                <span className="v brass">{freeLeft}</span>
              </div>
            )}
            {settledEval && settledEval.wildMults.length > 0 && (
              <div>
                <span className="k">Wilds bonus</span>
                <span className="v brass">
                  {settledEval.wildMults.map((m) => `${m}×`).join(' · ')}
                </span>
              </div>
            )}
          </div>

          <div className="slots-actions">
            <button type="button" className="btn primary slots-cta" disabled={!canSpin} onClick={spin}>
              {spinLabel}
            </button>
            <p className="slots-cta-hint">
              {inBonus
                ? 'Les tours s’enchaînent tout seuls — profitez de la vue.'
                : '3 médailles ou plus lancent la ruée dorée.'}
            </p>
          </div>

          <p className="slots-footnote">
            5 rouleaux · 4 rangs · 1024 ways · RTP ~96–97&nbsp;% · jetons virtuels uniquement
          </p>
        </aside>
      </div>

      <AnimatePresence>
        {notice && (
          <motion.div
            className="notice"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            onClick={dismissNotice}
          >
            {notice}
          </motion.div>
        )}
      </AnimatePresence>

      <RulesGuide game="slots" open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
