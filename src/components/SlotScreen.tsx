import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sounds } from '../audio/sounds';
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
  claimJackpot,
  contributeJackpot,
  readJackpotView,
  refreshJackpotView,
  type JackpotView,
} from '../slots/jackpotService';
import { jackpotLabel, type JackpotTier } from '../slots/jackpot';
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
import { SymbolTile } from '../slots/glyphs';
import { useGame } from '../store/gameStore';
import { GameShell } from './GameShell';
import { RulesGuide } from './RulesGuide';

const BET_PRESETS = [1_00, 5_00, 25_00, 100_00, 500_00] as const;
/** Compteurs auto-spin (0 = ∞). */
const AUTO_PRESETS = [10, 25, 50, 100, 0] as const;
const MIN_BET = 1_00;

/** Premier rouleau immobilisé, puis un toutes les STOP_STAGGER_MS. */
const FIRST_STOP_MS = 620;
const STOP_STAGGER_MS = 230;
/** Suspense : deux médailles déjà tombées → les rouleaux suivants traînent. */
const ANTICIPATION_MS = 520;
/** Temps d’affichage du résultat avant le tour suivant. */
const SETTLE_HOLD_MS = 900;
/** Pause plus longue pendant l’écran gros gain. */
const BIG_WIN_HOLD_MS = 2_800;
/** Pause à l’entrée en tours gratuits. */
const FS_TRIGGER_HOLD_MS = 2_000;
/** Pause jackpot progressif. */
const JACKPOT_HOLD_MS = 3_400;
/** Respiration entre deux tours gratuits enchaînés. */
const FREE_SPIN_GAP_MS = 520;
/** Nombre de têtes affichées dans la jauge troupeau. */
const HERD_METER_MAX = 15;
/** Seuil « gros gain » : overlay + pulse + notif défi. */
const BIG_WIN_MULT = 10;

type BigWinCelebrate =
  | { kind: 'win'; amount: number; mult: number }
  | { kind: 'freespins'; amount: number; mult: number; spins: number }
  | { kind: 'jackpot'; amount: number; tier: JackpotTier };

const NO_WINS: readonly WayWin[] = [];

const BLUR_POOL: readonly SlotSymbol[] = [
  'J', 'Q', 'K', 'A', 'elk', 'wolf', 'cougar', 'eagle', 'bison', 'wild',
  'J', 'Q', 'K', 'A', 'elk', 'wolf', 'scatter', 'star',
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

/** 2+ médailles déjà arrêtées → les rouleaux encore en jeu tremblent. */
function isAnticipating(
  grid: readonly (readonly SlotSymbol[])[],
  stoppedReels: number,
  spinning: boolean,
): boolean {
  if (!spinning || stoppedReels < 2) return false;
  let scatters = 0;
  for (let r = 0; r < stoppedReels && r < SLOT_REELS; r++) {
    scatters += (grid[r] ?? []).filter((s) => s === 'scatter').length;
  }
  return scatters >= 2;
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

function starCells(grid: readonly (readonly SlotSymbol[])[]): Set<string> {
  const out = new Set<string>();
  grid.forEach((col, r) =>
    col.forEach((s, row) => {
      if (s === 'star') out.add(`${r}:${row}`);
    }),
  );
  return out;
}

function ReelColumn({
  reel,
  cells,
  spinning,
  anticipating,
  winCells,
  dim,
  stripKey,
}: {
  reel: number;
  cells: readonly SlotSymbol[];
  spinning: boolean;
  anticipating: boolean;
  winCells: ReadonlySet<string>;
  dim: boolean;
  stripKey: string;
}) {
  const cls = [
    'slots-reel',
    spinning ? 'is-spinning' : 'is-stopped',
    spinning && anticipating ? 'is-anticipating' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls}>
      <div
        className="slots-reel-strip"
        key={stripKey}
        style={
          spinning
            ? {
                animationDuration: anticipating
                  ? `${0.22 + reel * 0.02}s`
                  : `${0.34 + reel * 0.025}s`,
              }
            : undefined
        }
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

function CountUpCredits({ to, durationMs = 1_600 }: { to: number; durationMs?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const target = Math.max(0, Math.floor(to));
    if (target <= 0) {
      setN(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - p) ** 3;
      setN(Math.floor(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setN(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, durationMs]);
  return <>{fmt(n)}</>;
}

function BigWinOverlay({
  celebrate,
  onDismiss,
}: {
  celebrate: BigWinCelebrate;
  onDismiss: () => void;
}) {
  const isFs = celebrate.kind === 'freespins';
  const isJp = celebrate.kind === 'jackpot';
  return (
    <motion.button
      type="button"
      className={`slots-bigwin${isFs ? ' is-fs' : ''}${isJp ? ' is-jackpot' : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      onClick={onDismiss}
      aria-label={isJp ? 'Jackpot' : isFs ? 'Tours gratuits' : 'Gros gain'}
    >
      <motion.div
        className="slots-bigwin-card"
        initial={{ scale: 0.72, y: 28 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
      >
        <span className="slots-bigwin-kicker">
          {isJp
            ? `Jackpot ${jackpotLabel(celebrate.tier)}`
            : isFs
              ? 'Ruée dorée'
              : 'Grosse prise'}
        </span>
        <strong className="slots-bigwin-amount">
          {celebrate.amount > 0 ? (
            <CountUpCredits to={celebrate.amount} />
          ) : isFs ? (
            `${celebrate.spins} tours`
          ) : (
            fmt(0)
          )}
        </strong>
        <span className="slots-bigwin-meta">
          {isJp
            ? 'Pot progressif · crédit partagé'
            : isFs
              ? `${celebrate.spins} tours gratuits${celebrate.amount > 0 ? ` · ${fmtMult(celebrate.mult)}` : ''}`
              : fmtMult(celebrate.mult)}
        </span>
        <span className="slots-bigwin-hint">Toucher pour continuer</span>
      </motion.div>
    </motion.button>
  );
}

function JackpotBanner({ pots }: { pots: JackpotView }) {
  return (
    <div className="slots-jp-banner" role="status" aria-label="Jackpots Stampede">
      {(
        [
          ['mini', pots.miniCents],
          ['major', pots.majorCents],
          ['grand', pots.grandCents],
        ] as const
      ).map(([tier, cents]) => (
        <div key={tier} className={`slots-jp-pot is-${tier}`}>
          <span className="slots-jp-tier">{jackpotLabel(tier)}</span>
          <strong className="slots-jp-amt">{fmt(cents)}</strong>
        </div>
      ))}
    </div>
  );
}

function HerdMeter({ heads }: { heads: number }) {
  const mult = herdWinMultiplier(heads);
  const next = HERD_MULT_THRESHOLDS.find((t) => heads < t.at);
  const reached = HERD_MULT_THRESHOLDS.filter((t) => heads >= t.at);
  return (
    <div className="slots-herd" aria-label={`Troupeau ${heads} têtes · ${fmtMult(mult)}`}>
      <div className="slots-herd-head">
        <span className="slots-herd-label">Troupeau</span>
        <strong className="slots-herd-mult">{fmtMult(mult)}</strong>
      </div>
      <div className="slots-herd-track" aria-hidden>
        <div className="slots-herd-pips">
          {Array.from({ length: HERD_METER_MAX }, (_, i) => {
            const on = i < Math.min(heads, HERD_METER_MAX);
            const step = HERD_MULT_THRESHOLDS.some((t) => t.at === i + 1);
            const nextStep = next?.at === i + 1;
            return (
              <span
                key={i}
                className={`slots-pip${on ? ' on' : ''}${step ? ' step' : ''}${nextStep ? ' next' : ''}`}
              />
            );
          })}
        </div>
        <div className="slots-herd-marks">
          {HERD_MULT_THRESHOLDS.map((t) => {
            const done = heads >= t.at;
            const isNext = next?.at === t.at;
            return (
              <span
                key={t.at}
                className={`slots-herd-mark${done ? ' done' : ''}${isNext ? ' next' : ''}`}
                style={{ left: `${((t.at - 0.5) / HERD_METER_MAX) * 100}%` }}
              >
                {fmtMult(t.mult)}
              </span>
            );
          })}
        </div>
      </div>
      <p className="slots-herd-hint">
        <strong>
          {heads}/{HERD_METER_MAX}
        </strong>{' '}
        tête{heads > 1 ? 's' : ''}
        {reached.length > 0 ? ` · palier ${fmtMult(reached[reached.length - 1]!.mult)}` : ''}
        {next ? ` · encore ${next.at - heads} pour ${fmtMult(next.mult)}` : ' · harde complète'}
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
  /** Dernier tour réglé — reste affiché jusqu’au lancement suivant. */
  const [shown, setShown] = useState<SlotsRound | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [stoppedReels, setStoppedReels] = useState<number>(SLOT_REELS);
  const [blur, setBlur] = useState<SlotSymbol[][]>(() => blurGrid());
  const [spinId, setSpinId] = useState(0);
  const [bonus, setBonus] = useState<{ total: number; spins: number; granted: number } | null>(null);
  const [bonusSummary, setBonusSummary] = useState<{ total: number; spins: number } | null>(null);
  const [bigWin, setBigWin] = useState<BigWinCelebrate | null>(null);
  /** Verrouille les contrôles pendant la pause post-spin (même si l’overlay est fermé). */
  const [settleLocked, setSettleLocked] = useState(false);
  /** Spins auto restants ; −1 = ∞ ; 0 = inactif. */
  const [autoLeft, setAutoLeft] = useState(0);
  const [stopOnFeature, setStopOnFeature] = useState(true);
  const [stopOnBigWin, setStopOnBigWin] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [jackpots, setJackpots] = useState<JackpotView>(() => readJackpotView());

  const roundRef = useRef(round);
  const bonusRef = useRef(bonus);
  const spinningRef = useRef(false);
  const bigWinRef = useRef<BigWinCelebrate | null>(null);
  const autoLeftRef = useRef(0);
  const stopOnFeatureRef = useRef(true);
  const stopOnBigWinRef = useRef(false);
  const pendingAutoStopRef = useRef(false);
  const timers = useRef<number[]>([]);
  const creditRef = useRef(slotsCredit);
  creditRef.current = slotsCredit;
  bigWinRef.current = bigWin;
  autoLeftRef.current = autoLeft;
  stopOnFeatureRef.current = stopOnFeature;
  stopOnBigWinRef.current = stopOnBigWin;

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
    let alive = true;
    void refreshJackpotView().then((v) => {
      if (alive) setJackpots(v);
    });
    return () => {
      alive = false;
    };
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
  const celebrating = bigWin != null;
  const autoActive = autoLeft !== 0;
  const busy = spinning || inBonus || celebrating || settleLocked;
  const controlsLocked = busy || autoActive;
  const setGameSessionActive = useGame((s) => s.setGameSessionActive);

  useEffect(() => {
    setGameSessionActive(busy);
    return () => setGameSessionActive(false);
  }, [busy, setGameSessionActive]);

  const stopAuto = useCallback(() => {
    autoLeftRef.current = 0;
    setAutoLeft(0);
    pendingAutoStopRef.current = false;
  }, []);

  const spinRef = useRef<() => void>(() => undefined);

  const anticipating = useMemo(
    () => isAnticipating(round.grid, stoppedReels, spinning),
    [round.grid, stoppedReels, spinning],
  );

  const dismissBigWin = useCallback(() => {
    if (!bigWinRef.current) return;
    setBigWin(null);
  }, []);

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
    setShown(null);
    setBigWin(null);
    setSettleLocked(false);
    setStoppedReels(0);
    setBlur(blurGrid());
    setSpinId((n) => n + 1);
    setRoundBoth(next);
    sounds.play('click');

    const stops = reelStopTimes(next.grid);
    stops.forEach((t, i) =>
      later(t, () => {
        setStoppedReels(i + 1);
        sounds.play('chip');
      }),
    );

    later((stops[SLOT_REELS - 1] ?? FIRST_STOP_MS) + 160, () => {
      void (async () => {
        const settled = settleSpin(roundRef.current);
        setRoundBoth(settled);
        setShown(settled);
        spinningRef.current = false;
        setSpinning(false);

        const isFree = settled.mode === 'free';
        if (isFree) {
          if (settled.payout > 0) creditRef.current(settled.payout, false);
        } else {
          // Compte la partie même à 0 : un spin payé = une manche.
          creditRef.current(settled.payout);
        }

        let jpAmount = 0;
        let jpTier: JackpotTier | null = null;
        if (!isFree) {
          jpTier = settled.jackpotTier;
          if (jpTier) {
            try {
              const hit = await claimJackpot(jpTier, settled.bet);
              jpAmount = hit.amountCents;
              setJackpots((prev) => ({
                ...prev,
                ...hit.pots,
              }));
              void refreshJackpotView().then(setJackpots);
            } catch {
              /* claim déjà fallback local dans le service */
            }
          } else {
            void contributeJackpot(settled.bet).then((v) => {
              setJackpots((prev) => ({ ...prev, ...v, hits: prev.hits }));
            });
          }
        }

        const mult = settled.eval?.totalMult ?? 0;
        const isBig = settled.payout > 0 && mult >= BIG_WIN_MULT;
        const fsGrant = !isFree ? settled.freeSpinsGranted : 0;
        let hold = SETTLE_HOLD_MS;

        if (jpAmount > 0 && jpTier) {
          sounds.play('bigwin');
          setBigWin({ kind: 'jackpot', amount: jpAmount, tier: jpTier });
          hold = JACKPOT_HOLD_MS;
          if (autoLeftRef.current !== 0) pendingAutoStopRef.current = true;
        } else if (settled.payout > 0 && settled.eval) {
          notifyDefi({ type: 'slots_win', mult });
          if (isBig) sounds.play('bigwin');
          else sounds.play('win');
        } else if (fsGrant > 0) {
          sounds.play('blackjack');
        }

        if (!(jpAmount > 0 && jpTier)) {
          if (isBig && fsGrant > 0) {
            setBigWin({ kind: 'freespins', amount: settled.payout, mult, spins: fsGrant });
            hold = BIG_WIN_HOLD_MS;
          } else if (isBig) {
            setBigWin({ kind: 'win', amount: settled.payout, mult });
            hold = BIG_WIN_HOLD_MS;
          } else if (fsGrant > 0) {
            setBigWin({
              kind: 'freespins',
              amount: settled.payout,
              mult,
              spins: fsGrant,
            });
            hold = FS_TRIGGER_HOLD_MS;
          }
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

        // Conditions d’arrêt auto (évaluées sur un spin de base uniquement).
        if (!isFree && autoLeftRef.current !== 0) {
          if (fsGrant > 0 && stopOnFeatureRef.current) pendingAutoStopRef.current = true;
          if (isBig && stopOnBigWinRef.current) pendingAutoStopRef.current = true;
        }

        setSettleLocked(true);
        later(hold, () => {
          setBigWin(null);
          setSettleLocked(false);
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

          // Chaîne auto-spin (hors free spins).
          if (pendingAutoStopRef.current) {
            pendingAutoStopRef.current = false;
            autoLeftRef.current = 0;
            setAutoLeft(0);
            return;
          }
          let left = autoLeftRef.current;
          if (left === 0) return;
          if (left > 0) {
            left -= 1;
            autoLeftRef.current = left;
            setAutoLeft(left);
          }
          if (left === 0) return;
          if (useGame.getState().balance < MIN_BET) {
            autoLeftRef.current = 0;
            setAutoLeft(0);
            return;
          }
          later(FREE_SPIN_GAP_MS, () => spin());
        });
      })();
    });
  }, [bet, clearTimers, later, setBonusBoth, setRoundBoth, slotsDebit]);

  spinRef.current = spin;

  const startAuto = useCallback((count: number) => {
    if (spinningRef.current || autoLeftRef.current !== 0) return;
    if (roundRef.current.freeSpinsLeft > 0) return;
    const n = count <= 0 ? -1 : Math.floor(count);
    autoLeftRef.current = n;
    setAutoLeft(n);
    pendingAutoStopRef.current = false;
    spinRef.current();
  }, []);

  const settledEval = shown?.eval ?? null;
  const wins = shown?.wayWins ?? NO_WINS;
  const highlight = useMemo(() => {
    if (!shown) return new Set<string>();
    const cells = winningCells(shown.grid, wins, shown.herdHeads, shown.mode === 'free');
    if ((shown.eval?.scatterCount ?? 0) >= 3) {
      for (const c of scatterCells(shown.grid)) cells.add(c);
    }
    if (shown.jackpotTier) {
      for (const c of starCells(shown.grid)) cells.add(c);
    }
    return cells;
  }, [shown, wins]);

  const topWins = useMemo(
    () => [...wins].sort((a, b) => b.multiplier - a.multiplier).slice(0, 4),
    [wins],
  );

  const totalMult = settledEval?.totalMult ?? 0;
  const shownPayout = shown?.payout ?? 0;
  const shownBet = shown?.bet ?? round.bet;
  const isBigWinStrip = shownPayout > 0 && totalMult >= BIG_WIN_MULT;
  const stakeReady = Math.min(bet, balance);
  const canSpin = !busy && !autoActive && stakeReady >= MIN_BET;
  const lockReason = spinning
    ? 'Rouleaux en rotation'
    : celebrating
      ? 'Célébration en cours'
      : inBonus
        ? 'Tours gratuits en cours'
        : autoActive
          ? 'Auto-spin en cours'
          : undefined;

  const autoLabel = autoLeft < 0 ? '∞' : String(autoLeft);
  const spinLabel = autoActive
    ? `Stop · ${autoLabel}`
    : inBonus
      ? `Tours gratuits · ${freeLeft}`
      : spinning
        ? 'Ruée…'
        : `Lancer · ${fmt(stakeReady)}`;

  const onCta = () => {
    if (autoActive) {
      stopAuto();
      return;
    }
    spin();
  };

  return (
    <div className="slots-screen grain">
      <GameShell
        accent="slots"
        title="Stampede"
        eyebrow="Salon des jeux"
        onBack={() => {
          if (!busy && !autoActive) leaveSlots();
        }}
        backDisabled={busy || autoActive}
        backTitle={lockReason ?? 'Retour Lobby'}
        navLocked={busy || autoActive}
        navLockedReason={lockReason}
        refillLocked={busy || autoActive}
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

      <JackpotBanner pots={jackpots} />

      <div className="slots-layout">
        <main className="slots-stage">
          <div className={`slots-machine${inBonus ? ' is-bonus' : ''}`}>
            <div className="slots-marquee" aria-hidden>
              <span>Ruée dorée</span>
              <em>1024 ways · 5 × 4</em>
            </div>

            <div
              className={`slots-reels${anticipating ? ' is-anticipating' : ''}`}
              role="grid"
              aria-label="Rouleaux Stampede"
            >
              {Array.from({ length: SLOT_REELS }, (_, r) => {
                const isSpinning = r >= stoppedReels;
                const stoppedGrid = shown?.grid ?? round.grid;
                const cells = isSpinning ? (blur[r] ?? []) : (stoppedGrid[r] ?? []);
                return (
                  <ReelColumn
                    key={r}
                    reel={r}
                    cells={cells}
                    spinning={isSpinning}
                    anticipating={anticipating}
                    winCells={highlight}
                    dim={highlight.size > 0}
                    stripKey={isSpinning ? `blur-${spinId}-${r}` : `stop-${spinId}-${r}`}
                  />
                );
              })}
            </div>

            <div className="slots-win-strip">
              <AnimatePresence mode="wait">
                {shown && shownPayout > 0 ? (
                  <motion.div
                    key={`win-${spinId}`}
                    className={`slots-win${isBigWinStrip ? ' is-big' : ''}`}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                  >
                    <strong>{fmt(shownPayout)}</strong>
                    <span>{fmtMult(totalMult)}</span>
                  </motion.div>
                ) : shown ? (
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
                  <span className="slots-ways-pay">{fmt(Math.floor(shownBet * w.multiplier))}</span>
                </li>
              ))}
              {settledEval && settledEval.scatterMult > 0 && (
                <li className="is-scatter">
                  <span className="slots-ways-sym sym-scatter">Médaille</span>
                  <span className="slots-ways-len">×{settledEval.scatterCount}</span>
                  <span className="slots-ways-count">partout</span>
                  <span className="slots-ways-pay">
                    {fmt(Math.floor(shownBet * settledEval.scatterMult))}
                  </span>
                </li>
              )}
            </ul>
          )}

          <div className="slots-dock">
            <button
              type="button"
              className={`btn primary slots-cta${autoActive ? ' is-stop' : ''}`}
              disabled={autoActive ? false : !canSpin}
              onClick={onCta}
            >
              {spinLabel}
            </button>
            <span className="slots-dock-meta">
              {autoActive
                ? `Auto ${autoLabel} · Stop pour interrompre`
                : inBonus
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
                disabled={controlsLocked}
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
                disabled={controlsLocked}
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
                disabled={controlsLocked}
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
                  disabled={controlsLocked || p > balance}
                  onClick={() => commitBet(p)}
                >
                  {fmt(p)}
                </button>
              ))}
              <button
                type="button"
                className="slots-chip"
                disabled={controlsLocked || balance < MIN_BET}
                onClick={() => commitBet(balance)}
              >
                Max
              </button>
            </div>
          </div>

          <div className="slots-panel-block">
            <span className="slots-label">Auto</span>
            <div className="slots-presets">
              {AUTO_PRESETS.map((n) => (
                <button
                  key={n || 'inf'}
                  type="button"
                  className={`slots-chip${autoActive && (n === 0 ? autoLeft < 0 : autoLeft === n) ? ' on' : ''}`}
                  disabled={controlsLocked || stakeReady < MIN_BET}
                  onClick={() => startAuto(n)}
                >
                  {n === 0 ? '∞' : n}
                </button>
              ))}
              {autoActive && (
                <button type="button" className="slots-chip is-stop" onClick={stopAuto}>
                  Stop
                </button>
              )}
            </div>
            <label className="slots-auto-opt">
              <input
                type="checkbox"
                checked={stopOnFeature}
                disabled={autoActive}
                onChange={(e) => setStopOnFeature(e.target.checked)}
              />
              Stop si tours gratuits
            </label>
            <label className="slots-auto-opt">
              <input
                type="checkbox"
                checked={stopOnBigWin}
                disabled={autoActive}
                onChange={(e) => setStopOnBigWin(e.target.checked)}
              />
              Stop si gros gain (≥{BIG_WIN_MULT}×)
            </label>
          </div>

          <div className="slots-stats">
            <div>
              <span className="k">Ways</span>
              <span className="v brass">{SLOT_WAYS}</span>
            </div>
            <div>
              <span className="k">Dernier gain</span>
              <span className={`v ${shownPayout > 0 ? 'win' : ''}`}>
                {shown ? fmt(shownPayout) : '—'}
              </span>
            </div>
            <div>
              <span className="k">Multiplicateur</span>
              <span className="v">{shown ? fmtMult(totalMult) : '—'}</span>
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
            {shown?.jackpotTier && (
              <div>
                <span className="k">Jackpot</span>
                <span className="v win">{jackpotLabel(shown.jackpotTier)}</span>
              </div>
            )}
          </div>

          {jackpots.hits.length > 0 && (
            <div className="slots-jp-hits" aria-label="Derniers jackpots du cercle">
              <span className="slots-label">Jackpots cercle</span>
              <ul>
                {jackpots.hits.slice(0, 4).map((h) => (
                  <li key={h.id}>
                    <span>{jackpotLabel(h.tier)}</span>
                    <span>{h.playerName}</span>
                    <strong>{fmt(h.amountCents)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="slots-actions">
            <button
              type="button"
              className={`btn primary slots-cta${autoActive ? ' is-stop' : ''}`}
              disabled={autoActive ? false : !canSpin}
              onClick={onCta}
            >
              {spinLabel}
            </button>
            <p className="slots-cta-hint">
              {autoActive
                ? 'L’auto enchaîne les spins — Stop à tout moment.'
                : inBonus
                  ? 'Les tours s’enchaînent tout seuls — profitez de la vue.'
                  : '3 médailles ou plus lancent la ruée dorée.'}
            </p>
          </div>

          <p className="slots-footnote">
            5×4 · 1024 ways · jackpots Mini/Major/Grand · RTP ~96–97&nbsp;% · jetons virtuels
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

      <AnimatePresence>
        {bigWin && <BigWinOverlay celebrate={bigWin} onDismiss={dismissBigWin} />}
      </AnimatePresence>

      <RulesGuide game="slots" open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
