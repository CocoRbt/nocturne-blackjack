import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import {
  allLobbyTables,
  canSitAtTable,
  isTableUnlocked,
  PRIVATE_BOUNDS,
  PRIVATE_TABLE_ID,
  type PrivateLimits,
  type TableConfig,
} from '../engine/rules';
import { completedCount } from '../defis/store';
import { fmt } from '../lib/format';
import { STARTING_BALANCE } from '../store/persistence';
import { useGame } from '../store/gameStore';
import { formatGamesBeforePeak } from '../store/peakMeta';
import { CircleDrawer } from './CircleDrawer';
import { circleJoinedLabel, useCircleKeepalive } from './CirclePanel';
import { useDefiSync } from './DailyChallenges';
import { exitCircle } from '../cercle/circleStore';

export function Lobby() {
  const balance = useGame((s) => s.balance);
  const peakBalance = useGame((s) => s.peakBalance);
  const gamesBeforePeak = useGame((s) => s.gamesBeforePeak);
  const privateLimits = useGame((s) => s.privateLimits);
  const enterTable = useGame((s) => s.enterTable);
  const enterMines = useGame((s) => s.enterMines);
  const enterCraps = useGame((s) => s.enterCraps);
  const enterCrash = useGame((s) => s.enterCrash);
  const configurePrivateLimits = useGame((s) => s.configurePrivateLimits);
  const resetAll = useGame((s) => s.resetAll);
  const refill = useGame((s) => s.refill);
  const notice = useGame((s) => s.notice);
  const dismissNotice = useGame((s) => s.dismissNotice);

  const [showPrivateSetup, setShowPrivateSetup] = useState(false);
  const [draftLimits, setDraftLimits] = useState<PrivateLimits>(privateLimits);
  const [circleOpen, setCircleOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [joinedAs, setJoinedAs] = useState(() => circleJoinedLabel());

  useCircleKeepalive();
  useDefiSync();

  useEffect(() => {
    if (!circleOpen) setJoinedAs(circleJoinedLabel());
  }, [circleOpen]);

  const tables = useMemo(() => allLobbyTables(privateLimits), [privateLimits]);
  const broke = balance < tables[0].rules.minBet;
  const firstRun = peakBalance <= STARTING_BALANCE && balance <= STARTING_BALANCE * 2;
  const handsPlayed = useGame((s) => s.stats.handsPlayed);
  const wins = useGame((s) => s.stats.wins);
  const blackjacks = useGame((s) => s.stats.blackjacks);
  const defis = completedCount({ handsPlayed, wins, blackjacks, balance });

  const onEnter = (t: TableConfig) => {
    if (t.id === PRIVATE_TABLE_ID) {
      if (!isTableUnlocked(PRIVATE_TABLE_ID, peakBalance)) return;
      setDraftLimits(privateLimits);
      setShowPrivateSetup(true);
      return;
    }
    enterTable(t.id);
  };

  const confirmPrivate = () => {
    configurePrivateLimits(draftLimits);
    setShowPrivateSetup(false);
    enterTable(PRIVATE_TABLE_ID);
  };

  return (
    <div className="lobby grain">
      <div className="lobby-menu">
        <button
          type="button"
          className={`lobby-menu-btn ${joinedAs ? 'has-circle' : ''}`}
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="lobby-menu-icon" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          <span className="lobby-menu-text">Menu</span>
        </button>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              className="lobby-menu-panel"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
            >
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setCircleOpen(true);
                }}
              >
                Cercle d&rsquo;amis
                {joinedAs ? <span className="dim">{joinedAs}</span> : null}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  enterMines();
                }}
              >
                Mines
                <span className="dim">diamants · bombes</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  enterCraps();
                }}
              >
                Craps
                <span className="dim">Scraps · dés</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  enterCrash();
                }}
              >
                Crash
                <span className="dim">avion · multiplicateur</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <motion.div
        className="lobby-brand"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mono">Cercle privé · depuis minuit</div>
        <h1>
          NOC<span>T</span>URNE
        </h1>
        <p>
          Blackjack, Mines, Craps &amp; Crash — jetons sans valeur, crédit partagé.
          On commence au Salon — les portes s&rsquo;ouvrent avec le crédit.
        </p>
      </motion.div>

      <motion.div
        className="lobby-balance"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.7 }}
      >
        <span className="label">Votre crédit</span>
        <span className="value">{fmt(balance)}</span>
        <span className="peak">
          Pic {fmt(peakBalance)}
          <span className="peak-meta"> · {formatGamesBeforePeak(gamesBeforePeak)}</span>
        </span>
        <p className="lobby-peak-hint">
          Le pic est votre record — il ouvre les tables plus hautes. Vous pouvez toujours redescendre.
        </p>
        {broke && (
          <button className="btn primary" onClick={refill} style={{ marginLeft: 10 }}>
            Reconstituer
          </button>
        )}
      </motion.div>

      <div className="lobby-quick-actions">
        <button
          type="button"
          className={`lobby-defis-pill ${defis.done === defis.total ? 'done' : ''}`}
          onClick={() => setCircleOpen(true)}
        >
          Défis {defis.done}/{defis.total}
          <span className="dim"> · cercle &amp; classement</span>
        </button>
      </div>

      {notice && (
        <div className="lobby-notice" role="status">
          <span>{notice}</span>
          <button className="btn ghost" onClick={dismissNotice}>
            OK
          </button>
        </div>
      )}

      <div className="lobby-tables">
        {tables.map((t, i) => {
          const unlocked = isTableUnlocked(t.id, peakBalance);
          const canSit = canSitAtTable(t.id, balance, peakBalance, privateLimits);
          const locked = !unlocked;
          return (
            <motion.button
              key={t.id}
              className={`table-card ${locked ? 'locked' : ''} ${!canSit && unlocked ? 'too-poor' : ''} ${
                firstRun && t.id === 'emeraude' && unlocked ? 'first-run' : ''
              } ${firstRun && t.id !== 'emeraude' ? 'first-run-dim' : ''}`}
              data-felt={t.felt}
              disabled={locked}
              onClick={() => onEnter(t)}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + i * 0.1, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="felt-preview" />
              <div className="body">
                {firstRun && t.id === 'emeraude' && unlocked && (
                  <span className="start-here">Commencez ici</span>
                )}
                <h2>{t.name}</h2>
                <p className="tagline">{t.tagline}</p>
                <p className="table-motto-card">{t.identity.motto}</p>
                <div className="limits">
                  <span>
                    Mise {fmt(t.rules.minBet)} – {fmt(t.rules.maxBet)}
                  </span>
                  {locked ? (
                    <span className="lock-pill">🔒 {fmt(t.unlockPeak)}</span>
                  ) : !canSit ? (
                    <span className="lock-pill">Min {fmt(t.rules.minBet)}</span>
                  ) : (
                    <span>Ouverte</span>
                  )}
                </div>
                <div className="enter">
                  {locked
                    ? `Débloquer à ${fmt(t.unlockPeak)} →`
                    : !canSit
                      ? 'Crédit trop bas'
                      : t.id === PRIVATE_TABLE_ID
                        ? 'Configurer →'
                        : 'Prendre place →'}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      <section className="lobby-games">
        <h2 className="lobby-games-title">Salon des jeux</h2>
        <div className="lobby-games-grid">
          <motion.button
            type="button"
            className="mines-card"
            onClick={enterMines}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mines-card-visual" aria-hidden>
              <span className="mines-card-gem" />
              <span className="mines-card-gem" />
              <span className="mines-card-mine" />
            </div>
            <div className="mines-card-body">
              <h3>Mines</h3>
              <p>Grille 5×5 · choisissez vos bombes · diamants &amp; multiplicateur · encaisser quand vous voulez.</p>
              <span className="enter">Entrer dans le salon →</span>
            </div>
          </motion.button>
          <motion.button
            type="button"
            className="craps-card"
            onClick={enterCraps}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="craps-card-visual" aria-hidden>
              <span className="craps-card-die" data-pips="5" />
              <span className="craps-card-die" data-pips="2" />
            </div>
            <div className="craps-card-body">
              <h3>Craps</h3>
              <p>Scraps · Pass Line · Don’t Pass · Field · Odds 3-4-5× · come-out &amp; point.</p>
              <span className="enter">Entrer dans le salon →</span>
            </div>
          </motion.button>
          <motion.button
            type="button"
            className="crash-card"
            onClick={enterCrash}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.75, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="crash-card-visual" aria-hidden>
              <span className="crash-card-curve" />
              <span className="crash-card-plane" />
            </div>
            <div className="crash-card-body">
              <h3>Crash</h3>
              <p>Avion · multiplicateur qui monte · encaisse avant le crash · RTP 99&nbsp;%.</p>
              <span className="enter">Entrer dans le salon →</span>
            </div>
          </motion.button>
        </div>
      </section>

      {showPrivateSetup && (
        <div className="private-modal" role="dialog" aria-modal="true">
          <div className="private-panel">
            <h3>Table Privée</h3>
            <p>Choisissez vos limites — bornées, pour garder un vrai salon VIP.</p>
            <label>
              Mise minimale
              <select
                value={draftLimits.minBet}
                onChange={(e) =>
                  setDraftLimits((d) => ({
                    ...d,
                    minBet: Number(e.target.value),
                    maxBet: Math.max(d.maxBet, Number(e.target.value) * 10),
                  }))
                }
              >
                {PRIVATE_BOUNDS.minBetChoices.map((v) => (
                  <option key={v} value={v}>
                    {fmt(v)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mise maximale
              <select
                value={draftLimits.maxBet}
                onChange={(e) =>
                  setDraftLimits((d) => ({
                    ...d,
                    maxBet: Math.max(Number(e.target.value), d.minBet * 10),
                  }))
                }
              >
                {PRIVATE_BOUNDS.maxBetChoices
                  .filter((v) => v >= draftLimits.minBet * 10)
                  .map((v) => (
                    <option key={v} value={v}>
                      {fmt(v)}
                    </option>
                  ))}
              </select>
            </label>
            <div className="private-actions">
              <button className="btn ghost" onClick={() => setShowPrivateSetup(false)}>
                Annuler
              </button>
              <button className="btn primary" onClick={confirmPrivate}>
                Entrer
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="lobby-foot">
        <p>
          Jeu fictif : jetons virtuels uniquement, sans argent réel, dépôt ni retrait.
          Les tables se débloquent avec votre pic de crédit — vous pouvez toujours redescendre.
        </p>
        <button
          className="btn ghost"
          style={{ marginTop: 12 }}
          onClick={() => {
            if (
              confirm(
                'Effacer la sauvegarde (solde, historique, statistiques) et quitter le cercle d’amis ?',
              )
            ) {
              void exitCircle().finally(() => {
                resetAll();
                setJoinedAs(null);
                setCircleOpen(false);
              });
            }
          }}
        >
          Réinitialiser la partie
        </button>
      </div>

      <CircleDrawer open={circleOpen} onClose={() => setCircleOpen(false)} />
    </div>
  );
}
