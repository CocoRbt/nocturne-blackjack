import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { getTable } from '../engine/rules';
import { SIDE_BET_DEFS } from '../engine/sidebets';
import { SIDE_BET_IDS } from '../engine/types';
import { fmt, fmtNet, fmtPays } from '../lib/format';
import type { HistoryEntry } from '../store/persistence';
import { useGame } from '../store/gameStore';

const OUTCOME_SHORT: Record<string, string> = {
  blackjack: 'Blackjack',
  win: 'Gagné',
  push: 'Égalité',
  lose: 'Perdu',
  surrender: 'Abandon',
  evenMoney: 'Even money',
};

function prettyCards(cards: string[]) {
  return cards.map((c, i) => (
    <span key={i} className={c.includes('♥') || c.includes('♦') ? 'red' : ''}>
      {c}{i < cards.length - 1 ? ' ' : ''}
    </span>
  ));
}

function RoundItem({ e }: { e: HistoryEntry }) {
  return (
    <div className="round-item">
      <div className="top">
        <span style={{ color: 'var(--ink-dim)' }}>
          {new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} ·{' '}
          {(() => {
            try {
              return getTable(e.tableId).name;
            } catch {
              return e.tableId;
            }
          })()}
        </span>
        <span className={`net ${e.net > 0 ? 'pos' : e.net < 0 ? 'neg' : ''}`}>{fmtNet(e.net)}</span>
      </div>
      {e.hands.map((h, i) => (
        <div className="line" key={i}>
          <span className="cards">
            {h.seatIndex !== undefined && `P${h.seatIndex + 1} · `}
            {prettyCards(h.cards)} ({h.total})
          </span>
          <span>
            {OUTCOME_SHORT[h.outcome]} {fmtNet(h.net)}
          </span>
        </div>
      ))}
      <div className="line">
        <span className="cards">Croupier : {prettyCards(e.dealerCards)} ({e.dealerBust ? 'sauté' : e.dealerTotal})</span>
        <span>Solde {fmt(e.balanceAfter)}</span>
      </div>
      {e.sideBets.map((b) => (
        <div className="line" key={`${b.seatIndex ?? 'x'}-${b.id}`}>
          <span>
            {b.seatIndex !== undefined && `P${b.seatIndex + 1} · `}
            {SIDE_BET_DEFS[b.id].shortName}{b.label ? ` — ${b.label}` : ''}
          </span>
          <span>{fmtNet(b.net)}</span>
        </div>
      ))}
      {e.insuranceNet !== null && (
        <div className="line">
          <span>Assurance</span>
          <span>{fmtNet(e.insuranceNet)}</span>
        </div>
      )}
    </div>
  );
}

function StatsView() {
  const stats = useGame((s) => s.stats);
  const session = useGame((s) => s.session);
  const tableId = useGame((s) => s.tableId);
  const enabledSideBets = new Set(getTable(tableId).rules.sideBets);
  const winRate =
    stats.wins + stats.losses > 0
      ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100)
      : 0;
  return (
    <>
      {session && (
        <div className="paytable-block">
          <h3>Cette session</h3>
          <div className="stat-grid">
            <div className="stat-cell">
              <div className="k">Net session</div>
              <div className={`v ${session.net > 0 ? 'pos' : session.net < 0 ? 'neg' : ''}`}>
                {fmtNet(session.net)}
              </div>
            </div>
            <div className="stat-cell">
              <div className="k">Manches</div>
              <div className="v">{session.hands}</div>
            </div>
            <div className="stat-cell">
              <div className="k">Série</div>
              <div className="v">{session.currentStreak}</div>
            </div>
            <div className="stat-cell">
              <div className="k">Meilleure série</div>
              <div className="v">{session.bestStreakThisSession}</div>
            </div>
          </div>
        </div>
      )}
      <div className="stat-grid">
        <div className="stat-cell">
          <div className="k">Manches</div>
          <div className="v">{stats.rounds}</div>
        </div>
        <div className="stat-cell">
          <div className="k">Bilan net</div>
          <div className={`v ${stats.netTotal > 0 ? 'pos' : stats.netTotal < 0 ? 'neg' : ''}`}>
            {fmtNet(stats.netTotal)}
          </div>
        </div>
        <div className="stat-cell">
          <div className="k">Mains gagnées</div>
          <div className="v">
            {stats.wins} <span style={{ fontSize: 13, color: 'var(--ink-dim)' }}>({winRate}%)</span>
          </div>
        </div>
        <div className="stat-cell">
          <div className="k">Mains perdues</div>
          <div className="v">{stats.losses}</div>
        </div>
        <div className="stat-cell">
          <div className="k">Blackjacks</div>
          <div className="v">{stats.blackjacks}</div>
        </div>
        <div className="stat-cell">
          <div className="k">Égalités</div>
          <div className="v">{stats.pushes}</div>
        </div>
        <div className="stat-cell">
          <div className="k">Doubles / Splits</div>
          <div className="v">
            {stats.doubles} / {stats.splits}
          </div>
        </div>
        <div className="stat-cell">
          <div className="k">Abandons</div>
          <div className="v">{stats.surrenders}</div>
        </div>
        <div className="stat-cell">
          <div className="k">Plus gros gain</div>
          <div className="v pos">{stats.biggestWin > 0 ? fmtNet(stats.biggestWin) : '—'}</div>
        </div>
        <div className="stat-cell">
          <div className="k">Meilleure série</div>
          <div className="v">{stats.longestWinStreak}</div>
        </div>
        <div className="stat-cell">
          <div className="k">Total misé</div>
          <div className="v">{fmt(stats.totalWagered)}</div>
        </div>
        <div className="stat-cell">
          <div className="k">Assurances (prises / gagnées)</div>
          <div className="v">
            {stats.insuranceTaken} / {stats.insuranceWon}
          </div>
        </div>
      </div>

      <div className="paytable-block">
        <h3>Side bets</h3>
        <table>
          <tbody>
            {SIDE_BET_IDS.filter((id) => enabledSideBets.has(id)).map((id) => {
              const st = stats.sideBets[id];
              return (
                <tr key={id}>
                  <td>{SIDE_BET_DEFS[id].name}</td>
                  <td>
                    {st.placed} joué{st.placed > 1 ? 's' : ''} · {st.won} gagné{st.won > 1 ? 's' : ''}
                  </td>
                  <td>{fmtNet(st.net)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PaytablesView() {
  const tableId = useGame((s) => s.tableId);
  const table = getTable(tableId);
  const r = table.rules;
  return (
    <>
      <div className="paytable-block">
        <h3>{table.name} — règles</h3>
        <table>
          <tbody>
            <tr><td>Jeux dans le sabot</td><td>{r.decks}</td></tr>
            <tr><td>Blackjack</td><td>3:2</td></tr>
            <tr><td>Croupier sur soft 17</td><td>{r.dealerHitsSoft17 ? 'tire (H17)' : 'reste (S17)'}</td></tr>
            <tr><td>Double</td><td>{r.doubleOn === 'any2' ? 'sur 2 cartes' : '9–11'}</td></tr>
            <tr><td>Double après split</td><td>{r.doubleAfterSplit ? 'oui' : 'non'}</td></tr>
            <tr><td>Splits maximum</td><td>{r.maxSplitHands} mains</td></tr>
            <tr><td>Re-split des As</td><td>{r.resplitAces ? 'oui' : 'non'}</td></tr>
            <tr><td>As splittés</td><td>une carte</td></tr>
            <tr><td>Abandon tardif</td><td>{r.lateSurrender ? 'oui' : 'non'}</td></tr>
            <tr><td>Assurance</td><td>2:1</td></tr>
            <tr><td>Mise principale</td><td>{fmt(r.minBet)} – {fmt(r.maxBet)}</td></tr>
            <tr><td>Side bets</td><td>{fmt(r.sideBetMin)} – {fmt(r.sideBetMax)}</td></tr>
          </tbody>
        </table>
      </div>
      {r.sideBets.map((id) => {
        const def = SIDE_BET_DEFS[id];
        return (
          <div className="paytable-block" key={id}>
            <h3>{def.name}</h3>
            <p className="desc">{def.description}</p>
            <table>
              <tbody>
                {def.paytable.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{fmtPays(row.pays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

export type DrawerTab = 'history' | 'stats' | 'paytables';

export function SideDrawer({
  open,
  tab,
  onTab,
  onClose,
}: {
  open: boolean;
  tab: DrawerTab;
  onTab(t: DrawerTab): void;
  onClose(): void;
}) {
  const history = useGame((s) => s.history);
  const [, setRefresh] = useState(0);
  void setRefresh;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <header>
              <h2>
                {tab === 'history' ? 'Historique' : tab === 'stats' ? 'Statistiques' : 'Paiements'}
              </h2>
              <button className="icon-btn" onClick={onClose} aria-label="Fermer">
                ✕
              </button>
            </header>
            <div className="tabs">
              <button className={tab === 'history' ? 'on' : ''} onClick={() => onTab('history')}>
                Manches
              </button>
              <button className={tab === 'stats' ? 'on' : ''} onClick={() => onTab('stats')}>
                Statistiques
              </button>
              <button className={tab === 'paytables' ? 'on' : ''} onClick={() => onTab('paytables')}>
                Règles &amp; paiements
              </button>
            </div>
            <div className="content">
              {tab === 'history' &&
                (history.length === 0 ? (
                  <div className="empty-note">Aucune manche jouée pour l&rsquo;instant.</div>
                ) : (
                  history.map((e) => <RoundItem key={e.id} e={e} />)
                ))}
              {tab === 'stats' && <StatsView />}
              {tab === 'paytables' && <PaytablesView />}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
