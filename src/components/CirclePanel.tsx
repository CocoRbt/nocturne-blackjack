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

/** Garde les scores cloud à jour même si le tiroir est fermé. */
export function useCircleKeepalive() {
  const balance = useGame((s) => s.balance);
  const peakBalance = useGame((s) => s.peakBalance);
  const stats = useGame((s) => s.stats);
  const tableId = useGame((s) => s.tableId);

  useEffect(() => {
    const state = loadCircle();
    if (!state?.circleCode) return;
    let cancelled = false;
    const seed = {
      balance,
      peakBalance,
      handsPlayed: stats.handsPlayed,
      blackjacks: stats.blackjacks,
      bestStreak: stats.longestWinStreak,
      highestTable: tableId,
    };
    const t = window.setTimeout(() => {
      void pushScore(state, seed).catch(() => undefined);
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      void cancelled;
    };
  }, [balance, peakBalance, stats.handsPlayed, stats.blackjacks, stats.longestWinStreak, tableId]);
}

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
  const [copied, setCopied] = useState(false);
  const [switching, setSwitching] = useState(false);

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
    tick();
    const id = window.setInterval(tick, 8_000);
    return () => window.clearInterval(id);
  }, [circle]);

  const createOrJoin = async () => {
    const name = nickname.trim().slice(0, 16);
    if (name.length < 2) return;
    if (switching && !joinCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // Changer de code : on reste sur la même session anonyme,
      // join_circle bascule le circle_id (pas besoin du dashboard).
      const next = await enterCircle(name, joinCode || undefined, seed);
      setCircle(next);
      setJoinCode(next.circleCode ?? '');
      const refreshed = await refreshLeaderboards(next);
      setCircle(refreshed.state);
      setBoards(refreshed.boards);
      setSwitching(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de rejoindre le cercle');
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    setError(null);
    try {
      await exitCircle();
      setCircle(null);
      setBoards(null);
      setNickname('');
      setJoinCode('');
      setSwitching(false);
    } finally {
      setBusy(false);
    }
  };

  const startSwitch = () => {
    setSwitching(true);
    setError(null);
    setJoinCode('');
    setNickname(circle?.nickname ?? '');
  };

  const copyCode = async () => {
    const code = circle?.circleCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // fallback silencieux
    }
  };

  const rows: LeaderboardRow[] = tab === 'live' ? boards?.live ?? [] : boards?.peak ?? [];
  const cloud = isSupabaseConfigured();
  const joined = Boolean(circle?.circleCode);
  const showForm = !joined || switching;

  return (
    <div className={`circle-panel-in-drawer ${joined ? 'is-joined' : ''}`}>
      <p className="circle-drawer-lead">
        Classement entre potes — pseudo + code, sans compte.
        {cloud ? (
          <span className="circle-badge on">en ligne</span>
        ) : (
          <span className="circle-badge">local</span>
        )}
      </p>

      {showForm ? (
        <div className="circle-form">
          {switching && (
            <p className="circle-hint">
              Tu quittes <strong>{circle?.circleCode}</strong> pour rejoindre un autre code.
            </p>
          )}
          {!switching && (
            <p className="circle-hint">
              Laisse le code vide pour créer un cercle. Sinon colle le code exact d&rsquo;un pote.
            </p>
          )}
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
              Code cercle
              <input
                value={joinCode}
                maxLength={12}
                placeholder="NOC-XXXX"
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              />
            </label>
          </div>
          {error && <p className="circle-error">{error}</p>}
          <button
            className="btn primary circle-join-btn"
            onClick={() => void createOrJoin()}
            disabled={busy || nickname.trim().length < 2 || (switching && !joinCode.trim())}
          >
            {busy
              ? 'Connexion…'
              : switching
                ? 'Rejoindre ce code'
                : joinCode.trim()
                  ? 'Rejoindre'
                  : 'Créer mon cercle'}
          </button>
          {switching && (
            <button
              type="button"
              className="btn ghost circle-join-btn"
              style={{ marginTop: 8 }}
              onClick={() => {
                setSwitching(false);
                setJoinCode(circle?.circleCode ?? '');
                setError(null);
              }}
              disabled={busy}
            >
              Annuler
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="circle-code-row">
            <div>
              <span className="circle-code-label">Code à partager</span>
              <strong className="circle-code-value">{circle!.circleCode}</strong>
            </div>
            <button type="button" className="btn ghost" onClick={() => void copyCode()}>
              {copied ? 'Copié' : 'Copier'}
            </button>
          </div>
          <p className="circle-meta-line">
            {circle!.nickname}
            {circle!.cloud ? ' · cloud' : ' · local'}
          </p>

          <div className="circle-leave-actions">
            <button
              type="button"
              className="btn ghost circle-leave-btn"
              onClick={() => void leave()}
              disabled={busy}
            >
              {busy ? 'Sortie…' : 'Quitter ce cercle'}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={startSwitch}
              disabled={busy}
            >
              Changer de code
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
            {rows.slice(0, 12).map((m) => (
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
  );
}

export function circleJoinedLabel(): string | null {
  const c = loadCircle();
  if (!c?.circleCode) return null;
  return c.nickname;
}
