import { useEffect, useState } from 'react';
import { fmt } from '../lib/format';
import {
  enterCircle,
  exitCircle,
  isSupabaseConfigured,
  leaderboardsFromLocal,
  loadCircle,
  overlaySelfOnBoards,
  pushScore,
  refreshLeaderboards,
  type LeaderboardRow,
  type Leaderboards,
  type LocalCircleState,
} from '../cercle/circleStore';
import { consumeScoreDirty, onScoreDirty } from '../cercle/scoreSync';
import { useGame } from '../store/gameStore';
import { formatGamesBeforePeak } from '../store/peakMeta';
import { DailyChallenges } from './DailyChallenges';

type BoardTab = 'live' | 'peak';

function currentScoreSeed() {
  const s = useGame.getState();
  return {
    balance: s.balance,
    peakBalance: s.peakBalance,
    handsPlayed: s.stats.handsPlayed,
    blackjacks: s.stats.blackjacks,
    bestStreak: s.stats.longestWinStreak,
    highestTable: s.tableId,
    gamesBeforePeak: s.gamesBeforePeak,
    gamesPlayed: s.gamesPlayed,
  };
}

/** Pousse le score cloud uniquement après une action de jeu (dirty). */
export function useCircleKeepalive() {
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!consumeScoreDirty()) return;
        const state = loadCircle();
        if (!state?.circleCode) return;
        void pushScore(state, currentScoreSeed()).catch(() => undefined);
      }, 450);
    };
    const unsub = onScoreDirty(schedule);
    schedule();
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, []);
}

export function CirclePanel() {
  const balance = useGame((s) => s.balance);
  const peakBalance = useGame((s) => s.peakBalance);
  const gamesPlayed = useGame((s) => s.gamesPlayed);
  const gamesBeforePeak = useGame((s) => s.gamesBeforePeak);
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
    gamesBeforePeak,
    gamesPlayed,
  };

  useEffect(() => {
    if (!circle?.circleCode) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const dirty = consumeScoreDirty();
          let next = circle;
          if (dirty) {
            next = await pushScore(circle, seed);
            if (cancelled) return;
            setCircle(next);
          }
          const refreshed = await refreshLeaderboards(next);
          if (cancelled) return;
          setCircle(refreshed.state);
          setBoards(refreshed.boards);
        } catch {
          if (circle) setBoards(leaderboardsFromLocal(circle));
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    balance,
    peakBalance,
    gamesPlayed,
    gamesBeforePeak,
    stats.handsPlayed,
    stats.blackjacks,
    stats.longestWinStreak,
    tableId,
    circle?.circleCode,
    circle?.nickname,
  ]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circle?.circleCode, circle?.nickname, circle?.cloud]);

  const createOrJoin = async () => {
    const name = nickname.trim().slice(0, 16);
    if (name.length < 2) return;
    if (switching && !joinCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // Changer de code : quitte d’abord (scores retirés) puis rejoint.
      if (switching && circle?.circleCode) {
        await exitCircle();
      }
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

  const displayBoards = boards
    ? overlaySelfOnBoards(boards, circle?.nickname ?? nickname, {
        balance,
        peakBalance,
        gamesBeforePeak,
      })
    : null;
  const rows: LeaderboardRow[] =
    tab === 'live' ? displayBoards?.live ?? [] : displayBoards?.peak ?? [];
  const cloud = isSupabaseConfigured();
  const joined = Boolean(circle?.circleCode);
  const showForm = !joined || switching;

  return (
    <div className={`circle-panel-in-drawer ${joined ? 'is-joined' : ''}`}>
      <p className="circle-drawer-lead">
        Classement entre amis — pseudo + code, sans compte.
        {cloud ? (
          <span className="circle-badge on">en ligne</span>
        ) : (
          <span className="circle-badge">local</span>
        )}
      </p>

      {showForm ? (
        <div className="circle-form">
          <DailyChallenges compact />
          {switching && (
            <p className="circle-hint">
              Vous quittez <strong>{circle?.circleCode}</strong> pour rejoindre un autre code.
            </p>
          )}
          {!switching && (
            <p className="circle-hint">
              Laissez le code vide pour créer un cercle. Sinon collez le code exact d&rsquo;un ami.
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

          <DailyChallenges />

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
                <span className="score-cell">
                  <span className="peak">
                    {fmt(tab === 'live' ? m.balance : m.peak_balance)}
                  </span>
                  {tab === 'peak' && (
                    <span className="before-peak">
                      {formatGamesBeforePeak(m.games_before_peak ?? 0)}
                    </span>
                  )}
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
