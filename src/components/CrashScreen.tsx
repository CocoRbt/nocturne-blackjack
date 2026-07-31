import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cashOut,
  createIdleRound,
  startRound,
  tickRound,
  type CrashRound,
} from '../crash/engine';
import {
  GRAPH_H,
  GRAPH_W,
  buildPath,
  displayYMax,
  projectSample,
  projectSamples,
  type FlightSample,
} from '../crash/graph';
import { CRASH_RTP, payoutCents, reachChance } from '../crash/math';
import { notifyDefi } from '../defis/track';
import { fmt, fmtMult } from '../lib/format';
import { useGame } from '../store/gameStore';
import { GameShell } from './GameShell';
import { RulesGuide } from './RulesGuide';

const BET_PRESETS = [1_00, 5_00, 25_00, 100_00, 500_00] as const;
const HISTORY_MAX = 18;
const AUTO_MIN = 1.01;

/** Parse un multiplicateur saisi (virgule ou point). */
function parseAutoMult(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!cleaned || cleaned === '.' || cleaned === '-') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n * 100) / 100;
}

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

export function CrashScreen() {
  const balance = useGame((s) => s.balance);
  const leaveCrash = useGame((s) => s.leaveCrash);
  const crashDebit = useGame((s) => s.crashDebit);
  const crashCredit = useGame((s) => s.crashCredit);
  const notice = useGame((s) => s.notice);
  const dismissNotice = useGame((s) => s.dismissNotice);

  const [bet, setBet] = useState(5_00);
  const [betDraft, setBetDraft] = useState('5');
  const [autoOn, setAutoOn] = useState(false);
  const [autoAt, setAutoAt] = useState(2);
  const [autoDraft, setAutoDraft] = useState('2');
  const [round, setRound] = useState<CrashRound>(() => createIdleRound());
  const [displayMult, setDisplayMult] = useState(1);
  const [samples, setSamples] = useState<FlightSample[]>([]);
  const [windowEnd, setWindowEnd] = useState(0);
  const [cashSample, setCashSample] = useState<FlightSample | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [flash, setFlash] = useState<'win' | 'lose' | null>(null);
  const [flightOverBanner, setFlightOverBanner] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  const startTs = useRef(0);
  const raf = useRef(0);
  const roundRef = useRef(round);
  const credited = useRef(false);
  const histPushed = useRef(false);
  const histIdRef = useRef(0);
  const samplesRef = useRef<FlightSample[]>([]);

  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  useEffect(() => {
    if (!round.flightActive) {
      if (bet > balance) {
        const c = Math.max(1_00, balance);
        setBet(c);
        setBetDraft(String(c / 100));
      }
    }
  }, [balance, bet, round.flightActive]);

  const stopLoop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  useEffect(() => () => stopLoop(), [stopLoop]);

  const pushHistory = useCallback((crashAt: number, cashed?: number) => {
    if (histPushed.current) return;
    histPushed.current = true;
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

      // Graphe : temps réel + échelle Y sur le mult visible — JAMAIS crashAt.
      const sample: FlightSample = { elapsed, mult: result.displayMult };
      const nextSamples = [...samplesRef.current, sample].slice(-480);
      samplesRef.current = nextSamples;
      setSamples(nextSamples);
      setWindowEnd(elapsed);
      setDisplayMult(result.displayMult);

      if (result.justAutoCashed) {
        if (!credited.current && result.round.payout > 0) {
          credited.current = true;
          crashCredit(result.round.payout);
        }
        setFlash('win');
        if (result.round.cashoutAt != null) {
          setCashSample({ elapsed, mult: result.round.cashoutAt });
          notifyDefi({ type: 'crash_cashout', mult: result.round.cashoutAt });
        }
      }

      if (result.justFlightEnded) {
        setRound(result.round);
        roundRef.current = result.round;
        setFlightOverBanner(true);
        if (result.round.phase === 'cashed') {
          setFlash('win');
          pushHistory(result.round.crashAt, result.round.cashoutAt ?? undefined);
        } else {
          if (!credited.current) {
            credited.current = true;
            crashCredit(0);
          }
          setFlash('lose');
          pushHistory(result.round.crashAt);
        }
        stopLoop();
        return;
      }

      setRound(result.round);
      roundRef.current = result.round;
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [crashCredit, stopLoop, pushHistory]);

  const inFlight = round.flightActive;
  const canBet = !inFlight;
  const canCash = round.phase === 'flying' && inFlight;

  const onStart = () => {
    if (inFlight) return;
    const stake = Math.min(bet, balance);
    if (stake < 1_00) return;
    if (!crashDebit(stake)) return;
    stopLoop();
    credited.current = false;
    histPushed.current = false;
    setFlash(null);
    setFlightOverBanner(false);
    samplesRef.current = [];
    setSamples([]);
    setWindowEnd(0);
    setCashSample(null);
    setDisplayMult(1);
    const next = startRound(stake, autoOn ? autoAt : null);
    setRound(next);
    roundRef.current = next;
    startTs.current = performance.now();
    if (next.crashAt <= 1) {
      const crashed = { ...next, phase: 'crashed' as const, payout: 0, flightActive: false };
      setRound(crashed);
      roundRef.current = crashed;
      setDisplayMult(1);
      setFlash('lose');
      setFlightOverBanner(true);
      credited.current = true;
      crashCredit(0);
      pushHistory(1);
      return;
    }
    runLoop();
  };

  const onCash = () => {
    const res = cashOut(roundRef.current, displayMult);
    if (!res.ok) return;
    if (!credited.current && res.payout > 0) {
      credited.current = true;
      crashCredit(res.payout);
    }
    setRound(res.round);
    roundRef.current = res.round;
    setFlash('win');
    if (res.round.cashoutAt != null) {
      const elapsed = performance.now() - startTs.current;
      setCashSample({ elapsed, mult: res.round.cashoutAt });
      notifyDefi({ type: 'crash_cashout', mult: res.round.cashoutAt });
    }
    // Vol continue jusqu’au crash — pas de stopLoop.
  };

  const yMax = displayYMax(displayMult);
  const points = projectSamples(samples, windowEnd, yMax);
  const path = buildPath(points);
  const tip = points[points.length - 1];
  const cashMark = cashSample ? projectSample(cashSample, windowEnd, yMax) : null;
  const potential = payoutCents(
    canCash || (round.phase === 'cashed' && inFlight) ? round.bet : bet,
    canCash ? displayMult : autoOn ? autoAt : 2,
  );
  const stageClass =
    round.phase === 'cashed' && inFlight
      ? 'cashed flying'
      : round.flightActive
        ? 'flying'
        : round.phase;

  return (
    <div className="crash-screen grain">
      <GameShell
        accent="crash"
        title="Crash"
        eyebrow="Salon des jeux · Crash"
        onBack={() => {
          if (!inFlight) leaveCrash();
        }}
        backDisabled={inFlight}
        backTitle={inFlight ? 'Attendez la fin du vol' : 'Retour Lobby'}
        onRules={() => setRulesOpen(true)}
        rulesLabel="Règles Crash"
      />

      {history.length > 0 && (
        <div className="crash-history" aria-label="Historique des crashs">
          {history.map((h) => (
            <span
              key={h.id}
              className={`crash-pill ${h.crashAt < 2 ? 'low' : h.crashAt < 10 ? 'mid' : 'high'}`}
              title={
                h.cashed
                  ? `Encaissé ${fmtMult(h.cashed)} · crash ${fmtMult(h.crashAt)}`
                  : `Crash ${fmtMult(h.crashAt)}`
              }
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
                disabled={!canBet}
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
                disabled={!canBet}
                value={
                  canBet
                    ? betDraft
                    : String((round.bet / 100).toFixed(round.bet % 100 ? 2 : 0)).replace('.', ',')
                }
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
                disabled={!canBet}
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
                  disabled={!canBet || p > balance}
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
                disabled={!canBet || balance < 1_00}
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
                disabled={!canBet}
                onChange={(e) => setAutoOn(e.target.checked)}
              />
              Encaissement auto
            </label>
            <div className="crash-auto-row">
              <input
                className="crash-auto-input"
                type="text"
                inputMode="decimal"
                disabled={!canBet || !autoOn}
                value={autoDraft}
                aria-label="Multiplicateur d'encaissement auto"
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!/^[0-9\s.,]*$/.test(raw)) return;
                  setAutoDraft(raw);
                  const n = parseAutoMult(raw);
                  if (n != null && n >= AUTO_MIN) setAutoAt(n);
                }}
                onBlur={() => {
                  const n = parseAutoMult(autoDraft);
                  const clamped = Math.max(AUTO_MIN, n ?? autoAt);
                  setAutoAt(clamped);
                  setAutoDraft(String(clamped));
                }}
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
            {round.cashoutAt != null && (
              <div>
                <span className="k">Encaissé</span>
                <span className="v win">{fmtMult(round.cashoutAt)}</span>
              </div>
            )}
            <div>
              <span className="k">RTP</span>
              <span className="v brass">{(CRASH_RTP * 100).toFixed(0)}&nbsp;%</span>
            </div>
          </div>

          <div className="crash-actions">
            {canBet && (
              <button
                type="button"
                className="btn primary crash-cta"
                disabled={bet < 1_00 || bet > balance}
                onClick={onStart}
              >
                {round.phase === 'idle' ? 'Décoller' : 'Relancer'} · {fmt(Math.min(bet, balance))}
              </button>
            )}
            {canCash && (
              <button type="button" className="btn primary crash-cta cashout" onClick={onCash}>
                Encaisser · {fmt(payoutCents(round.bet, displayMult))}
              </button>
            )}
            {round.phase === 'cashed' && inFlight && (
              <p className="crash-waiting">Encaissé — l’avion continue jusqu’au crash…</p>
            )}
          </div>

          <p className="crash-footnote">
            Multiplicateur exponentiel · encaissement avant le crash · jetons virtuels
          </p>
        </aside>

        <main className={`crash-stage ${stageClass}`}>
          <AnimatePresence mode="wait">
            {flash === 'win' && round.cashoutAt != null && (
              <motion.div
                key={`win-${round.cashoutAt}`}
                className="crash-banner win"
                initial={{ opacity: 0, y: -10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
              >
                Encaissé {fmtMult(round.cashoutAt)} · {fmt(round.payout)}
                {flightOverBanner ? ` · crash @ ${fmtMult(round.crashAt)}` : ''}
              </motion.div>
            )}
            {flash === 'lose' && !inFlight && (
              <motion.div
                key={`lose-${round.crashAt}`}
                className="crash-banner lose"
                initial={{ opacity: 0, y: -10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
              >
                Crashed @ {fmtMult(round.crashAt)}
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
                      !inFlight && round.phase === 'crashed'
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
                      !inFlight && round.phase === 'crashed'
                        ? 'rgba(207,143,143,0.22)'
                        : round.phase === 'cashed'
                          ? 'rgba(143,207,168,0.18)'
                          : 'rgba(194,161,95,0.2)'
                    }
                  />
                  <stop offset="100%" stopColor="rgba(194,161,95,0)" />
                </linearGradient>
              </defs>
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
                  <path
                    d={path}
                    fill="none"
                    stroke="url(#crash-trail)"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                  />
                </>
              )}
              {cashMark && (
                <g className="crash-cash-mark">
                  <circle cx={cashMark.x} cy={cashMark.y} r="5" fill="#8fcfa8" stroke="#e9e4d8" strokeWidth="1.5" />
                </g>
              )}
            </svg>

            {tip && (inFlight || round.phase === 'cashed' || round.phase === 'crashed') && (
              <div
                className={`crash-plane ${inFlight ? (round.phase === 'cashed' ? 'cashed flying' : 'flying') : round.phase}`}
                style={{
                  left: `${(tip.x / GRAPH_W) * 100}%`,
                  top: `${(tip.y / GRAPH_H) * 100}%`,
                }}
              >
                <PlaneIcon crashed={!inFlight && round.phase !== 'idle'} />
                {!inFlight && round.phase !== 'idle' && <span className="crash-boom" />}
              </div>
            )}

            <div
              className={`crash-mult ${
                round.phase === 'cashed' && inFlight
                  ? 'cashed'
                  : inFlight
                    ? 'flying'
                    : round.phase
              }`}
            >
              <span className="crash-mult-value">{fmtMult(displayMult)}</span>
              {round.phase === 'flying' && inFlight && (
                <span className="crash-mult-sub">En vol…</span>
              )}
              {round.phase === 'cashed' && inFlight && (
                <span className="crash-mult-sub">
                  Encaissé @ {fmtMult(round.cashoutAt!)} · vol en cours
                </span>
              )}
              {round.phase === 'idle' && <span className="crash-mult-sub">En attente du décollage</span>}
              {!inFlight && round.phase === 'crashed' && (
                <span className="crash-mult-sub">Crash</span>
              )}
              {!inFlight && round.phase === 'cashed' && (
                <span className="crash-mult-sub">Crash @ {fmtMult(round.crashAt)}</span>
              )}
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
