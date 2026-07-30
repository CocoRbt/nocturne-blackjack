import { useEffect, useState } from 'react';
import { fmt } from '../lib/format';
import {
  generateCircleCode,
  isSupabaseConfigured,
  loadCircle,
  saveCircle,
  upsertSelfScore,
  type LocalCircleState,
} from '../cercle/circleStore';
import { useGame } from '../store/gameStore';

export function CirclePanel() {
  const balance = useGame((s) => s.balance);
  const peakBalance = useGame((s) => s.peakBalance);
  const stats = useGame((s) => s.stats);
  const tableId = useGame((s) => s.tableId);

  const [circle, setCircle] = useState<LocalCircleState | null>(() => loadCircle());
  const [nickname, setNickname] = useState(circle?.nickname ?? '');
  const [joinCode, setJoinCode] = useState(circle?.circleCode ?? '');

  useEffect(() => {
    if (!circle?.nickname || !circle.circleCode) return;
    const next = upsertSelfScore(
      {
        nickname: circle.nickname,
        circleCode: circle.circleCode,
        members: circle.members,
      },
      {
        balance,
        peakBalance,
        handsPlayed: stats.handsPlayed,
        blackjacks: stats.blackjacks,
        bestStreak: stats.longestWinStreak,
        highestTable: tableId,
      },
    );
    const prev = circle.members.find((m) => m.nickname === circle.nickname);
    if (
      prev &&
      prev.balance === next.members[0]?.balance &&
      prev.peakBalance === next.members[0]?.peakBalance &&
      prev.handsPlayed === next.members[0]?.handsPlayed
    ) {
      return;
    }
    setCircle(next);
    saveCircle(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync scores only when game stats move
  }, [balance, peakBalance, stats.handsPlayed, stats.blackjacks, stats.longestWinStreak, tableId]);

  const createOrJoin = () => {
    const name = nickname.trim().slice(0, 16);
    if (name.length < 2) return;
    const code = (joinCode.trim() || generateCircleCode()).toUpperCase();
    const base: LocalCircleState = {
      nickname: name,
      circleCode: code,
      members: (circle?.members ?? []).filter((m) => m.nickname !== name),
    };
    const next = upsertSelfScore(base, {
      balance,
      peakBalance,
      handsPlayed: stats.handsPlayed,
      blackjacks: stats.blackjacks,
      bestStreak: stats.longestWinStreak,
      highestTable: tableId,
      nickname: name,
    });
    setCircle(next);
    setJoinCode(code);
    saveCircle(next);
  };

  const leave = () => {
    try {
      localStorage.removeItem('nocturne-cercle');
    } catch {
      // ignore
    }
    setCircle(null);
    setNickname('');
    setJoinCode('');
  };

  return (
    <section className="circle-panel">
      <div className="circle-head">
        <h2>Cercle</h2>
        <p>
          Défie 3–4 potes sur le pic de crédit.
          {isSupabaseConfigured()
            ? ' Sync cloud active.'
            : ' Classement local pour l’instant — branche Supabase plus tard.'}
        </p>
      </div>

      {!circle?.circleCode ? (
        <div className="circle-form">
          <label>
            Pseudo
            <input
              value={nickname}
              maxLength={16}
              placeholder="ex. Minuit"
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          <label>
            Code cercle (vide = créer)
            <input
              value={joinCode}
              maxLength={12}
              placeholder="NOC-XXXX"
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            />
          </label>
          <button className="btn primary" onClick={createOrJoin} disabled={nickname.trim().length < 2}>
            Entrer dans le cercle
          </button>
        </div>
      ) : (
        <>
          <div className="circle-meta">
            <span>
              {circle.nickname} · {circle.circleCode}
            </span>
            <button className="btn ghost" onClick={leave}>
              Quitter
            </button>
          </div>
          <ol className="circle-board">
            {circle.members.map((m, i) => (
              <li key={m.nickname} className={m.nickname === circle.nickname ? 'me' : ''}>
                <span className="rank">{i + 1}</span>
                <span className="nick">{m.nickname}</span>
                <span className="peak">{fmt(m.peakBalance)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
