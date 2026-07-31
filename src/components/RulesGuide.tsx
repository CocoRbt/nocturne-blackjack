import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { getTable } from '../engine/rules';
import { SIDE_BET_DEFS } from '../engine/sidebets';
import { fmt, fmtPays } from '../lib/format';
import { useGame } from '../store/gameStore';

export type RulesGame = 'blackjack' | 'mines' | 'craps' | 'crash';

function IlluBlackjack() {
  return (
    <svg className="rules-illu" viewBox="0 0 280 120" aria-hidden>
      <defs>
        <linearGradient id="rg-felt" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1a4a38" />
          <stop offset="100%" stopColor="#0a1f16" />
        </linearGradient>
        <linearGradient id="rg-card" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#faf6ec" />
          <stop offset="100%" stopColor="#e4dcc8" />
        </linearGradient>
      </defs>
      <rect width="280" height="120" rx="14" fill="url(#rg-felt)" />
      <ellipse cx="140" cy="110" rx="110" ry="18" fill="rgba(0,0,0,0.25)" />
      {/* dealer card */}
      <g transform="translate(108,12) rotate(-6)">
        <rect width="48" height="68" rx="6" fill="url(#rg-card)" stroke="rgba(0,0,0,0.15)" />
        <text x="8" y="20" fontSize="14" fill="#a63d3d" fontFamily="Georgia, serif">A♥</text>
      </g>
      {/* player cards */}
      <g transform="translate(72,38) rotate(-12)">
        <rect width="48" height="68" rx="6" fill="url(#rg-card)" stroke="rgba(0,0,0,0.15)" />
        <text x="8" y="20" fontSize="14" fill="#23262b" fontFamily="Georgia, serif">K♠</text>
      </g>
      <g transform="translate(158,38) rotate(10)">
        <rect width="48" height="68" rx="6" fill="url(#rg-card)" stroke="rgba(0,0,0,0.15)" />
        <text x="8" y="20" fontSize="14" fill="#a63d3d" fontFamily="Georgia, serif">Q♦</text>
      </g>
      <circle cx="40" cy="88" r="14" fill="#8b2e2e" stroke="#c2a15f" strokeWidth="1.5" />
      <circle cx="240" cy="88" r="14" fill="#1e3a5f" stroke="#c2a15f" strokeWidth="1.5" />
      <text x="140" y="108" textAnchor="middle" fill="rgba(194,161,95,0.7)" fontSize="9" letterSpacing="3" fontFamily="sans-serif">
        BLACKJACK
      </text>
    </svg>
  );
}

function IlluMines() {
  return (
    <svg className="rules-illu" viewBox="0 0 280 120" aria-hidden>
      <defs>
        <linearGradient id="rg-mines-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0e1816" />
          <stop offset="100%" stopColor="#0a1012" />
        </linearGradient>
        <linearGradient id="rg-gem" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#b8fff0" />
          <stop offset="50%" stopColor="#3ecfad" />
          <stop offset="100%" stopColor="#1a7a68" />
        </linearGradient>
      </defs>
      <rect width="280" height="120" rx="14" fill="url(#rg-mines-bg)" />
      {[0, 1, 2, 3, 4].map((row) =>
        [0, 1, 2, 3, 4].map((col) => {
          const x = 78 + col * 26;
          const y = 14 + row * 20;
          const isMine = (row === 1 && col === 2) || (row === 3 && col === 4) || (row === 2 && col === 0);
          const isGem = (row === 0 && col === 1) || (row === 2 && col === 3) || (row === 4 && col === 2);
          return (
            <rect
              key={`${row}-${col}`}
              x={x}
              y={y}
              width="20"
              height="16"
              rx="3"
              fill={isMine ? '#3a1c1c' : isGem ? 'url(#rg-gem)' : '#1a2228'}
              stroke={isMine ? '#c46a6a' : isGem ? '#7ed9c0' : 'rgba(233,228,216,0.1)'}
              strokeWidth="0.8"
            />
          );
        }),
      )}
      <path d="M48 40 L62 50 L56 70 H40 L34 50 Z" fill="url(#rg-gem)" opacity="0.9" />
      <circle cx="232" cy="55" r="12" fill="#2a1c1c" stroke="#c46a6a" strokeWidth="1.5" />
      <circle cx="232" cy="55" r="4" fill="#e8a0a0" />
      <text x="140" y="112" textAnchor="middle" fill="rgba(62,207,173,0.75)" fontSize="9" letterSpacing="3" fontFamily="sans-serif">
        MINES
      </text>
    </svg>
  );
}

function IlluCraps() {
  return (
    <svg className="rules-illu" viewBox="0 0 280 120" aria-hidden>
      <defs>
        <linearGradient id="rg-craps-felt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#164032" />
          <stop offset="100%" stopColor="#071810" />
        </linearGradient>
      </defs>
      <rect width="280" height="120" rx="14" fill="url(#rg-craps-felt)" />
      <rect x="24" y="20" width="232" height="72" rx="10" fill="none" stroke="rgba(194,161,95,0.35)" strokeDasharray="4 3" />
      {/* die 1 — 5 */}
      <g transform="translate(88,32)">
        <rect width="44" height="44" rx="8" fill="#f3eee2" />
        <circle cx="14" cy="14" r="4" fill="#2a2620" />
        <circle cx="30" cy="14" r="4" fill="#2a2620" />
        <circle cx="22" cy="22" r="4" fill="#2a2620" />
        <circle cx="14" cy="30" r="4" fill="#2a2620" />
        <circle cx="30" cy="30" r="4" fill="#2a2620" />
      </g>
      {/* die 2 — 2 */}
      <g transform="translate(148,38) rotate(8)">
        <rect width="44" height="44" rx="8" fill="#f3eee2" />
        <circle cx="14" cy="14" r="4" fill="#2a2620" />
        <circle cx="30" cy="30" r="4" fill="#2a2620" />
      </g>
      <circle cx="48" cy="56" r="16" fill="#c2a15f" stroke="#e8d7a8" strokeWidth="2" />
      <text x="48" y="60" textAnchor="middle" fill="#1a1208" fontSize="9" fontWeight="700" fontFamily="sans-serif">
        ON
      </text>
      <text x="140" y="112" textAnchor="middle" fill="rgba(194,161,95,0.75)" fontSize="9" letterSpacing="3" fontFamily="sans-serif">
        CRAPS · SCRAPS
      </text>
    </svg>
  );
}

function RuleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rules-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BlackjackRules() {
  const tableId = useGame((s) => s.tableId);
  const table = getTable(tableId);
  const r = table.rules;
  return (
    <>
      <IlluBlackjack />
      <p className="rules-lead">
        Approchez-vous de 21 sans dépasser. Le croupier joue après vous — jetons virtuels uniquement.
      </p>
      <section className="rules-section">
        <h3>Objectif &amp; paiements</h3>
        <div className="rules-grid">
          <RuleRow label="Blackjack naturel" value="3 : 2" />
          <RuleRow label="Main gagnante" value="1 : 1" />
          <RuleRow label="Égalité" value="Mise rendue" />
          <RuleRow label="Assurance" value="2 : 1" />
        </div>
      </section>
      <section className="rules-section">
        <h3>{table.name}</h3>
        <div className="rules-grid">
          <RuleRow label="Jeux dans le sabot" value={String(r.decks)} />
          <RuleRow
            label="Croupier soft 17"
            value={r.dealerHitsSoft17 ? 'Tire (H17)' : 'Reste (S17)'}
          />
          <RuleRow label="Double" value={r.doubleOn === 'any2' ? 'Sur 2 cartes' : '9–11'} />
          <RuleRow label="Double après split" value={r.doubleAfterSplit ? 'Oui' : 'Non'} />
          <RuleRow label="Splits max" value={`${r.maxSplitHands} mains`} />
          <RuleRow label="Re-split As" value={r.resplitAces ? 'Oui' : 'Non'} />
          <RuleRow label="Abandon tardif" value={r.lateSurrender ? 'Oui' : 'Non'} />
          <RuleRow label="Mise principale" value={`${fmt(r.minBet)} – ${fmt(r.maxBet)}`} />
        </div>
      </section>
      {r.sideBets.length > 0 && (
        <section className="rules-section">
          <h3>Side bets</h3>
          {r.sideBets.map((id) => {
            const def = SIDE_BET_DEFS[id];
            return (
              <div className="rules-side" key={id}>
                <div className="rules-side-head">
                  <strong>{def.name}</strong>
                  <span>{fmt(r.sideBetMin)} – {fmt(r.sideBetMax)}</span>
                </div>
                <p>{def.description}</p>
                <div className="rules-grid compact">
                  {def.paytable.map((row) => (
                    <RuleRow key={row.key} label={row.label} value={fmtPays(row.pays)} />
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}
      <p className="rules-foot">Cartes mélangées · hasard cryptographique · crédit partagé NOCTURNE</p>
    </>
  );
}

function MinesRules() {
  return (
    <>
      <IlluMines />
      <p className="rules-lead">
        Grille 5×5. Choisissez vos mines, révélez des diamants, encaissez avant la bombe.
      </p>
      <section className="rules-section">
        <h3>Déroulement</h3>
        <ol className="rules-steps">
          <li>
            <span className="n">1</span>
            <span>Réglez la mise et le nombre de mines (1–24), puis Jouer.</span>
          </li>
          <li>
            <span className="n">2</span>
            <span>Chaque diamant augmente le multiplicateur. Encaissez quand vous voulez.</span>
          </li>
          <li>
            <span className="n">3</span>
            <span>Une mine termine la manche — mise perdue. Tous les diamants = cashout auto.</span>
          </li>
        </ol>
      </section>
      <section className="rules-section">
        <h3>Paiement</h3>
        <div className="rules-grid">
          <RuleRow label="Gain" value="Mise × multiplicateur" />
          <RuleRow label="RTP cible" value="99 %" />
          <RuleRow label="Grille" value="5 × 5 · 25 cases" />
          <RuleRow label="Mines" value="1 à 24" />
        </div>
      </section>
      <div className="rules-callout mines">
        <strong>Plus de mines</strong>
        <span>Multiplicateurs plus hauts, risque plus fort — à vous de doser.</span>
      </div>
      <p className="rules-foot">Placement Fisher–Yates · crypto.getRandomValues · crédit partagé</p>
    </>
  );
}

function IlluCrash() {
  return (
    <svg className="rules-illu" viewBox="0 0 280 120" aria-hidden>
      <defs>
        <linearGradient id="rg-crash-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#14110e" />
          <stop offset="100%" stopColor="#0a0b0e" />
        </linearGradient>
        <linearGradient id="rg-crash-line" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#5d584e" />
          <stop offset="100%" stopColor="#c2a15f" />
        </linearGradient>
      </defs>
      <rect width="280" height="120" rx="14" fill="url(#rg-crash-bg)" />
      <path
        d="M24 96 C 70 94, 90 80, 120 58 S 190 22, 230 18"
        fill="none"
        stroke="url(#rg-crash-line)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M218 22 L248 12 L252 16 L232 24 L248 28 L244 30 L222 24 Z" fill="#c2a15f" />
      <text x="140" y="112" textAnchor="middle" fill="rgba(194,161,95,0.75)" fontSize="9" letterSpacing="3" fontFamily="sans-serif">
        CRASH
      </text>
    </svg>
  );
}

function CrashRules() {
  return (
    <>
      <IlluCrash />
      <p className="rules-lead">
        Un multiplicateur part de 1,00× et grimpe. Encaissez avant que l’avion ne crash — sinon la mise est perdue.
      </p>
      <section className="rules-section">
        <h3>Déroulement</h3>
        <ol className="rules-steps">
          <li>
            <span className="n">1</span>
            <span>Choisissez votre mise (et optionnellement un encaissement auto), puis Décoller.</span>
          </li>
          <li>
            <span className="n">2</span>
            <span>Le multiplicateur monte en temps réel. Cliquez Encaisser quand vous voulez.</span>
          </li>
          <li>
            <span className="n">3</span>
            <span>Si l’avion crash avant votre encaissement, vous perdez. Gain = mise × multiplicateur.</span>
          </li>
        </ol>
      </section>
      <section className="rules-section">
        <h3>Équité du tirage</h3>
        <div className="rules-grid">
          <RuleRow label="RTP" value="99 %" />
          <RuleRow label="Instant crash ~1 %" value="1,00×" />
          <RuleRow label="Formule" value="(2³²/(h+1)) × 0,99" />
          <RuleRow label="Max théorique" value="1 000 000×" />
        </div>
      </section>
      <div className="rules-callout">
        <strong>Encaissement auto</strong>
        <span>Définissez un seuil (ex. 2×) pour encaisser automatiquement dès qu’il est atteint.</span>
      </div>
      <p className="rules-foot">Point de crash tiré au décollage · crypto.getRandomValues · crédit partagé</p>
    </>
  );
}

function CrapsRules() {
  return (
    <>
      <IlluCraps />
      <p className="rules-lead">
        Scraps — vous lancez toujours. Commencez par Pass Line : 7 ou 11 = vous gagnez tout de suite.
        Sinon un « point » est fixé, et vous devez le refaire avant un 7.
      </p>
      <section className="rules-section">
        <h3>En 3 étapes</h3>
        <ol className="rules-steps">
          <li>
            <span className="n">1</span>
            <span>
              <strong>Mise</strong> — posez un jeton sur Pass Line (le plus simple). Don’t Pass = l’inverse. Field = un seul lancer.
            </span>
          </li>
          <li>
            <span className="n">2</span>
            <span>
              <strong>Come-out</strong> — 7/11 Pass gagne · 2/3/12 Pass perd · autre total = point établi.
            </span>
          </li>
          <li>
            <span className="n">3</span>
            <span>
              <strong>Point</strong> — refaites le point avant un 7. Odds = cotes vraies derrière Pass.
            </span>
          </li>
        </ol>
      </section>
      <section className="rules-section">
        <h3>Paris</h3>
        <div className="rules-grid">
          <RuleRow label="Pass Line" value="7/11 win · 2/3/12 lose · 1:1" />
          <RuleRow label="Don’t Pass" value="2/3 win · 7/11 lose · 12 push" />
          <RuleRow label="Field" value="1:1 · 2→2:1 · 12→3:1" />
          <RuleRow label="Odds (Pass)" value="Cotes vraies · 0 % HE" />
        </div>
      </section>
      <section className="rules-section">
        <h3>Odds max (table 3-4-5×)</h3>
        <div className="rules-grid">
          <RuleRow label="Point 4 ou 10" value="3× · paie 2:1" />
          <RuleRow label="Point 5 ou 9" value="4× · paie 3:2" />
          <RuleRow label="Point 6 ou 8" value="5× · paie 6:5" />
        </div>
      </section>
      <p className="rules-foot">Deux dés · crypto.getRandomValues · crédit partagé NOCTURNE</p>
    </>
  );
}

const META: Record<RulesGame, { eyebrow: string; title: string }> = {
  blackjack: { eyebrow: 'Table · guide de salle', title: 'Blackjack' },
  mines: { eyebrow: 'Salon des jeux · guide', title: 'Mines' },
  craps: { eyebrow: 'Salon des jeux · Scraps', title: 'Craps' },
  crash: { eyebrow: 'Salon des jeux · Crash', title: 'Crash' },
};

export function RulesGuide({
  game,
  open,
  onClose,
}: {
  game: RulesGame;
  open: boolean;
  onClose: () => void;
}) {
  const meta = META[game];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="rules-guide-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rules-guide-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onClick={onClose}
        >
          <motion.div
            className={`rules-guide-panel tone-${game}`}
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="rules-guide-head">
              <div>
                <span className="mono">{meta.eyebrow}</span>
                <h2 id="rules-guide-title">{meta.title}</h2>
              </div>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
                ✕
              </button>
            </header>
            <div className="rules-guide-body">
              {game === 'blackjack' && <BlackjackRules />}
              {game === 'mines' && <MinesRules />}
              {game === 'craps' && <CrapsRules />}
              {game === 'crash' && <CrashRules />}
            </div>
            <footer className="rules-guide-foot">
              <button type="button" className="btn primary" onClick={onClose}>
                Compris
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
