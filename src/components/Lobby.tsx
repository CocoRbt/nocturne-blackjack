import { motion } from 'framer-motion';
import { TABLES } from '../engine/rules';
import { fmt } from '../lib/format';
import { useGame } from '../store/gameStore';

export function Lobby() {
  const balance = useGame((s) => s.balance);
  const enterTable = useGame((s) => s.enterTable);
  const resetAll = useGame((s) => s.resetAll);
  const refill = useGame((s) => s.refill);

  const broke = balance < TABLES[0].rules.minBet;

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
          Trois tables de blackjack, un sabot honnête, des jetons sans valeur.
          Ici, on ne joue que pour l&rsquo;élégance du geste.
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
        {broke && (
          <button className="btn primary" onClick={refill} style={{ marginLeft: 10 }}>
            Reconstituer
          </button>
        )}
      </motion.div>

      <div className="lobby-tables">
        {TABLES.map((t, i) => (
          <motion.button
            key={t.id}
            className="table-card"
            data-felt={t.felt}
            onClick={() => enterTable(t.id)}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + i * 0.12, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
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
                <span>BJ 3:2</span>
                <span>{t.rules.dealerHitsSoft17 ? 'H17' : 'S17'}</span>
                {t.rules.lateSurrender && <span>Abandon</span>}
                {t.rules.resplitAces && <span>Re-split As</span>}
              </div>
              <div className="enter">Prendre place →</div>
            </div>
          </motion.button>
        ))}
      </div>

      <div className="lobby-foot">
        <p>
          Jeu fictif : jetons virtuels uniquement, sans argent réel, dépôt ni retrait.
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
