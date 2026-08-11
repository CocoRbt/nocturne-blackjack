import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { getTable } from '../engine/rules';
import { SIDE_BET_DEFS } from '../engine/sidebets';
import { fmt, fmtPays } from '../lib/format';
import { useGame } from '../store/gameStore';

export type RulesGame = 'blackjack' | 'mines' | 'craps' | 'crash' | 'plinko' | 'slots';

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

function IlluPlinko() {
  return (
    <svg className="rules-illu" viewBox="0 0 280 120" aria-hidden>
      <defs>
        <linearGradient id="rg-plinko-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#16120e" />
          <stop offset="100%" stopColor="#0a0b0e" />
        </linearGradient>
      </defs>
      <rect width="280" height="120" rx="14" fill="url(#rg-plinko-bg)" />
      {[0, 1, 2, 3, 4].map((row) =>
        Array.from({ length: row + 3 }, (_, col) => {
          const count = row + 3;
          const x = 140 - ((count - 1) * 14) / 2 + col * 14;
          const y = 18 + row * 14;
          return <circle key={`${row}-${col}`} cx={x} cy={y} r="2.4" fill="rgba(212,160,90,0.75)" />;
        }),
      )}
      <circle cx="148" cy="28" r="5" fill="#f0d6a8" stroke="#c2a15f" strokeWidth="1" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const x = 68 + i * 24;
        const hot = i === 0 || i === 6;
        return (
          <rect
            key={i}
            x={x}
            y={96}
            width="20"
            height="12"
            rx="3"
            fill={hot ? 'rgba(212,160,90,0.35)' : 'rgba(233,228,216,0.08)'}
            stroke={hot ? 'rgba(212,160,90,0.7)' : 'rgba(233,228,216,0.2)'}
          />
        );
      })}
      <text x="140" y="114" textAnchor="middle" fill="rgba(212,160,90,0.8)" fontSize="9" letterSpacing="3" fontFamily="sans-serif">
        PLINKO
      </text>
    </svg>
  );
}

function PlinkoRules() {
  return (
    <>
      <IlluPlinko />
      <p className="rules-lead">
        Une bille tombe dans une pyramide de picots. À chaque rangée elle part à gauche ou à droite
        (50/50). Le slot d’arrivée fixe le multiplicateur.
      </p>
      <section className="rules-section">
        <h3>Déroulement</h3>
        <ol className="rules-steps">
          <li>
            <span className="n">1</span>
            <span>
              Choisissez la mise, le nombre de lignes (8 / 12 / 16) et le risque (Faible / Moyen /
              Élevé).
            </span>
          </li>
          <li>
            <span className="n">2</span>
            <span>
              Drop — spampez le bouton : plusieurs billes peuvent chuter en même temps (jusqu’à 24).
            </span>
          </li>
          <li>
            <span className="n">3</span>
            <span>Gain = mise × multiplicateur du bucket. Les bords paient plus, le centre plus souvent.</span>
          </li>
        </ol>
      </section>
      <section className="rules-section">
        <h3>Équité</h3>
        <div className="rules-grid">
          <RuleRow label="RTP cible" value="~99 %" />
          <RuleRow label="Chemin" value="Binôme · 50/50 par rangée" />
          <RuleRow label="Risque" value="Change les mults, pas les proba" />
          <RuleRow label="Max (16 · Élevé)" value="1 000×" />
        </div>
      </section>
      <div className="rules-callout">
        <strong>Pas de trucage d’animation</strong>
        <span>Le chemin est tiré d’abord ; l’animation suit ce chemin — pas l’inverse.</span>
      </div>
      <p className="rules-foot">Distribution binomiale · crypto.getRandomValues · crédit partagé</p>
    </>
  );
}

function IlluSlots() {
  return (
    <svg className="rules-illu" viewBox="0 0 280 120" aria-hidden>
      <defs>
        <linearGradient id="rg-slots-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5a2a12" />
          <stop offset="60%" stopColor="#22120b" />
          <stop offset="100%" stopColor="#0d0705" />
        </linearGradient>
        <linearGradient id="rg-slots-sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6c86a" />
          <stop offset="100%" stopColor="#c8511c" />
        </linearGradient>
      </defs>
      <rect width="280" height="120" rx="14" fill="url(#rg-slots-sky)" />
      <circle cx="140" cy="52" r="30" fill="url(#rg-slots-sun)" opacity="0.5" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect
          key={i}
          x={30 + i * 45}
          y={18}
          width="38"
          height="76"
          rx="6"
          fill="rgba(12,7,4,0.7)"
          stroke="rgba(233,163,61,0.4)"
        />
      ))}
      {/* bison stylisé sur le rouleau central */}
      <path
        d="M126 52 q14 -11 28 0 l3 13 q-6 15 -17 16 q-11 -1 -17 -16 z"
        fill="#e9a33d"
      />
      <path d="M126 52 q-11 -5 -11 5 q0 6 8 6" fill="none" stroke="#f6c86a" strokeWidth="3" />
      <path d="M154 52 q11 -5 11 5 q0 6 -8 6" fill="none" stroke="#f6c86a" strokeWidth="3" />
      <text
        x="140"
        y="113"
        textAnchor="middle"
        fill="rgba(246,200,106,0.8)"
        fontSize="9"
        letterSpacing="3"
        fontFamily="sans-serif"
      >
        STAMPEDE
      </text>
    </svg>
  );
}

function SlotsRules() {
  return (
    <>
      <IlluSlots />
      <p className="rules-lead">
        Cinq rouleaux, quatre rangs, <strong>1024 façons</strong> de gagner. Pas de lignes : trois
        symboles identiques sur des rouleaux voisins à partir de la gauche, où qu’ils soient.
      </p>
      <section className="rules-section">
        <h3>Déroulement</h3>
        <ol className="rules-steps">
          <li>
            <span className="n">1</span>
            <span>Réglez la mise, puis lancez la ruée. Une mise = un spin.</span>
          </li>
          <li>
            <span className="n">2</span>
            <span>
              Le <strong>Crépuscule</strong> (wild) remplace tout sauf la Médaille. Le bison paie le
              plus fort.
            </span>
          </li>
          <li>
            <span className="n">3</span>
            <span>
              3 Médailles ou plus n’importe où déclenchent les tours gratuits — aucune mise n’est
              prélevée pendant le bonus.
            </span>
          </li>
        </ol>
      </section>
      <section className="rules-section">
        <h3>Tours gratuits</h3>
        <div className="rules-grid">
          <RuleRow label="3 Médailles" value="8 tours" />
          <RuleRow label="4 Médailles" value="15 tours" />
          <RuleRow label="5 Médailles" value="20 tours" />
          <RuleRow label="Relance (2+)" value="+5 tours" />
          <RuleRow label="Wilds bonus" value="×2 / ×3 (produit)" />
          <RuleRow label="Compteur Troupeau" value="Jusqu’à ×3 sur les gains" />
        </div>
      </section>
      <section className="rules-section">
        <h3>Paiements</h3>
        <div className="rules-grid">
          <RuleRow label="Grille" value="5 × 4 · 1024 ways" />
          <RuleRow label="Symbole fort" value="Bison" />
          <RuleRow label="Médaille (3 / 4 / 5)" value="×1,2 / ×5 / ×20" />
          <RuleRow label="RTP cible" value="~96–97 %" />
        </div>
      </section>
      <div className="rules-callout">
        <strong>Compteur Troupeau</strong>
        <span>
          Chaque bison tombé pendant le bonus remplit la harde : à 4, 7, 13 puis 15 têtes, les gains
          sont multipliés et les autres animaux prennent les traits du bison.
        </span>
      </div>
      <p className="rules-foot">
        Bandes de rouleaux fixes · crypto.getRandomValues · jetons virtuels · crédit partagé
      </p>
    </>
  );
}

function CrapsRules() {
  return (
    <>
      <IlluCraps />
      <p className="rules-lead">
        Street Craps façon casual : une mise, deux dés. Au premier jet ça paie ×2. Si on fixe une cible,
        ça passe à ×4 — et les chiffres gagnants / perdants changent sous tes yeux.
      </p>
      <section className="rules-section">
        <h3>En 3 étapes</h3>
        <ol className="rules-steps">
          <li>
            <span className="n">1</span>
            <span>
              <strong>Mise</strong> — pose un jeton, puis lance.
            </span>
          </li>
          <li>
            <span className="n">2</span>
            <span>
              <strong>Premier jet (×2)</strong> — 7 ou 11 = gagné · 2, 3 ou 12 = perdu · autre = on fixe une cible.
            </span>
          </li>
          <li>
            <span className="n">3</span>
            <span>
              <strong>Cible (×4)</strong> — refais ce chiffre avant un 7. Après 3 jets sans résultat, on te rend ta mise.
            </span>
          </li>
        </ol>
      </section>
      <section className="rules-section">
        <h3>Les chiffres changent</h3>
        <div className="rules-grid">
          <RuleRow label="Avant la cible" value="Gagne 7 / 11 · Perd 2 / 3 / 12 · ×2" />
          <RuleRow label="Avec une cible" value="Gagne la cible · Perd 7 · ×4" />
          <RuleRow label="3 jets neutres" value="Mise remboursée" />
          <RuleRow label="Cibles possibles" value="4, 5, 6, 8, 9 ou 10" />
        </div>
      </section>
      <p className="rules-foot">Deux dés · jetons virtuels · crédit partagé NOCTURNE</p>
    </>
  );
}

const META: Record<RulesGame, { eyebrow: string; title: string }> = {
  blackjack: { eyebrow: 'Table · guide de salle', title: 'Blackjack' },
  mines: { eyebrow: 'Salon des jeux · guide', title: 'Mines' },
  craps: { eyebrow: 'Salon des jeux · guide', title: 'Craps' },
  crash: { eyebrow: 'Salon des jeux · Crash', title: 'Crash' },
  plinko: { eyebrow: 'Salon des jeux · Plinko', title: 'Plinko' },
  slots: { eyebrow: 'Salon des jeux · Ruée dorée', title: 'Stampede' },
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
              {game === 'plinko' && <PlinkoRules />}
              {game === 'slots' && <SlotsRules />}
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
