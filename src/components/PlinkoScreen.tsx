import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { notifyDefi } from '../defis/track';
import { fmt, fmtMult } from '../lib/format';
import { pathToSlot, rollPath } from '../plinko/engine';
import {
  PLINKO_ROWS,
  PLINKO_RISKS,
  multiplierAt,
  paytable,
  payoutCents,
  riskLabel,
  type PlinkoRisk,
  type PlinkoRows,
} from '../plinko/math';
import { useGame } from '../store/gameStore';
import { GameShell } from './GameShell';
import { RulesGuide } from './RulesGuide';

const BET_PRESETS = [1_00, 5_00, 25_00, 100_00, 500_00] as const;
const HISTORY_MAX = 18;
/**
 * Tempo IRL : ~300 ms par rangée de picots.
 * Le dernier segment (picot → case) est plus court — petit saut, pas une chute.
 */
const MS_PER_ROW = 300;
/** Entrée dans le bucket : bref, pour éviter la « ligne droite ». */
const MS_SINK = 140;
/** Temps où la bille reste visible dans le gain. */
const SETTLE_HOLD_MS = 480;
/** Légère accélération gravitationnelle (1 = linéaire). */
const GRAVITY_EASE = 1.18;

type Hist = { id: number; mult: number; rows: PlinkoRows; risk: PlinkoRisk };

type LiveBall = {
  id: number;
  bet: number;
  rows: PlinkoRows;
  risk: PlinkoRisk;
  path: readonly boolean[];
  slot: number;
  multiplier: number;
  payout: number;
  /** Horodatage de lâcher (performance.now). */
  bornAt: number;
  landed: boolean;
  paid: boolean;
};

type BallLayout = {
  cx: number;
  top: number;
  pegBottom: number;
  sinkY: number;
  spacing: number;
  pegRows: number;
  left: number;
};

function fallDurationMs(rows: number): number {
  return rows * MS_PER_ROW + MS_SINK;
}

/**
 * Progression 0 → path.length :
 * 0..rows-1 = picots (espacés), dernier segment = entrée bucket (plus rapide).
 */
function ballProgress(ball: LiveBall, now: number): number {
  if (ball.landed) return ball.path.length;
  const rows = ball.path.length;
  const elapsed = Math.max(0, now - ball.bornAt);
  const pegDur = rows * MS_PER_ROW;
  if (elapsed <= pegDur) {
    const raw = Math.min(1, elapsed / Math.max(1, pegDur));
    return Math.pow(raw, GRAVITY_EASE) * (rows - 1);
  }
  const sinkT = Math.min(1, (elapsed - pegDur) / MS_SINK);
  // Ease-out : arrive vite, se pose dans la case.
  const ease = 1 - (1 - sinkT) * (1 - sinkT);
  return rows - 1 + ease;
}

function isFallComplete(ball: LiveBall, now: number): boolean {
  if (ball.landed) return true;
  const overdue = now - ball.bornAt > fallDurationMs(ball.path.length) + 400;
  return overdue || ballProgress(ball, now) >= ball.path.length - 1e-6;
}

const BUCKET_FILLS: Record<string, [string, string]> = {
  'tone-red': ['#ff6b7a', '#e0344a'],
  'tone-orange': ['#ffb14a', '#e8891a'],
  'tone-yellow': ['#ffe36a', '#e6c020'],
  'tone-lime': ['#c8f06a', '#8fd320'],
  'tone-green': ['#6dffb0', '#22c56b'],
};

/** Label bucket compact façon Stake : `110` / `1.5` / `0.3`. */
function fmtBucket(m: number): string {
  if (m >= 100) return String(Math.round(m));
  if (Number.isInteger(m)) return String(m);
  const t = Math.round(m * 100) / 100;
  if (Number.isInteger(t)) return String(t);
  return t
    .toFixed(2)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
}

function bucketTone(m: number, slots: number, index: number): string {
  const edge = Math.min(index, slots - 1 - index);
  if (m >= 50 || edge === 0) return 'tone-red';
  if (m >= 5 || edge <= 1) return 'tone-orange';
  if (m >= 1.5) return 'tone-yellow';
  if (m >= 1) return 'tone-lime';
  return 'tone-green';
}

function sinkPos(ball: LiveBall, layout: BallLayout): { x: number; y: number } {
  return { x: layout.left + ball.slot * layout.spacing, y: layout.sinkY };
}

/**
 * Position aux nœuds du chemin — alignée sur les rangées de picots.
 * step k (0..rows-1) = rangée de picots k ; step rows = centre de la case.
 */
function posAtStep(ball: LiveBall, step: number, layout: BallLayout): { x: number; y: number } {
  const { cx, top, pegBottom, spacing, pegRows } = layout;
  const s = Math.min(Math.max(step, 0), ball.path.length);
  if (s >= ball.path.length) return sinkPos(ball, layout);

  let rights = 0;
  for (let i = 0; i < s; i++) if (ball.path[i]) rights += 1;
  const x = cx + (2 * rights - s) * (spacing / 2);
  // Dernière rangée = pegBottom (collée aux cases).
  const span = Math.max(pegRows - 1, 1);
  const pegY = top + (s / span) * (pegBottom - top);
  const y = s === 0 ? pegY - 8 : pegY;
  return { x, y };
}

/** Trajectoire picots (rebonds) puis petit saut dans la case. */
function ballXY(ball: LiveBall, layout: BallLayout, now: number): { x: number; y: number } {
  if (ball.landed) return sinkPos(ball, layout);

  const progress = ballProgress(ball, now);
  const pegEnd = ball.path.length;
  if (progress >= pegEnd) return sinkPos(ball, layout);

  const i0 = Math.floor(progress);
  const frac = progress - i0;
  const t = frac * frac * (3 - 2 * frac);
  const a = posAtStep(ball, i0, layout);
  const b = posAtStep(ball, Math.min(i0 + 1, pegEnd), layout);
  // Dernier segment : petit arc (pas une ligne droite verticale).
  const isSink = i0 >= pegEnd - 1;
  const amp = isSink ? 5.5 : 3.4;
  const bounce = Math.sin(frac * Math.PI) * amp;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t - bounce,
  };
}

function PlinkoBoard({
  rows,
  risk,
  balls,
  hitSlots,
  now,
}: {
  rows: PlinkoRows;
  risk: PlinkoRisk;
  balls: LiveBall[];
  hitSlots: ReadonlySet<number>;
  now: number;
}) {
  const table = paytable(rows, risk);
  const slots = table.length;
  const pegRows = rows;

  const width = 360;
  /**
   * Tout dans le même viewBox (picots + cases) pour que le scale
   * mobile n’éloigne plus les buckets — plus de longue ligne droite.
   */
  const padX = 18;
  const bucketH = 30;
  /** Derniers picots juste au-dessus des cases (presque posés sur les séparateurs). */
  const bucketGap = 5;
  const top = 14;
  const pegBottom = 294;
  const bucketTop = pegBottom + bucketGap;
  const sinkY = bucketTop + bucketH * 0.52;
  const height = bucketTop + bucketH + 6;
  const cx = width / 2;
  /** Toujours pleine largeur — 8/12/16 lignes occupent le même cadre (look 16L). */
  const spacing = (width - padX * 2) / Math.max(slots - 1, 1);
  const left = padX;
  const pegR = Math.max(2.8, Math.min(4.5, spacing * 0.145));
  const ballR = Math.max(5.8, Math.min(8.2, spacing * 0.3));
  /** Largeur case ≈ espacement : les picots du bas tombent sur les joints. */
  const bucketW = Math.max(spacing - 1.2, 8);

  const pegPositions = useMemo(() => {
    const pegs: { x: number; y: number }[] = [];
    const span = Math.max(pegRows - 1, 1);
    for (let r = 0; r < pegRows; r++) {
      const y = top + (r / span) * (pegBottom - top);
      const isLast = r === pegRows - 1;
      /**
       * Rangées normales : r+2 picots, bille dans les trous.
       * Dernière rangée : slots+1 picots sur les séparateurs entre cases
       * (la bille tombe dans l’ouverture, pas pile sur un point).
       */
      if (isLast) {
        const count = slots + 1;
        const rowLeft = left - spacing / 2;
        for (let c = 0; c < count; c++) {
          pegs.push({ x: rowLeft + c * spacing, y });
        }
      } else {
        const count = r + 2;
        const rowLeft = cx - ((count - 1) * spacing) / 2;
        for (let c = 0; c < count; c++) {
          pegs.push({ x: rowLeft + c * spacing, y });
        }
      }
    }
    return pegs;
  }, [pegRows, top, pegBottom, cx, spacing, slots, left]);

  const layout: BallLayout = { cx, top, pegBottom, sinkY, spacing, pegRows, left };

  return (
    <div className="plinko-board-wrap">
      <svg
        className="plinko-board"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Planche Plinko"
      >
        <defs>
          <radialGradient id="plinko-stage-glow" cx="50%" cy="18%" r="70%">
            <stop offset="0%" stopColor="rgba(232, 72, 168, 0.14)" />
            <stop offset="50%" stopColor="rgba(20, 24, 36, 0)" />
          </radialGradient>
          {Object.entries(BUCKET_FILLS).map(([tone, [a, b]]) => (
            <linearGradient key={tone} id={`plinko-bucket-${tone}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={a} />
              <stop offset="100%" stopColor={b} />
            </linearGradient>
          ))}
        </defs>
        <rect x="0" y="0" width={width} height={height} rx="18" fill="#0b0f16" />
        <rect x="0" y="0" width={width} height={height} rx="18" fill="url(#plinko-stage-glow)" />
        {pegPositions.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={pegR} className="plinko-peg" />
        ))}
        {/* Cases dans le SVG : toujours collées sous le dernier picot, quel que soit le scale. */}
        {table.map((m, i) => {
          const tone = bucketTone(m, slots, i);
          const x = left + i * spacing - bucketW / 2;
          const hit = hitSlots.has(i);
          return (
            <g
              key={i}
              className={`plinko-bucket-g${hit ? ' is-hit' : ''}`}
              transform={hit ? `translate(0 -2)` : undefined}
            >
              <rect
                x={x}
                y={bucketTop}
                width={bucketW}
                height={bucketH}
                rx="5"
                ry="5"
                fill={`url(#plinko-bucket-${tone})`}
              />
              <text
                x={left + i * spacing}
                y={bucketTop + bucketH * 0.62}
                textAnchor="middle"
                className="plinko-bucket-label"
              >
                {fmtBucket(m)}
              </text>
              <title>{fmtMult(m)}</title>
            </g>
          );
        })}
        {balls.map((b) => {
          if (b.rows !== rows) return null;
          const { x, y } = ballXY(b, layout, now);
          return (
            <circle
              key={b.id}
              cx={x}
              cy={y}
              r={ballR}
              className={`plinko-ball risk-${b.risk}${b.landed ? ' is-landed' : ''}`}
            />
          );
        })}
      </svg>
    </div>
  );
}

export function PlinkoScreen() {
  const balance = useGame((s) => s.balance);
  const leavePlinko = useGame((s) => s.leavePlinko);
  const plinkoDebit = useGame((s) => s.plinkoDebit);
  const plinkoCredit = useGame((s) => s.plinkoCredit);
  const notice = useGame((s) => s.notice);
  const dismissNotice = useGame((s) => s.dismissNotice);

  const [rows, setRows] = useState<PlinkoRows>(12);
  const [risk, setRisk] = useState<PlinkoRisk>('medium');
  const [bet, setBet] = useState(5_00);
  const [betDraft, setBetDraft] = useState('5');
  const [balls, setBalls] = useState<LiveBall[]>([]);
  const [history, setHistory] = useState<Hist[]>([]);
  const [hitSlots, setHitSlots] = useState<Set<number>>(() => new Set());
  const [lastSettle, setLastSettle] = useState<{ mult: number; payout: number } | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  /** Horloge de rendu pour l’interpolation fluide. */
  const [nowMs, setNowMs] = useState(() => performance.now());

  const histId = useRef(0);
  const ballId = useRef(0);
  const ballsRef = useRef(balls);
  const removeTimers = useRef<Map<number, number>>(new Map());
  const paidIds = useRef<Set<number>>(new Set());
  const plinkoCreditRef = useRef(plinkoCredit);
  plinkoCreditRef.current = plinkoCredit;

  const liveCount = balls.filter((b) => !b.landed).length;
  const flying = liveCount > 0;
  const busy = balls.length > 0;
  const canConfigure = !flying;
  const stakeReady = Math.min(bet, balance);
  const canDrop = stakeReady >= 1_00;
  const setGameSessionActive = useGame((s) => s.setGameSessionActive);

  useEffect(() => {
    setGameSessionActive(flying);
    return () => setGameSessionActive(false);
  }, [flying, setGameSessionActive]);

  useEffect(() => {
    ballsRef.current = balls;
  }, [balls]);

  useEffect(() => {
    const el = document.querySelector('.plinko-screen');
    if (el instanceof HTMLElement) el.scrollTop = 0;
  }, []);

  useEffect(() => {
    if (flying) return;
    if (bet <= balance) return;
    const next = Math.max(1_00, balance);
    setBet(next);
    setBetDraft(String(next / 100));
  }, [balance, bet, flying]);

  useEffect(() => {
    return () => {
      for (const t of removeTimers.current.values()) window.clearTimeout(t);
      removeTimers.current.clear();
    };
  }, []);

  const scheduleRemove = (id: number) => {
    if (removeTimers.current.has(id)) return;
    const t = window.setTimeout(() => {
      removeTimers.current.delete(id);
      paidIds.current.delete(id);
      setBalls((prev) => {
        const filtered = prev.filter((b) => b.id !== id);
        ballsRef.current = filtered;
        return filtered;
      });
    }, SETTLE_HOLD_MS);
    removeTimers.current.set(id, t);
  };

  /** Boucle d’anim robuste : redémarre dès qu’il y a des billes en vol. */
  useEffect(() => {
    if (!flying) return;

    let alive = true;
    let raf = 0;

    const loop = (now: number) => {
      if (!alive) return;
      setNowMs(now);

      const list = ballsRef.current;
      const newlyPaid: LiveBall[] = [];
      const hits = new Set<number>();
      let changed = false;
      const next: LiveBall[] = [];

      for (const b of list) {
        if (b.landed) {
          next.push(b);
          continue;
        }
        if (isFallComplete(b, now)) {
          const landed: LiveBall = { ...b, landed: true, paid: true };
          if (!b.paid && !paidIds.current.has(b.id)) newlyPaid.push(landed);
          next.push(landed);
          hits.add(b.slot);
          changed = true;
        } else {
          next.push(b);
        }
      }

      if (changed) {
        ballsRef.current = next;
        setBalls(next);
      }

      if (newlyPaid.length > 0) {
        for (const b of newlyPaid) {
          paidIds.current.add(b.id);
          plinkoCreditRef.current(b.payout);
          notifyDefi({ type: 'plinko_drop', mult: b.multiplier });
          histId.current += 1;
          setHistory((h) =>
            [
              {
                id: histId.current,
                mult: b.multiplier,
                rows: b.rows,
                risk: b.risk,
              },
              ...h,
            ].slice(0, HISTORY_MAX),
          );
          setLastSettle({ mult: b.multiplier, payout: b.payout });
          scheduleRemove(b.id);
        }
        setHitSlots((prev) => {
          const n = new Set(prev);
          for (const slot of hits) n.add(slot);
          return n;
        });
        window.setTimeout(() => {
          setHitSlots((prev) => {
            const n = new Set(prev);
            for (const slot of hits) n.delete(slot);
            return n;
          });
        }, SETTLE_HOLD_MS);
      }

      if (ballsRef.current.some((b) => !b.landed)) {
        raf = requestAnimationFrame(loop);
      }
    };

    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [flying]);

  const commitBet = (cents: number) => {
    const floor = balance < 1_00 ? Math.max(0, balance) : 1_00;
    const clamped = Math.max(floor, Math.min(balance, Math.floor(cents)));
    setBet(clamped || 1_00);
    setBetDraft(String((clamped || 1_00) / 100));
  };

  const onDrop = () => {
    const stake = Math.min(bet, useGame.getState().balance);
    if (stake < 1_00) return;
    if (!plinkoDebit(stake)) return;

    const path = rollPath(rows);
    const slot = pathToSlot(path);
    const multiplier = multiplierAt(rows, risk, slot);
    const payout = payoutCents(stake, multiplier);
    ballId.current += 1;
    const ball: LiveBall = {
      id: ballId.current,
      bet: stake,
      rows,
      risk,
      path,
      slot,
      multiplier,
      payout,
      bornAt: performance.now(),
      landed: false,
      paid: false,
    };
    notifyDefi({ type: 'plinko_start' });
    setBalls((prev) => {
      const next = [...prev, ball];
      ballsRef.current = next;
      return next;
    });
  };

  const table = paytable(rows, risk);

  return (
    <div className="plinko-screen grain">
      <GameShell
        accent="plinko"
        title="Plinko"
        eyebrow="Salon des jeux"
        onBack={() => {
          if (!busy) leavePlinko();
        }}
        backDisabled={busy}
        backTitle={busy ? 'Attendez la fin des billes' : 'Retour Lobby'}
        navLocked={busy}
        navLockedReason="Attendez la fin des billes"
        refillLocked={busy}
        refillLockedReason="Attendez que toutes les billes soient tombées avant de recharger."
        onRules={() => setRulesOpen(true)}
        rulesLabel="Règles Plinko"
      />

      {history.length > 0 && (
        <div className="plinko-history" aria-label="Historique des drops">
          {history.map((h) => (
            <span
              key={h.id}
              className={`plinko-pill ${h.mult < 1 ? 'low' : h.mult < 5 ? 'mid' : 'high'}`}
              title={`${h.rows}L · ${riskLabel(h.risk)}`}
            >
              {fmtBucket(h.mult)}×
            </span>
          ))}
        </div>
      )}

      <div className="plinko-layout">
        {/* Contrôles compacts au-dessus de la planche (visible sans scroll). */}
        <aside className="plinko-panel">
          <div className="plinko-panel-top">
            <div className="plinko-panel-block plinko-bet-block">
              <label className="plinko-label" htmlFor="plinko-bet">
                Mise
              </label>
              <div className="plinko-bet-row">
                <button
                  type="button"
                  className="btn ghost plinko-bet-step"
                  aria-label="Diminuer la mise"
                  onClick={() => commitBet(bet - 1_00)}
                >
                  −
                </button>
                <input
                  id="plinko-bet"
                  className="plinko-bet-input"
                  type="text"
                  inputMode="decimal"
                  enterKeyHint="done"
                  value={betDraft}
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
                  className="btn ghost plinko-bet-step"
                  aria-label="Augmenter la mise"
                  onClick={() => commitBet(bet + 1_00)}
                >
                  +
                </button>
              </div>
              <div className="plinko-presets">
                {BET_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`plinko-chip ${bet === p ? 'on' : ''}`}
                    disabled={p > balance}
                    onClick={() => commitBet(p)}
                  >
                    {fmt(p)}
                  </button>
                ))}
                <button
                  type="button"
                  className="plinko-chip"
                  disabled={balance < 1_00}
                  onClick={() => commitBet(balance)}
                >
                  Max
                </button>
              </div>
            </div>

            <div className="plinko-config-row">
              <div className="plinko-panel-block">
                <span className="plinko-label">Lignes</span>
                <div className="plinko-rows">
                  {PLINKO_ROWS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`plinko-chip ${rows === r ? 'on' : ''}`}
                      disabled={!canConfigure}
                      onClick={() => setRows(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="plinko-panel-block">
                <span className="plinko-label">Risque</span>
                <div className="plinko-risks">
                  {PLINKO_RISKS.map((rk) => (
                    <button
                      key={rk}
                      type="button"
                      className={`plinko-chip risk-${rk} ${risk === rk ? 'on' : ''}`}
                      disabled={!canConfigure}
                      onClick={() => setRisk(rk)}
                    >
                      {riskLabel(rk)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="plinko-stats">
            <div>
              <span className="k">Max</span>
              <span className="v brass">{fmtBucket(table[0]!)}×</span>
            </div>
            <div>
              <span className="k">Centre</span>
              <span className="v">{fmtBucket(table[Math.floor(table.length / 2)]!)}×</span>
            </div>
            {lastSettle && (
              <div>
                <span className="k">Dernier</span>
                <span className={`v ${lastSettle.mult >= 1 ? 'win' : 'lose'}`}>
                  {fmtBucket(lastSettle.mult)}× · {fmt(lastSettle.payout)}
                </span>
              </div>
            )}
            {liveCount > 0 && (
              <div>
                <span className="k">En vol</span>
                <span className="v">{liveCount}</span>
              </div>
            )}
          </div>

          {/* Drop desktop (dans le panneau). Mobile → dock fixe. */}
          <div className="plinko-actions plinko-actions--panel">
            <button
              type="button"
              className="btn primary plinko-cta"
              disabled={!canDrop}
              onClick={onDrop}
            >
              Drop · {fmt(stakeReady)}
            </button>
            <p className="plinko-cta-hint">Spam Drop — autant de billes que vous voulez</p>
          </div>
          <p className="plinko-footnote">
            Distribution binomiale · RTP ~99&nbsp;% · jetons virtuels
          </p>
        </aside>

        <main className="plinko-stage">
          <PlinkoBoard rows={rows} risk={risk} balls={balls} hitSlots={hitSlots} now={nowMs} />
          {liveCount > 1 && (
            <div className="plinko-live-count" aria-live="polite">
              {liveCount} billes
            </div>
          )}
          {/* Sous les buckets : toujours visible, sans recouvrir les mults. */}
          <div className="plinko-drop-dock">
            <button
              type="button"
              className="btn primary plinko-cta"
              disabled={!canDrop}
              onClick={onDrop}
            >
              Drop · {fmt(stakeReady)}
            </button>
            {liveCount > 0 ? (
              <span className="plinko-dock-meta">
                {liveCount} en vol
                {lastSettle ? ` · dernier ${fmtBucket(lastSettle.mult)}×` : ''}
              </span>
            ) : (
              <span className="plinko-dock-meta">Spam pour lancer plusieurs billes</span>
            )}
          </div>
        </main>
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

      <RulesGuide game="plinko" open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
