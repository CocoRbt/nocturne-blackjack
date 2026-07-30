import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cashOut,
  createIdleRound,
  startRound,
  tickRound,
  type CrashRound,
} from '../crash/engine';
import { CRASH_RTP, payoutCents, reachChance } from '../crash/math';
import { fmt, fmtMult } from '../lib/format';
import { useGame } from '../store/gameStore';
import { RulesGuide } from './RulesGuide';

const BET_PRESETS = [1_00, 5_00, 25_00, 100_00, 500_00] as const;
const HISTORY_MAX = 18;
const GRAPH_W = 640;
const GRAPH_H = 360;

type HistoryEntry = { id: number; crashAt: number; cashed?: number };

function PlaneIcon({ crashed }: { crashed?: boolean }) {
  return (
    <svg className={`crash-plane-svg ${crashed ? 'crashed' : ''}`} viewBox="0 0 64 32" aria-hidden>
      <defs>
        <linearGradient id="crash-plane-g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f4efe3" />
          <stop offset="100%" stopColor="#c2a15f" />
        </linearGradient>
      </defs>
      <path
        d="M2 18 L38 14 L58 8 L62 12 L44 18 L62 22 L58 24 L38 20 L18 28 L14 24 L28 18 Z"
        fill="url(#crash-plane-g)"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="0.8"
      />
      <circle cx="46" cy="15" r="1.6" fill="#1a1208" />
    </svg>
  );
}

function multToPoint(mult: number, tNorm: number, maxMult: number): { x: number; y: number } {
  const padL = 28;
  const padR = 48;
  const padT = 28;
  const padB = 36;
  const w = GRAPH_W - padL - padR;
  const h = GRAPH_H - padT - padB;
  const yMax = Math.max(2, maxMult * 1.08);
  const x = padL + tNorm * w;
  const y = padT + h - ((Math.min(mult, yMax) - 1) / (yMax - 1)) * h;
  return { x, y };
}

function buildPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  }
  return d;
}

export function CrashScreen() {
  const balance = useGame((s) => s.balance);
  const peakBalance = useGame((s) => s.peakBalance);
  const leaveCrash = useGame((s) => s.leaveCrash);
  const crashDebit = useGame((s) => s.crashDebit);
  const crashCredit = useGame((s) => s.crashCredit);
  const notice = useGame((s) => s.notice);
  const dismissNotice = useGame((s) => s.dismissNotice);

  const [bet, setBet] = useState(5_00);
  const [betDraft, setBetDraft] = useState('5');
  const [autoOn, setAutoOn] = useState(false);
  const [autoAt, setAutoAt] = useState(2);
  const [round, setRound] = useState<CrashRound>(() => createIdleRound());
  const [displayMult, setDisplayMult] = useState(1);
  const [points, setPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [flash, setFlash] = useState<'win' | 'lose' | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const startTs = useRef(0);
  const raf = useRef(0);
  const roundRef = useRef(round);
  const credited = useRef(false);
  const histIdRef = useRef(0);

  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  useEffect(() => {
    if (round.phase === 'idle' || round.phase === 'cashed' || round.phase === 'crashed') {
      if (bet > balance) {
        const c = Math.max(1_00, balance);
        setBet(c);
        setBetDraft(String(c / 100));
      }
    }
  }, [balance, bet, round.phase]);

  const stopLoop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  useEffect(() => () => stopLoop(), [stopLoop]);

  const pushHistory = useCallback((crashAt: number, cashed?: number) => {
    histIdRef.current += 1;
    setHistory((h) =>
      [{ id: histIdRef.current, crashAt, cashed }, ...h].slice(0, HISTORY_MAX),
    );
  }, []);

  const runLoop = useCallback(() => {
    const step = (now: number) => {
      const elapsed = now - startTs.current;
      const current = roundRef.current;
      const result = tickRound(current, elapsed);
      const crashDur = Math.max(16, current.crashDurationMs);
      const tNorm = Math.min(1, elapsed / crashDur);
      // Échelle Y = point de crash (connu au décollage) → l’avion monte vraiment.
      const maxMult = Math.max(current.crashAt, 1.5);
      const pt = multToPoint(result.displayMult, tNorm, maxMult);

      setDisplayMult(result.displayMult);
      setPoints((prev) => {
        const next = [...prev, pt];
        return next.length > 320 ? next.slice(next.length - 320) : next;
      });

      if (result.justAutoCashed) {
        if (!credited.current && result.round.payout > 0) {
          credited.current = true;
          crashCredit(result.round.payout);
        }
        setRound(result.round);
        roundRef.current = result.round;
        setFlash('win');
        pushHistory(result.round.crashAt, result.round.cashoutAt ?? undefined);
        stopLoop();
        return;
      }

      if (result.justCrashed) {
        setRound(result.round);
        roundRef.current = result.round;
        setFlash('lose');
        pushHistory(result.round.crashAt);
        stopLoop();
        return;
      }

      setRound(result.round);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [crashCredit, stopLoop, pushHistory]);

  const flying = round.phase === 'flying';
  const canConfigure = !flying;

  const onStart = () => {
    const stake = Math.min(bet, balance);
    if (stake < 1_00 || flying) return;
    if (!crashDebit(stake)) return;
    credited.current = false;
    setFlash(null);
    setPoints([]);
    setDisplayMult(1);
    const next = startRound(stake, autoOn ? autoAt : null);
    // Instant crash: still run a tiny beat then settle
    setRound(next);
    roundRef.current = next;
    startTs.current = performance.now();
    if (next.crashAt <= 1) {
      const crashed = { ...next, phase: 'crashed' as const, payout: 0 };
      setRound(crashed);
      setDisplayMult(1);
      setFlash('lose');
      pushHistory(1);
      return;
    }
    runLoop();
  };

  const onCash = () => {
    const res = cashOut(roundRef.current, displayMult);
    if (!res.ok) return;
    stopLoop();
    if (!credited.current && res.payout > 0) {
      credited.current = true;
      crashCredit(res.payout);
    }
    setRound(res.round);
    roundRef.current = res.round;
    setFlash('win');
    pushHistory(res.round.crashAt, res.round.cashoutAt ?? undefined);
  };

  const path = buildPath(points);
  const tip = points[points.length - 1];
  const potential = payoutCents(flying ? round.bet : bet, flying ? displayMult : autoOn ? autoAt : 2);
  const leaveBlocked = flying;

  return (
    <div className="crash-screen grain">
      <header className="crash-topbar">
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            if (!leaveBlocked) leaveCrash();
          }}
          aria-label="Retour lobby"
          disabled={leaveBlocked}
          title={leaveBlocked ? 'Attends la fin du vol' : 'Retour'}
        >
          ←
        </button>
        <div className="crash-brand">
          <span className="mono">Salon des jeux · Stake-like</span>
          <h1>Crash</h1>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setRulesOpen(true)}
          aria-label="Règles Crash"
        >
          ⓘ
        </button>
        <div className="crash-balance">
          <span className="label">Crédit</span>
          <span className="value">{fmt(balance)}</span>
          <span className="peak">Pic {fmt(peakBalance)}</span>
        </div>
      </header>

      {history.length > 0 && (
        <div className="crash-history" aria-label="Historique des crashs">
          {history.map((h) => (
            <span
              key={h.id}
              className={`crash-pill ${h.crashAt < 2 ? 'low' : h.crashAt < 10 ? 'mid' : 'high'}`}
              title={h.cashed ? `Encaissé ${fmtMult(h.cashed)} · crash ${fmtMult(h.crashAt)}` : `Crash ${fmtMult(h.crashAt)}`}
            >
              {fmtMult(h.crashAt)}
            </span>
          ))}
        </div>
      )}

      <div className="crash-layout">
        <aside className="crash-panel">
          <div className="crash-panel-block">
            <label className="crash-label" htmlFor="crash-bet">
              Mise
            </label>
            <div className="crash-bet-row">
              <button
                type="button"
                className="btn ghost"
                disabled={!canConfigure}
                onClick={() => {
                  const n = Math.max(1_00, bet - 1_00);
                  setBet(n);
                  setBetDraft(String(n / 100));
                }}
              >
                −
              </button>
              <input
                id="crash-bet"
                className="crash-bet-input"
                type="text"
                inputMode="decimal"
                disabled={!canConfigure}
                value={canConfigure ? betDraft : String((round.bet / 100).toFixed(round.bet % 100 ? 2 : 0)).replace('.', ',')}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!/^[0-9\s.,]*$/.test(raw)) return;
                  setBetDraft(raw);
                  const cleaned = raw.trim().replace(/\s/g, '').replace(',', '.');
                  const n = Number(cleaned);
                  if (Number.isFinite(n) && n >= 1) setBet(Math.min(balance, Math.round(n * 100)));
                }}
                onBlur={() => {
                  const cleaned = betDraft.trim().replace(/\s/g, '').replace(',', '.');
                  const n = Number(cleaned);
                  const cents = Number.isFinite(n) ? Math.round(n * 100) : bet;
                  const clamped = Math.max(1_00, Math.min(balance, cents));
                  setBet(clamped);
                  setBetDraft(String(clamped / 100));
                }}
              />
              <button
                type="button"
                className="btn ghost"
                disabled={!canConfigure}
                onClick={() => {
                  const n = Math.min(balance, bet + 1_00);
                  setBet(n);
                  setBetDraft(String(n / 100));
                }}
              >
                +
              </button>
            </div>
            <div className="crash-presets">
              {BET_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`crash-chip ${bet === p ? 'on' : ''}`}
                  disabled={!canConfigure || p > balance}
                  onClick={() => {
                    setBet(p);
                    setBetDraft(String(p / 100));
                  }}
                >
                  {fmt(p)}
                </button>
              ))}
              <button
                type="button"
                className="crash-chip"
                disabled={!canConfigure || balance < 1_00}
                onClick={() => {
                  setBet(Math.max(1_00, balance));
                  setBetDraft(String(Math.max(1_00, balance) / 100));
                }}
              >
                Max
              </button>
            </div>
          </div>

          <div className="crash-panel-block">
            <label className="crash-label">
              <input
                type="checkbox"
                checked={autoOn}
                disabled={!canConfigure}
                onChange={(e) => setAutoOn(e.target.checked)}
              />
              Auto cashout
            </label>
            <div className="crash-auto-row">
              <input
                className="crash-auto-input"
                type="number"
                min={1.01}
                step={0.01}
                disabled={!canConfigure || !autoOn}
                value={autoAt}
                onChange={(e) => setAutoAt(Math.max(1.01, Number(e.target.value) || 1.01))}
              />
              <span className="crash-auto-x">×</span>
              <span className="crash-auto-odds">
                ~{(reachChance(autoAt) * 100).toFixed(1)}&nbsp;% d’atteindre
              </span>
            </div>
          </div>

          <div className="crash-stats">
            <div>
              <span className="k">Gain potentiel</span>
              <span className="v win">{fmt(potential)}</span>
            </div>
            <div>
              <span className="k">RTP</span>
              <span className="v brass">{(CRASH_RTP * 100).toFixed(0)}&nbsp;%</span>
            </div>
          </div>

          <div className="crash-actions">
            {canConfigure && (
              <button
                type="button"
                className="btn primary crash-cta"
                disabled={bet < 1_00 || bet > balance}
                onClick={onStart}
              >
                Décoller · {fmt(Math.min(bet, balance))}
              </button>
            )}
            {flying && (
              <button type="button" className="btn primary crash-cta cashout" onClick={onCash}>
                Encaisser · {fmt(payoutCents(round.bet, displayMult))}
              </button>
            )}
            {(round.phase === 'cashed' || round.phase === 'crashed') && (
              <button
                type="button"
                className="btn primary crash-cta"
                disabled={bet < 1_00 || bet > balance}
                onClick={onStart}
              >
                Relancer · {fmt(Math.min(bet, balance))}
              </button>
            )}
          </div>

          <p className="crash-footnote">
            Multiplicateur exponentiel · encaissement avant le crash · jetons virtuels
          </p>
        </aside>

        <main className={`crash-stage ${round.phase}`}>
          <AnimatePresence mode="wait">
            {flash && !flying && (
              <motion.div
                key={flash + displayMult}
                className={`crash-banner ${flash}`}
                initial={{ opacity: 0, y: -10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
              >
                {flash === 'win'
                  ? `Encaissé ${fmtMult(round.cashoutAt ?? displayMult)} · ${fmt(round.payout)}`
                  : `Crashed @ ${fmtMult(round.crashAt)}`}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="crash-graph-wrap">
            <svg
              className="crash-graph"
              viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
              preserveAspectRatio="none"
              aria-hidden
            >
              <defs>
                <linearGradient id="crash-trail" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0%" stopColor="rgba(194,161,95,0.05)" />
                  <stop
                    offset="100%"
                    stopColor={
                      round.phase === 'crashed'
                        ? 'rgba(207,143,143,0.55)'
                        : round.phase === 'cashed'
                          ? 'rgba(143,207,168,0.55)'
                          : 'rgba(194,161,95,0.65)'
                    }
                  />
                </linearGradient>
                <linearGradient id="crash-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={
                      round.phase === 'crashed'
                        ? 'rgba(207,143,143,0.22)'
                        : 'rgba(194,161,95,0.2)'
                    }
                  />
                  <stop offset="100%" stopColor="rgba(194,161,95,0)" />
                </linearGradient>
              </defs>
              {/* grid */}
              {[0.25, 0.5, 0.75].map((g) => (
                <line
                  key={g}
                  x1="28"
                  x2={GRAPH_W - 48}
                  y1={28 + (GRAPH_H - 64) * g}
                  y2={28 + (GRAPH_H - 64) * g}
                  className="crash-grid"
                />
              ))}
              {points.length > 1 && (
                <>
                  <path
                    d={`${path} L ${tip!.x} ${GRAPH_H - 36} L ${points[0].x} ${GRAPH_H - 36} Z`}
                    fill="url(#crash-fill)"
                  />
                  <path d={path} fill="none" stroke="url(#crash-trail)" strokeWidth="3.2" strokeLinecap="round" />
                </>
              )}
            </svg>

            {tip && (flying || round.phase === 'cashed' || round.phase === 'crashed') && (
              <div
                className={`crash-plane ${round.phase}`}
                style={{
                  left: `${(tip.x / GRAPH_W) * 100}%`,
                  top: `${(tip.y / GRAPH_H) * 100}%`,
                }}
              >
                <PlaneIcon crashed={round.phase === 'crashed'} />
                {round.phase === 'crashed' && <span className="crash-boom" />}
              </div>
            )}

            <div className={`crash-mult ${round.phase}`}>
              <span className="crash-mult-value">{fmtMult(displayMult)}</span>
              {flying && <span className="crash-mult-sub">En vol…</span>}
              {round.phase === 'idle' && <span className="crash-mult-sub">En attente du décollage</span>}
              {round.phase === 'crashed' && <span className="crash-mult-sub">Crash</span>}
              {round.phase === 'cashed' && <span className="crash-mult-sub">Encaissé</span>}
            </div>
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

      <RulesGuide game="crash" open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
