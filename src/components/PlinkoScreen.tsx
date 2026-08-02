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
const MAX_LIVE_BALLS = 24;
/** Chute rapide pour pouvoir spammer Drop. */
const MS_PER_ROW = 80;
const SETTLE_HOLD_MS = 200;

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
  step: number;
  landed: boolean;
  /** Empêche un double crédit si la boucle re-traite. */
  paid: boolean;
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

function ballXY(
  ball: LiveBall,
  layout: {
    cx: number;
    top: number;
    bottom: number;
    spacing: number;
    pegRows: number;
    left: number;
  },
): { x: number; y: number } {
  const { cx, top, bottom, spacing, pegRows, left } = layout;
  const steps = Math.min(Math.max(ball.step, 0), ball.path.length);
  let rights = 0;
  for (let i = 0; i < steps; i++) if (ball.path[i]) rights += 1;

  if (steps >= ball.path.length || ball.landed) {
    return {
      x: left + ball.slot * spacing,
      y: bottom + 8,
    };
  }

  const x = cx + (2 * rights - steps) * (spacing / 2);
  const y = steps === 0 ? top - 2 : top + ((steps - 0.15) / pegRows) * (bottom - top);
  return { x, y };
}

function PlinkoBoard({
  rows,
  risk,
  balls,
  hitSlots,
}: {
  rows: PlinkoRows;
  risk: PlinkoRisk;
  balls: LiveBall[];
  hitSlots: ReadonlySet<number>;
}) {
  const table = paytable(rows, risk);
  const slots = table.length;
  const pegRows = rows;

  const width = 360;
  const height = 352;
  const top = 24;
  const bottom = height - 22;
  const cx = width / 2;
  const spacing = Math.min(30, (width - 40) / Math.max(slots - 1, 8));
  const left = cx - ((slots - 1) * spacing) / 2;

  const pegPositions = useMemo(() => {
    const pegs: { x: number; y: number }[] = [];
    for (let r = 0; r < pegRows; r++) {
      const count = r + 2;
      const y = top + ((r + 0.42) / pegRows) * (bottom - top);
      const rowLeft = cx - ((count - 1) * spacing) / 2;
      for (let c = 0; c < count; c++) {
        pegs.push({ x: rowLeft + c * spacing, y });
      }
    }
    return pegs;
  }, [pegRows, top, bottom, cx, spacing]);

  const layout = { cx, top, bottom, spacing, pegRows, left };

  return (
    <div className="plinko-board-wrap">
      <svg
        className="plinko-board"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Planche Plinko"
      >
        <defs>
          <radialGradient id="plinko-stage-glow" cx="50%" cy="18%" r="70%">
            <stop offset="0%" stopColor="rgba(232, 72, 168, 0.14)" />
            <stop offset="50%" stopColor="rgba(20, 24, 36, 0)" />
          </radialGradient>
          <filter id="plinko-ball-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="1.8" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect x="0" y="0" width={width} height={height} rx="18" fill="#0b0f16" />
        <rect x="0" y="0" width={width} height={height} rx="18" fill="url(#plinko-stage-glow)" />
        {pegPositions.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3.5} className="plinko-peg" />
        ))}
        {balls.map((b) => {
          if (b.rows !== rows) return null;
          const { x, y } = ballXY(b, layout);
          return (
            <circle
              key={b.id}
              cx={x}
              cy={y}
              r={6.8}
              className={`plinko-ball risk-${b.risk}`}
              filter="url(#plinko-ball-glow)"
            />
          );
        })}
      </svg>
      <div className="plinko-buckets" style={{ ['--slots' as string]: String(slots) }}>
        {table.map((m, i) => (
          <div
            key={i}
            className={`plinko-bucket ${bucketTone(m, slots, i)} ${hitSlots.has(i) ? 'hit' : ''}`}
            title={fmtMult(m)}
          >
            <span>{fmtBucket(m)}</span>
          </div>
        ))}
      </div>
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

  const histId = useRef(0);
  const ballId = useRef(0);
  const ballsRef = useRef(balls);
  const rafRef = useRef(0);
  const lastTs = useRef(0);
  const accMs = useRef(0);
  const removeTimers = useRef<Map<number, number>>(new Map());

  const liveCount = balls.filter((b) => !b.landed).length;
  const busy = balls.length > 0;
  const canConfigure = liveCount === 0;
  const stakeReady = Math.min(bet, balance);
  const canDrop = stakeReady >= 1_00 && liveCount < MAX_LIVE_BALLS;

  useEffect(() => {
    ballsRef.current = balls;
  }, [balls]);

  useEffect(() => {
    const el = document.querySelector('.plinko-screen');
    if (el instanceof HTMLElement) el.scrollTop = 0;
  }, []);

  useEffect(() => {
    if (busy) return;
    if (bet <= balance) return;
    const next = Math.max(1_00, balance);
    setBet(next);
    setBetDraft(String(next / 100));
  }, [balance, bet, busy]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      for (const t of removeTimers.current.values()) window.clearTimeout(t);
      removeTimers.current.clear();
    };
  }, []);

  const scheduleRemove = (id: number) => {
    if (removeTimers.current.has(id)) return;
    const t = window.setTimeout(() => {
      removeTimers.current.delete(id);
      setBalls((prev) => {
        const filtered = prev.filter((b) => b.id !== id);
        ballsRef.current = filtered;
        return filtered;
      });
    }, SETTLE_HOLD_MS);
    removeTimers.current.set(id, t);
  };

  const ensureLoop = () => {
    if (rafRef.current) return;
    lastTs.current = performance.now();
    accMs.current = 0;

    const loop = (now: number) => {
      const dt = Math.min(48, now - lastTs.current);
      lastTs.current = now;
      accMs.current += dt;

      let steps = Math.floor(accMs.current / MS_PER_ROW);
      if (steps > 0) {
        accMs.current -= steps * MS_PER_ROW;
        steps = Math.min(steps, 4);

        let list = ballsRef.current;
        const newlyPaid: LiveBall[] = [];
        const hits = new Set<number>();

        for (let s = 0; s < steps; s++) {
          if (list.length === 0) break;
          const next: LiveBall[] = [];
          for (const b of list) {
            if (b.landed) {
              next.push(b);
              continue;
            }
            const step = b.step + 1;
            if (step >= b.path.length) {
              const landed: LiveBall = {
                ...b,
                step: b.path.length,
                landed: true,
                paid: true,
              };
              if (!b.paid) newlyPaid.push(landed);
              next.push(landed);
              hits.add(b.slot);
            } else {
              next.push({ ...b, step });
            }
          }
          list = next;
        }

        if (list !== ballsRef.current || newlyPaid.length > 0) {
          ballsRef.current = list;
          setBalls(list);
        }

        if (newlyPaid.length > 0) {
          for (const b of newlyPaid) {
            plinkoCredit(b.payout);
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
      }

      if (ballsRef.current.length > 0) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        rafRef.current = 0;
      }
    };

    rafRef.current = requestAnimationFrame(loop);
  };

  const commitBet = (cents: number) => {
    const floor = balance < 1_00 ? Math.max(0, balance) : 1_00;
    const clamped = Math.max(floor, Math.min(balance, Math.floor(cents)));
    setBet(clamped || 1_00);
    setBetDraft(String((clamped || 1_00) / 100));
  };

  const onDrop = () => {
    const stake = Math.min(bet, useGame.getState().balance);
    if (stake < 1_00) return;
    if (ballsRef.current.filter((b) => !b.landed).length >= MAX_LIVE_BALLS) return;
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
      step: 0,
      landed: false,
      paid: false,
    };
    notifyDefi({ type: 'plinko_start' });
    setBalls((prev) => {
      const next = [...prev, ball];
      ballsRef.current = next;
      return next;
    });
    ensureLoop();
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
        <main className="plinko-stage">
          <PlinkoBoard rows={rows} risk={risk} balls={balls} hitSlots={hitSlots} />
          {liveCount > 1 && (
            <div className="plinko-live-count" aria-live="polite">
              {liveCount} billes
            </div>
          )}
        </main>

        <aside className="plinko-panel">
          <div className="plinko-panel-block">
            <label className="plinko-label" htmlFor="plinko-bet">
              Mise
            </label>
            <div className="plinko-bet-row">
              <button type="button" className="btn ghost" onClick={() => commitBet(bet - 1_00)}>
                −
              </button>
              <input
                id="plinko-bet"
                className="plinko-bet-input"
                type="text"
                inputMode="decimal"
                value={betDraft}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!/^[0-9\s.,]*$/.test(raw)) return;
                  setBetDraft(raw);
                  const n = Number(raw.trim().replace(',', '.'));
                  if (Number.isFinite(n) && n >= 1) commitBet(Math.round(n * 100));
                }}
                onBlur={() => commitBet(bet)}
              />
              <button type="button" className="btn ghost" onClick={() => commitBet(bet + 1_00)}>
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
                <span className="v">
                  {liveCount}/{MAX_LIVE_BALLS}
                </span>
              </div>
            )}
          </div>

          <div className="plinko-actions">
            <button
              type="button"
              className="btn primary plinko-cta"
              disabled={!canDrop}
              onClick={onDrop}
            >
              Drop · {fmt(stakeReady)}
            </button>
            <p className="plinko-cta-hint">Spam Drop — jusqu’à {MAX_LIVE_BALLS} billes en vol</p>
          </div>
          <p className="plinko-footnote">
            Distribution binomiale · RTP ~99&nbsp;% · jetons virtuels
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

      <RulesGuide game="plinko" open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
