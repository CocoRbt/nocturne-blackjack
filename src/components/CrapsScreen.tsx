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
import { GameShell } from './GameShell';
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
  { title: string; win: string; lose: string; tip: string; pay: string; badge?: string }
> = {
  pass: {
    title: 'Gagner',
    badge: 'Simple',
    win: 'Tu gagnes si tu fais 7 ou 11 tout de suite, ou si tu retombes sur ta cible avant un 7.',
    lose: 'Tu perds sur 2, 3 ou 12 au premier lancer, ou si un 7 sort avant ta cible.',
    tip: 'Le plus simple : commence ici.',
    pay: '×2 si 7 ou 11',
  },
  dont_pass: {
    title: 'Contre',
    win: 'Tu gagnes sur 2 ou 3 au premier lancer, ou si un 7 sort avant la cible.',
    lose: 'Tu perds sur 7 ou 11. Sur 12, on te rend juste ta mise.',
    tip: 'Tu paries que les dés vont mal tourner.',
    pay: '×2 si 2 ou 3',
  },
  field: {
    title: 'Ce coup',
    win: 'Tu gagnes sur 2, 3, 4, 9, 10, 11 ou 12 — ce lancer uniquement.',
    lose: 'Tu perds sur 5, 6, 7 ou 8.',
    tip: 'Rapide : un seul lancer. 2 paie double, 12 paie triple.',
    pay: 'Un seul lancer',
  },
  odds: {
    title: 'Miser plus',
    win: 'Tu gagnes en plus si tu atteins ta cible avant un 7.',
    lose: 'Tu perds aussi si un 7 sort trop tôt.',
    tip: 'Dispo seulement quand tu as une cible. Meilleur rapport du jeu.',
    pay: 'Sur ta cible',
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
      step: 'Suite',
      title: `Cible : ${round.point}`,
      body: `Refais un ${round.point} avant un 7. Tu peux « Miser plus » sur ta cible, ou jouer « Ce coup » à chaque lancer.`,
    };
  }
  if (!hasAnyBet) {
    return {
      step: '1 · Mise',
      title: 'Pose un jeton',
      body: 'Commence par « Gagner » : 7 ou 11 = tu gagnes tout de suite. « Contre » = l’inverse. « Ce coup » = un seul lancer.',
    };
  }
  if (!hasLine && round.bets.field > 0) {
    return {
      step: '2 · Lancer',
      title: 'Lance les dés',
      body: 'Tu n’as que « Ce coup » : 2, 3, 4, 9, 10, 11 ou 12 = tu gagnes. Sinon tu perds.',
    };
  }
  return {
    step: '2 · Lancer',
    title: 'Lance les dés',
    body: '7 ou 11 = tu gagnes. 2, 3 ou 12 = tu perds. Autre total = on fixe une cible à refaire.',
  };
}

export function CrapsScreen() {
  const balance = useGame((s) => s.balance);
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
    const el = document.querySelector('.craps-screen');
    if (el instanceof HTMLElement) el.scrollTop = 0;
  }, []);

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
      <GameShell
        accent="craps"
        title="Craps"
        eyebrow="Salon des jeux"
        onBack={leaveCraps}
        onRules={() => setRulesOpen(true)}
        rulesLabel="Comment jouer"
      />

      <div className="craps-layout">
        <aside className="craps-panel">
          <div className="craps-coach" data-phase={round.phase}>
            <span className="craps-coach-step">{coach.step}</span>
            <strong>{coach.title}</strong>
            <p>{coach.body}</p>
          </div>

          <div className="craps-panel-block">
            <label className="craps-label">Combien tu mises</label>
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
                <span className="k">Encore dispo</span>
                <span className="v">{fmt(oddsMax)}</span>
              </div>
            )}
            {round.lastRoll && !rolling && (
              <div>
                <span className="k">Dernier jet</span>
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
            {rolling ? 'Les dés volent…' : working === 0 ? 'Mise d’abord…' : 'Lancer !'}
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
            Tape une case pour y poser ton jeton · ⓘ si tu bloques
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
                <span className="puck-label">{round.phase === 'point' ? 'Cible' : 'Libre'}</span>
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
                Il faut un <strong>{round.point}</strong>… sans faire <strong className="sev">7</strong>
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
                    className={`craps-spot ${kind === 'dont_pass' ? 'dont' : kind} ${selected === kind ? 'sel' : ''} ${!allowed ? 'locked' : ''} ${stake > 0 ? 'has-bet' : ''}`}
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
                    <span className="spot-pay">{copy.pay}</span>
                    {stake > 0 ? (
                      <span className="spot-stake">{fmt(stake)}</span>
                    ) : (
                      <span className="spot-stake empty">Poser</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {round.history.length > 0 && (
            <div className="craps-history" aria-label="Historique des lancers">
              {round.history.map((h, i) => (
                <span
                  key={`${h.total}-${i}`}
                  className={`craps-pill ${h.total === 7 ? 'sev' : h.total === round.point ? 'pt' : ''}`}
                  title={`${h.d1}+${h.d2}`}
                >
                  {h.total}
                </span>
              ))}
            </div>
          )}
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
