import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import {
  allLobbyTables,
  canSitAtTable,
  isTableUnlocked,
  PRIVATE_BOUNDS,
  PRIVATE_TABLE_ID,
  type PrivateLimits,
  type TableConfig,
} from '../engine/rules';
import { fmt } from '../lib/format';
import { useGame } from '../store/gameStore';
import { CirclePanel } from './CirclePanel';

export function Lobby() {
  const balance = useGame((s) => s.balance);
  const peakBalance = useGame((s) => s.peakBalance);
  const privateLimits = useGame((s) => s.privateLimits);
  const enterTable = useGame((s) => s.enterTable);
  const configurePrivateLimits = useGame((s) => s.configurePrivateLimits);
  const resetAll = useGame((s) => s.resetAll);
  const refill = useGame((s) => s.refill);
  const notice = useGame((s) => s.notice);
  const dismissNotice = useGame((s) => s.dismissNotice);

  const [showPrivateSetup, setShowPrivateSetup] = useState(false);
  const [draftLimits, setDraftLimits] = useState<PrivateLimits>(privateLimits);

  const tables = useMemo(() => allLobbyTables(privateLimits), [privateLimits]);
  const broke = balance < tables[0].rules.minBet;

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
          Quatre tables de blackjack, un sabot honnête, des jetons sans valeur.
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
        <span className="peak">Pic {fmt(peakBalance)}</span>
        {broke && (
          <button className="btn primary" onClick={refill} style={{ marginLeft: 10 }}>
            Reconstituer
          </button>
        )}
      </motion.div>

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
              className={`table-card ${locked ? 'locked' : ''} ${!canSit && unlocked ? 'too-poor' : ''}`}
              data-felt={t.felt}
              disabled={locked}
              onClick={() => onEnter(t)}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + i * 0.1, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="felt-preview" />
              <div className="body">
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

      {showPrivateSetup && (
        <div className="private-modal" role="dialog" aria-modal="true">
          <div className="private-panel">
            <h3>Table Privée</h3>
            <p>Choisis tes limites — bornées, pour garder un vrai salon VIP.</p>
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

      <CirclePanel />

      <div className="lobby-foot">
        <p>
          Jeu fictif : jetons virtuels uniquement, sans argent réel, dépôt ni retrait.
          Les tables se débloquent avec ton pic de crédit — tu peux toujours redescendre.
        </p>
        <button
          className="btn ghost"
          style={{ marginTop: 12 }}
          onClick={() => {
            if (confirm('Effacer la sauvegarde (solde, historique, statistiques) ?')) resetAll();
          }}
        >
          Réinitialiser la partie
        </button>
      </div>
    </div>
  );
}
