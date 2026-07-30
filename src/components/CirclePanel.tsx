import { useEffect, useState } from 'react';
import { fmt } from '../lib/format';
import {
  enterCircle,
  exitCircle,
  isSupabaseConfigured,
  leaderboardsFromLocal,
  loadCircle,
  pushScore,
  refreshLeaderboards,
  type LeaderboardRow,
  type Leaderboards,
  type LocalCircleState,
} from '../cercle/circleStore';
import { useGame } from '../store/gameStore';

type BoardTab = 'live' | 'peak';

export function CirclePanel() {
  const balance = useGame((s) => s.balance);
  const peakBalance = useGame((s) => s.peakBalance);
  const stats = useGame((s) => s.stats);
  const tableId = useGame((s) => s.tableId);

  const [circle, setCircle] = useState<LocalCircleState | null>(() => loadCircle());
  const [nickname, setNickname] = useState(circle?.nickname ?? '');
  const [joinCode, setJoinCode] = useState(circle?.circleCode ?? '');
  const [tab, setTab] = useState<BoardTab>('live');
  const [boards, setBoards] = useState<Leaderboards | null>(
    circle ? leaderboardsFromLocal(circle) : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ouvert par défaut : sur téléphone un bandeau fermé disparaissait
  const [open, setOpen] = useState(true);

  const seed = {
    balance,
    peakBalance,
    handsPlayed: stats.handsPlayed,
    blackjacks: stats.blackjacks,
    bestStreak: stats.longestWinStreak,
    highestTable: tableId,
  };

  useEffect(() => {
    if (!circle?.circleCode) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const next = await pushScore(circle, seed);
          if (cancelled) return;
          setCircle(next);
          const refreshed = await refreshLeaderboards(next);
          if (cancelled) return;
          setCircle(refreshed.state);
          setBoards(refreshed.boards);
        } catch {
          // garde le local
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance, peakBalance, stats.handsPlayed, stats.blackjacks, stats.longestWinStreak, tableId, circle?.circleCode, circle?.nickname]);

  useEffect(() => {
    if (!circle?.cloud) return;
    const tick = () => {
      void refreshLeaderboards(circle).then((r) => {
        setCircle(r.state);
        setBoards(r.boards);
      });
    };
    const id = window.setInterval(tick, 12_000);
    return () => window.clearInterval(id);
  }, [circle]);

  const createOrJoin = async () => {
    const name = nickname.trim().slice(0, 16);
    if (name.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const next = await enterCircle(name, joinCode || undefined, seed);
      setCircle(next);
      setJoinCode(next.circleCode ?? '');
      const refreshed = await refreshLeaderboards(next);
      setCircle(refreshed.state);
      setBoards(refreshed.boards);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de rejoindre le cercle');
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    try {
      await exitCircle();
      setCircle(null);
      setBoards(null);
      setNickname('');
      setJoinCode('');
      setOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const rows: LeaderboardRow[] = tab === 'live' ? boards?.live ?? [] : boards?.peak ?? [];
  const cloud = isSupabaseConfigured();
  const joined = Boolean(circle?.circleCode);

  return (
    <section className={`circle-panel ${open ? 'is-open' : ''} ${joined ? 'is-joined' : ''}`}>
      <button
        type="button"
        className="circle-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="circle-toggle-main">
          <span className="circle-toggle-title">Cercle d&rsquo;amis</span>
          {cloud ? (
            <span className="circle-badge on">en ligne</span>
          ) : (
            <span className="circle-badge">local</span>
          )}
        </span>
        <span className="circle-toggle-meta">
          {joined ? `${circle!.nickname} · ${circle!.circleCode}` : 'Pseudo + code'}
        </span>
        <span className="circle-chevron" aria-hidden>
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && (
        <div className="circle-body">
          {!joined ? (
            <div className="circle-form">
              <div className="circle-form-row">
                <label>
                  Pseudo
                  <input
                    value={nickname}
                    maxLength={16}
                    placeholder="ex. Minuit"
                    autoComplete="nickname"
                    onChange={(e) => setNickname(e.target.value)}
                  />
                </label>
                <label>
                  Code (vide = créer)
                  <input
                    value={joinCode}
                    maxLength={12}
                    placeholder="NOC-XXXX"
                    autoCapitalize="characters"
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  />
                </label>
              </div>
              {error && <p className="circle-error">{error}</p>}
              <button
                className="btn primary circle-join-btn"
                onClick={() => void createOrJoin()}
                disabled={busy || nickname.trim().length < 2}
              >
                {busy ? 'Connexion…' : 'Entrer dans le cercle'}
              </button>
            </div>
          ) : (
            <>
              <div className="circle-meta">
                <span>
                  {circle!.nickname} · {circle!.circleCode}
                  {circle!.cloud ? ' · cloud' : ' · local'}
                </span>
                <button className="btn ghost" onClick={() => void leave()} disabled={busy}>
                  Quitter
                </button>
              </div>

              <div className="circle-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'live'}
                  className={tab === 'live' ? 'on' : ''}
                  onClick={() => setTab('live')}
                >
                  Crédit actuel
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'peak'}
                  className={tab === 'peak' ? 'on' : ''}
                  onClick={() => setTab('peak')}
                >
                  Record
                </button>
              </div>

              <ol className="circle-board">
                {rows.length === 0 && <li className="empty">Aucun score pour l’instant</li>}
                {rows.slice(0, 5).map((m) => (
                  <li key={`${tab}-${m.nickname}`} className={m.is_me ? 'me' : ''}>
                    <span className="rank">{m.rank}</span>
                    <span className="nick">{m.nickname}</span>
                    <span className="peak">
                      {fmt(tab === 'live' ? m.balance : m.peak_balance)}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  );
}
