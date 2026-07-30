import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import {
  canPlaceDontPass,
  canPlaceOdds,
  canPlacePass,
  createCrapsRound,
  cryptoUnit,
  oddsCap,
  placeBet,
  resolveRoll,
  rollDice,
  type BetKind,
  type CrapsRound,
  type DieFace,
} from '../craps/engine';
import { notifyDefi } from '../defis/track';
import { fmt } from '../lib/format';
import { useGame } from '../store/gameStore';
import { RulesGuide } from './RulesGuide';

const BET_PRESETS = [1_00, 5_00, 25_00, 100_00, 500_00] as const;
const THROW_MS = 1600;
const SETTLE_DELAY_MS = 280;

const PIP_MAP: Record<DieFace, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [28, 28],
    [50, 50],
    [72, 72],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [28, 28],
    [72, 28],
    [50, 50],
    [28, 72],
    [72, 72],
  ],
  6: [
    [28, 28],
    [72, 28],
    [28, 50],
    [72, 50],
    [28, 72],
    [72, 72],
  ],
};

const BET_COPY: Record<
  BetKind,
  { title: string; win: string; lose: string; tip: string; badge?: string }
> = {
  pass: {
    title: 'Pass Line',
    badge: 'Le plus simple',
    win: 'Gagne si 7 ou 11 tout de suite, ou si le point sort avant un 7',
    lose: 'Perd sur 2, 3, 12 au come-out, ou sur un 7 avant le point',
    tip: 'Mise classique du shooter — commence ici.',
  },
  dont_pass: {
    title: 'Don’t Pass',
    win: 'Gagne sur 2 ou 3 au come-out, ou si un 7 sort avant le point',
    lose: 'Perd sur 7 ou 11 ; sur 12 tu es remboursé (bar)',
    tip: 'Tu joues contre le shooter.',
  },
  field: {
    title: 'Field',
    win: 'Gagne sur 2, 3, 4, 9, 10, 11, 12 (un seul lancer)',
    lose: 'Perd sur 5, 6, 7 ou 8',
    tip: '2 paie double, 12 paie triple.',
  },
  odds: {
    title: 'Odds',
    win: 'Derrière Pass : gagne si le point sort avant un 7',
    lose: 'Perd avec le seven-out',
    tip: 'Cotes vraies (0 % de commission) — dispo seulement après un point.',
  },
};

function randFace(): DieFace {
  return (Math.floor(cryptoUnit() * 6) + 1) as DieFace;
}

function DieFaceSvg({ face }: { face: DieFace }) {
  return (
    <svg viewBox="0 0 100 100" className="craps-die-svg">
      <rect x="6" y="6" width="88" height="88" rx="16" className="craps-die-face" />
      {PIP_MAP[face].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="8.5" className="craps-die-pip" />
      ))}
    </svg>
  );
}

function ThrowingDie({
  face,
  throwing,
  throwKey,
  side,
}: {
  face: DieFace;
  throwing: boolean;
  throwKey: number;
  side: 'left' | 'right';
}) {
  const xFrom = side === 'left' ? -120 : 120;
  const rotFrom = side === 'left' ? -420 : 480;

  return (
    <div className="craps-die-slot">
      <motion.div
        key={`shadow-${throwKey}-${throwing}`}
        className="craps-die-shadow"
        initial={throwing ? { opacity: 0, scale: 0.4, y: -40 } : false}
        animate={
          throwing
            ? {
                opacity: [0, 0.15, 0.45, 0.55],
                scale: [0.4, 0.7, 1.1, 1],
                y: [-40, -10, 8, 0],
              }
            : { opacity: 0.45, scale: 1, y: 0 }
        }
        transition={{ duration: THROW_MS / 1000, ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.div
        key={`die-${throwKey}`}
        className={`craps-die ${throwing ? 'is-throwing' : ''}`}
        initial={
          throwing
            ? { x: xFrom, y: -160, rotate: rotFrom, scale: 0.7, opacity: 0.85 }
            : false
        }
        animate={
          throwing
            ? {
                x: [xFrom, xFrom * 0.2, 8, 0],
                y: [-160, -40, 18, 0],
                rotate: [rotFrom, rotFrom * 0.4, side === 'left' ? 24 : -28, 0],
                scale: [0.7, 1.12, 0.96, 1],
                opacity: 1,
              }
            : { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }
        }
        transition={{ duration: THROW_MS / 1000, ease: [0.18, 0.85, 0.25, 1] }}
        aria-label={`Dé ${face}`}
      >
        <DieFaceSvg face={face} />
      </motion.div>
    </div>
  );
}

function coachCopy(round: CrapsRound, hasLine: boolean, hasAnyBet: boolean): {
  step: string;
  title: string;
  body: string;
} {
  if (round.phase === 'point' && round.point != null) {
    return {
      step: 'Étape 3',
      title: `Point ${round.point} en jeu`,
      body: `Il faut refaire un ${round.point} avant un 7. Tu peux ajouter des Odds derrière Pass, ou du Field à chaque lancer.`,
    };
  }
  if (!hasAnyBet) {
    return {
      step: 'Étape 1',
      title: 'Place une mise',
      body: 'Commence par Pass Line (recommandé) : tu gagnes tout de suite sur 7 ou 11. Don’t Pass joue l’inverse. Field = un seul lancer.',
    };
  }
  if (!hasLine && round.bets.field > 0) {
    return {
      step: 'Étape 2',
      title: 'Lance les dés',
      body: 'Tu n’as que du Field : le résultat se joue sur ce lancer uniquement (2,3,4,9,10,11,12 gagnent).',
    };
  }
  return {
    step: 'Étape 2',
    title: 'Lance les dés',
    body: 'Come-out : 7 ou 11 = Pass gagne. 2, 3, 12 = Pass perd. Autre total = on établit le point.',
  };
}

export function CrapsScreen() {
  const balance = useGame((s) => s.balance);
  const peakBalance = useGame((s) => s.peakBalance);
  const leaveCraps = useGame((s) => s.leaveCraps);
  const crapsDebit = useGame((s) => s.crapsDebit);
  const crapsCredit = useGame((s) => s.crapsCredit);
  const notice = useGame((s) => s.notice);
  const dismissNotice = useGame((s) => s.dismissNotice);

  const [chip, setChip] = useState(5_00);
  const [round, setRound] = useState<CrapsRound>(() => createCrapsRound());
  const [rolling, setRolling] = useState(false);
  const [flash, setFlash] = useState<'win' | 'lose' | 'push' | null>(null);
  const [selected, setSelected] = useState<BetKind>('pass');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [faces, setFaces] = useState<[DieFace, DieFace]>([5, 2]);
  const [throwKey, setThrowKey] = useState(0);
  const [showTotal, setShowTotal] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    for (const t of timers.current) {
      window.clearTimeout(t);
      window.clearInterval(t);
    }
    timers.current = [];
  };

  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    if (chip > balance) setChip(Math.max(1_00, balance));
  }, [balance, chip]);

  useEffect(() => {
    if (round.phase === 'point' && selected === 'pass') setSelected('odds');
    if (round.phase === 'come_out' && selected === 'odds') setSelected('pass');
  }, [round.phase, selected]);

  const working =
    round.bets.pass + round.bets.dontPass + round.bets.field + round.bets.odds;
  const hasLine = round.bets.pass + round.bets.dontPass > 0;
  const canRoll = working > 0 && !rolling;
  const oddsMax = oddsCap(round);
  const coach = coachCopy(round, hasLine, working > 0);
  const selectedCopy = BET_COPY[selected];
  const total = faces[0] + faces[1];

  const onPlace = (kind: BetKind) => {
    if (rolling) return;
    const amount = Math.min(chip, balance);
    if (amount < 1_00) return;
    if (kind === 'odds') {
      const room = oddsMax - round.bets.odds;
      if (room < 1_00) return;
      const stake = Math.min(amount, room);
      const result = placeBet(round, kind, stake);
      if (!result.ok) return;
      if (!crapsDebit(result.debitCents)) return;
      setRound(result.round);
      setSelected(kind);
      setFlash(null);
      return;
    }
    const result = placeBet(round, kind, amount);
    if (!result.ok) return;
    if (!crapsDebit(result.debitCents)) return;
    setRound(result.round);
    setSelected(kind);
    setFlash(null);
  };

  const onRoll = () => {
    if (!canRoll) return;
    clearTimers();
    const final = rollDice(cryptoUnit);
    const snapshot = round;
    setRolling(true);
    setFlash(null);
    setShowTotal(false);
    setThrowKey((k) => k + 1);

    let tick = 0;
    const tumble = window.setInterval(() => {
      setFaces([randFace(), randFace()]);
      tick += 1;
      if (tick >= 14) window.clearInterval(tumble);
    }, 95);
    timers.current.push(tumble as unknown as number);

    timers.current.push(
      window.setTimeout(() => {
        window.clearInterval(tumble);
        setFaces([final.d1, final.d2]);
        setShowTotal(true);
        const res = resolveRoll(snapshot, final);
        if (!res.ok) {
          setRolling(false);
          return;
        }
        timers.current.push(
          window.setTimeout(() => {
            const kinds = res.round.settlements.map((s) => s.kind);
            const lineEnded = kinds.some(
              (k) =>
                k === 'pass_win' ||
                k === 'pass_lose' ||
                k === 'dont_pass_win' ||
                k === 'dont_pass_lose' ||
                k === 'dont_pass_push' ||
                k === 'seven_out' ||
                k === 'point_made',
            );
            if (lineEnded) crapsCredit(res.creditCents, true);
            else if (res.creditCents > 0) crapsCredit(res.creditCents, false);
            setRound(res.round);
            if (kinds.some((k) => k === 'pass_win')) notifyDefi({ type: 'craps_pass_win' });
            if (kinds.some((k) => k.endsWith('_win') || k === 'point_made')) setFlash('win');
            else if (kinds.some((k) => k === 'dont_pass_push' || k === 'point_set')) setFlash('push');
            else if (kinds.some((k) => k.endsWith('_lose') || k === 'seven_out')) setFlash('lose');
            setRolling(false);
          }, SETTLE_DELAY_MS),
        );
      }, THROW_MS),
    );
  };

  return (
    <div className="craps-screen grain">
      <header className="craps-topbar">
        <button type="button" className="icon-btn" onClick={leaveCraps} aria-label="Retour lobby">
          ←
        </button>
        <div className="craps-brand">
          <span className="mono">Salon des jeux · Scraps</span>
          <h1>Craps</h1>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setRulesOpen(true)}
          aria-label="Règles Craps"
        >
          ⓘ
        </button>
        <div className="craps-balance">
          <span className="label">Crédit</span>
          <span className="value">{fmt(balance)}</span>
          <span className="peak">Pic {fmt(peakBalance)}</span>
        </div>
      </header>

      <div className="craps-layout">
        <aside className="craps-panel">
          <div className="craps-coach" data-phase={round.phase}>
            <span className="craps-coach-step">{coach.step}</span>
            <strong>{coach.title}</strong>
            <p>{coach.body}</p>
          </div>

          <div className="craps-panel-block">
            <label className="craps-label">Jeton à poser</label>
            <div className="craps-presets">
              {BET_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`craps-chip ${chip === p ? 'on' : ''}`}
                  disabled={rolling || p > balance}
                  onClick={() => setChip(p)}
                >
                  {fmt(p)}
                </button>
              ))}
              <button
                type="button"
                className="craps-chip"
                disabled={rolling || balance < 1_00}
                onClick={() => setChip(Math.max(1_00, balance))}
              >
                Max
              </button>
            </div>
          </div>

          <div className="craps-hint">
            <span className="craps-hint-k">{selectedCopy.title}</span>
            <p>{selectedCopy.tip}</p>
            <p className="win">{selectedCopy.win}</p>
            <p className="lose">{selectedCopy.lose}</p>
          </div>

          <div className="craps-stats">
            <div>
              <span className="k">En jeu</span>
              <span className="v">{fmt(working)}</span>
            </div>
            {round.phase === 'point' && (
              <div>
                <span className="k">Odds max</span>
                <span className="v">{fmt(oddsMax)}</span>
              </div>
            )}
            {round.lastRoll && !rolling && (
              <div>
                <span className="k">Dernier lancer</span>
                <span className="v brass">
                  {round.lastRoll.d1}+{round.lastRoll.d2} = {round.lastRoll.total}
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            className={`btn primary craps-cta ${canRoll ? 'pulse' : ''}`}
            disabled={!canRoll}
            onClick={onRoll}
          >
            {rolling ? 'Les dés volent…' : working === 0 ? 'Mise d’abord, puis lance' : 'Lancer les dés'}
          </button>

          <ul className="craps-settle">
            {round.settlements
              .filter((s) => s.kind !== 'seven_out')
              .map((s, i) => (
                <li key={`${s.kind}-${i}`} className={s.kind.includes('win') || s.kind === 'point_made' ? 'ok' : s.kind.includes('lose') ? 'bad' : ''}>
                  {s.label}
                </li>
              ))}
          </ul>

          <p className="craps-footnote">
            Clique une zone pour y poser le jeton · ⓘ pour le guide complet
          </p>
        </aside>

        <main className="craps-table-wrap">
          <AnimatePresence mode="wait">
            {(flash || round.message) && !rolling && (
              <motion.p
                key={round.message + (flash ?? '')}
                className={`craps-banner ${flash ?? ''}`}
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
              >
                {round.message}
              </motion.p>
            )}
          </AnimatePresence>

          <div className={`craps-felt ${round.phase === 'point' ? 'point-on' : ''} ${rolling ? 'is-rolling' : ''}`}>
            <div className="craps-puck-row">
              <div className={`craps-puck ${round.phase === 'point' ? 'on' : 'off'}`}>
                <span className="puck-label">{round.phase === 'point' ? 'ON' : 'OFF'}</span>
                <span className="puck-value">
                  {round.phase === 'point' ? round.point : '—'}
                </span>
              </div>

              <div className="craps-throw">
                <div className="craps-dice">
                  <ThrowingDie face={faces[0]} throwing={rolling} throwKey={throwKey} side="left" />
                  <ThrowingDie face={faces[1]} throwing={rolling} throwKey={throwKey} side="right" />
                </div>
                <AnimatePresence>
                  {showTotal && (
                    <motion.div
                      key={`total-${throwKey}`}
                      className="craps-total"
                      initial={{ opacity: 0, scale: 0.6, y: 12 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                    >
                      <span className="craps-total-k">Total</span>
                      <strong>{total}</strong>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {round.phase === 'point' && round.point != null && (
              <div className="craps-goal" aria-live="polite">
                Objectif : <strong>{round.point}</strong> avant <strong className="sev">7</strong>
              </div>
            )}

            <div className="craps-spots">
              {(
                [
                  ['pass', canPlacePass(round), round.bets.pass],
                  ['dont_pass', canPlaceDontPass(round), round.bets.dontPass],
                  ['field', true, round.bets.field],
                  ['odds', canPlaceOdds(round), round.bets.odds],
                ] as const
              ).map(([kind, allowed, stake]) => {
                const copy = BET_COPY[kind];
                return (
                  <button
                    key={kind}
                    type="button"
                    className={`craps-spot ${kind === 'dont_pass' ? 'dont' : kind} ${selected === kind ? 'sel' : ''} ${!allowed ? 'locked' : ''}`}
                    disabled={rolling || !allowed}
                    onClick={() => {
                      setSelected(kind);
                      onPlace(kind);
                    }}
                  >
                    <span className="spot-top">
                      <span className="spot-name">{copy.title}</span>
                      {copy.badge && <span className="spot-badge">{copy.badge}</span>}
                    </span>
                    <span className="spot-pay">{copy.tip}</span>
                    <span className="spot-winlose">
                      <span className="w">✓ {copy.win}</span>
                      <span className="l">✗ {copy.lose}</span>
                    </span>
                    {stake > 0 && <span className="spot-stake">{fmt(stake)}</span>}
                  </button>
                );
              })}
            </div>

            {round.history.length > 0 && (
              <div className="craps-history" aria-label="Historique des lancers">
                <span className="craps-history-label">Lancers</span>
                {round.history.map((h, i) => (
                  <span
                    key={`${h.total}-${i}`}
                    className={h.total === 7 ? 'sev' : h.total === round.point ? 'pt' : ''}
                    title={`${h.d1}+${h.d2}`}
                  >
                    {h.total}
                  </span>
                ))}
              </div>
            )}
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

      <RulesGuide game="craps" open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
