import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { notifyDefi } from '../defis/track';
import { fmt, fmtMult } from '../lib/format';
import {
  createIdleRound,
  resetIdle,
  settleDrop,
  startDrop,
  type PlinkoRound,
} from '../plinko/engine';
import {
  PLINKO_ROWS,
  PLINKO_RISKS,
  clampRows,
  paytable,
  riskLabel,
  type PlinkoRisk,
  type PlinkoRows,
} from '../plinko/math';
import { useGame } from '../store/gameStore';
import { GameShell } from './GameShell';
import { RulesGuide } from './RulesGuide';

const BET_PRESETS = [1_00, 5_00, 25_00, 100_00, 500_00] as const;
const HISTORY_MAX = 16;
const MS_PER_ROW = 160;

type Hist = { id: number; mult: number; rows: PlinkoRows; risk: PlinkoRisk };

function PlinkoBoard({
  rows,
  risk,
  round,
  bounceIndex,
}: {
  rows: PlinkoRows;
  risk: PlinkoRisk;
  round: PlinkoRound;
  bounceIndex: number;
}) {
  const table = paytable(rows, risk);
  const slots = table.length;
  const pegRows = rows;
  const width = 320;
  const height = 280;
  const top = 18;
  const bottom = height - 42;
  const left = 24;
  const right = width - 24;
  const usableW = right - left;
  const usableH = bottom - top;

  const pegPositions = useMemo(() => {
    const pegs: { x: number; y: number; r: number; c: number }[] = [];
    for (let r = 0; r < pegRows; r++) {
      const count = r + 2; // 2 pegs on first bounce row visually
      const y = top + ((r + 0.5) / pegRows) * usableH;
      for (let c = 0; c < count; c++) {
        const x = left + ((c + 0.5) / count) * usableW;
        pegs.push({ x, y, r, c });
      }
    }
    return pegs;
  }, [pegRows, top, usableH, left, usableW]);

  /** Position bille : après `bounceIndex` rebonds (0 = départ). */
  const ball = useMemo(() => {
    if (round.phase === 'idle' || round.path.length === 0) {
      return { x: width / 2, y: top - 6, visible: false };
    }
    const steps = Math.min(Math.max(bounceIndex, 0), round.path.length);
    let rights = 0;
    for (let i = 0; i < steps; i++) if (round.path[i]) rights += 1;
    const y =
      steps === 0
        ? top - 4
        : steps >= round.path.length
          ? bottom + 8
          : top + ((steps - 0.15) / pegRows) * usableH;
    // slot progress within current row span
    const slotsAt = steps === 0 ? 1 : Math.min(steps + 1, slots);
    const x =
      steps === 0
        ? width / 2
        : left + ((rights + 0.5) / (steps + 1)) * usableW;
    // final slot snap
    if (steps >= round.path.length) {
      return {
        x: left + ((round.slot + 0.5) / slots) * usableW,
        y: bottom + 10,
        visible: true,
      };
    }
    void slotsAt;
    return { x, y, visible: true };
  }, [bounceIndex, round, pegRows, slots, top, bottom, left, usableW, usableH, width]);

  return (
    <div className="plinko-board-wrap">
      <svg className="plinko-board" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Planche Plinko">
        <defs>
          <linearGradient id="plinko-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(194,161,95,0.08)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.35)" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={width} height={height} rx="16" fill="url(#plinko-bg)" />
        {pegPositions.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={3.2}
            className="plinko-peg"
          />
        ))}
        {ball.visible && (
          <circle cx={ball.x} cy={ball.y} r={7} className="plinko-ball" />
        )}
      </svg>
      <div className="plinko-buckets" data-slots={slots}>
        {table.map((m, i) => {
          const hit = round.phase !== 'idle' && bounceIndex >= round.path.length && round.slot === i;
          const cool = m >= 10 ? 'hot' : m >= 2 ? 'warm' : m < 1 ? 'cold' : '';
          return (
            <div
              key={i}
              className={`plinko-bucket ${cool} ${hit ? 'hit' : ''}`}
              title={`${fmtMult(m)}`}
            >
              {fmtMult(m)}
            </div>
          );
        })}
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
  const [round, setRound] = useState<PlinkoRound>(() => createIdleRound(12, 'medium'));
  const [bounceIndex, setBounceIndex] = useState(0);
  const [history, setHistory] = useState<Hist[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const histId = useRef(0);
  const dropToken = useRef(0);
  const dropLock = useRef(false);
  const credited = useRef(false);
  const roundRef = useRef(round);

  const dropping = round.phase === 'dropping';
  const canConfigure = !dropping;
  const stakeReady = Math.min(bet, balance);

  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  useEffect(() => {
    const el = document.querySelector('.plinko-screen');
    if (el instanceof HTMLElement) el.scrollTop = 0;
  }, []);

  useEffect(() => {
    if (dropping) return;
    if (bet <= balance) return;
    const next = Math.max(1_00, balance);
    setBet(next);
    setBetDraft(String(next / 100));
  }, [balance, bet, dropping]);

  useEffect(() => {
    if (!dropping) return;
    const token = ++dropToken.current;
    credited.current = false;
    setBounceIndex(0);
    let step = 0;
    let settleTimer = 0;
    const pathLen = roundRef.current.path.length;
    const id = window.setInterval(() => {
      if (token !== dropToken.current) return;
      step += 1;
      setBounceIndex(step);
      if (step >= pathLen) {
        window.clearInterval(id);
        settleTimer = window.setTimeout(() => {
          if (token !== dropToken.current || credited.current) return;
          credited.current = true;
          dropLock.current = false;
          const current = roundRef.current;
          const settled = settleDrop(current);
          setRound(settled);
          plinkoCredit(settled.payout);
          notifyDefi({ type: 'plinko_drop', mult: settled.multiplier });
          histId.current += 1;
          setHistory((h) =>
            [
              {
                id: histId.current,
                mult: settled.multiplier,
                rows: settled.rows,
                risk: settled.risk,
              },
              ...h,
            ].slice(0, HISTORY_MAX),
          );
        }, 220);
      }
    }, MS_PER_ROW);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(settleTimer);
    };
  }, [dropping, round.path, plinkoCredit]);

  const commitBet = (cents: number) => {
    const floor = balance < 1_00 ? Math.max(0, balance) : 1_00;
    const clamped = Math.max(floor, Math.min(balance, Math.floor(cents)));
    setBet(clamped || 1_00);
    setBetDraft(String((clamped || 1_00) / 100));
  };

  const onDrop = () => {
    if (dropping || dropLock.current) return;
    const stake = Math.min(bet, balance);
    if (stake < 1_00) return;
    if (!plinkoDebit(stake)) return;
    dropLock.current = true;
    notifyDefi({ type: 'plinko_start' });
    const next = startDrop(stake, rows, risk);
    setRound(next);
  };

  return (
    <div className="plinko-screen grain">
      <GameShell
        accent="plinko"
        title="Plinko"
        eyebrow="Salon des jeux"
        onBack={() => {
          if (!dropping) leavePlinko();
        }}
        backDisabled={dropping}
        backTitle={dropping ? 'Attendez la fin du drop' : 'Retour Lobby'}
        navLocked={dropping}
        navLockedReason="Attendez la fin du drop"
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
              {fmtMult(h.mult)}
            </span>
          ))}
        </div>
      )}

      <div className="plinko-layout">
        <aside className="plinko-panel">
          <div className="plinko-panel-block">
            <label className="plinko-label" htmlFor="plinko-bet">
              Mise
            </label>
            <div className="plinko-bet-row">
              <button
                type="button"
                className="btn ghost"
                disabled={!canConfigure}
                onClick={() => commitBet(bet - 1_00)}
              >
                −
              </button>
              <input
                id="plinko-bet"
                className="plinko-bet-input"
                type="text"
                inputMode="decimal"
                disabled={!canConfigure}
                value={canConfigure ? betDraft : String(round.bet / 100)}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!/^[0-9\s.,]*$/.test(raw)) return;
                  setBetDraft(raw);
                  const n = Number(raw.trim().replace(',', '.'));
                  if (Number.isFinite(n) && n >= 1) commitBet(Math.round(n * 100));
                }}
                onBlur={() => commitBet(bet)}
              />
              <button
                type="button"
                className="btn ghost"
                disabled={!canConfigure}
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
                  disabled={!canConfigure || p > balance}
                  onClick={() => commitBet(p)}
                >
                  {fmt(p)}
                </button>
              ))}
              <button
                type="button"
                className="plinko-chip"
                disabled={!canConfigure || balance < 1_00}
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
                  onClick={() => {
                    setRows(r);
                    if (round.phase !== 'dropping') setRound(createIdleRound(r, risk));
                  }}
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
                  onClick={() => {
                    setRisk(rk);
                    if (round.phase !== 'dropping') setRound(createIdleRound(rows, rk));
                  }}
                >
                  {riskLabel(rk)}
                </button>
              ))}
            </div>
          </div>

          <div className="plinko-stats">
            <div>
              <span className="k">Max</span>
              <span className="v brass">{fmtMult(paytable(rows, risk)[0]!)}</span>
            </div>
            <div>
              <span className="k">Centre</span>
              <span className="v">
                {fmtMult(paytable(rows, risk)[Math.floor(paytable(rows, risk).length / 2)]!)}
              </span>
            </div>
            {round.phase === 'settled' && (
              <div>
                <span className="k">Dernier</span>
                <span className={`v ${round.multiplier >= 1 ? 'win' : 'lose'}`}>
                  {fmtMult(round.multiplier)} · {fmt(round.payout)}
                </span>
              </div>
            )}
          </div>

          <div className="plinko-actions">
            <button
              type="button"
              className="btn primary plinko-cta"
              disabled={dropping || stakeReady < 1_00}
              onClick={onDrop}
            >
              {dropping ? 'En chute…' : `Drop · ${fmt(stakeReady)}`}
            </button>
            {round.phase === 'settled' && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setRound(resetIdle(round));
                  setBounceIndex(0);
                }}
              >
                Nouvelle bille
              </button>
            )}
          </div>
          <p className="plinko-footnote">
            Distribution binomiale · RTP ~99&nbsp;% · jetons virtuels
          </p>
        </aside>

        <main className="plinko-stage">
          <PlinkoBoard
            rows={clampRows(round.phase === 'idle' ? rows : round.rows)}
            risk={round.phase === 'idle' ? risk : round.risk}
            round={round}
            bounceIndex={bounceIndex}
          />
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
