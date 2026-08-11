import { useEffect, useState } from 'react';
import { fetchCreditSeries, sendVaultCloud, type CreditSeriesPoint } from '../cercle/circleApi';
import { consumeCircleSection } from '../cercle/circleNav';
import { fmt } from '../lib/format';
import {
  enterCircle,
  exitCircle,
  isSupabaseConfigured,
  leaderboardsFromLocal,
  loadCircle,
  overlaySelfOnBoards,
  peekIncomingVault,
  pushScore,
  refreshLeaderboards,
  type LeaderboardRow,
  type Leaderboards,
  type LocalCircleState,
} from '../cercle/circleStore';
import { consumeScoreDirty, onScoreDirty } from '../cercle/scoreSync';
import { STARTING_BALANCE } from '../store/persistence';
import { useGame } from '../store/gameStore';
import { formatGamesBeforePeak } from '../store/peakMeta';
import { vaultableAmount } from '../store/vault';
import { AccountPanel } from './AccountPanel';
import { CreditCurve } from './CreditCurve';
import { DailyChallenges } from './DailyChallenges';

type BoardTab = 'live' | 'peak' | 'curve';
type PanelSection = 'cercle' | 'compte';

/** Parse un montant saisi (crédits) → centimes. */
function parseCreditsInput(raw: string): number | null {
  const n = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function currentScoreSeed() {
  const s = useGame.getState();
  return {
    balance: s.balance,
    peakBalance: s.peakBalance,
    vault: s.vault,
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
        void (async () => {
          const seed = currentScoreSeed();
          const incoming = await peekIncomingVault(seed.vault);
          if (incoming > seed.vault) {
            useGame.getState().applyVaultAtLeast(incoming);
          }
          await pushScore(state, { ...seed, vault: Math.max(seed.vault, incoming) });
        })().catch(() => undefined);
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
  const vault = useGame((s) => s.vault);
  const peakBalance = useGame((s) => s.peakBalance);
  const gamesPlayed = useGame((s) => s.gamesPlayed);
  const gamesBeforePeak = useGame((s) => s.gamesBeforePeak);
  const stats = useGame((s) => s.stats);
  const tableId = useGame((s) => s.tableId);
  const vaultDeposit = useGame((s) => s.vaultDeposit);
  const vaultWithdraw = useGame((s) => s.vaultWithdraw);
  const applyVaultAtLeast = useGame((s) => s.applyVaultAtLeast);
  const setVaultFromServer = useGame((s) => s.setVaultFromServer);

  const [circle, setCircle] = useState<LocalCircleState | null>(() => loadCircle());
  const [nickname, setNickname] = useState(circle?.nickname ?? '');
  const [joinCode, setJoinCode] = useState(circle?.circleCode ?? '');
  const [section, setSection] = useState<PanelSection>(
    () => consumeCircleSection() ?? 'cercle',
  );
  const [tab, setTab] = useState<BoardTab>('live');
  const [boards, setBoards] = useState<Leaderboards | null>(
    circle ? leaderboardsFromLocal(circle) : null,
  );
  const [series, setSeries] = useState<CreditSeriesPoint[]>([]);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [vaultInput, setVaultInput] = useState('');
  const [sendTo, setSendTo] = useState('');
  const [sendBusy, setSendBusy] = useState(false);

  const canVault = vaultableAmount(balance);
  const seed = {
    balance,
    peakBalance,
    vault,
    handsPlayed: stats.handsPlayed,
    blackjacks: stats.blackjacks,
    bestStreak: stats.longestWinStreak,
    highestTable: tableId,
    gamesBeforePeak,
    gamesPlayed,
  };

  const applyVaultAmount = (mode: 'deposit' | 'withdraw') => {
    const cents = parseCreditsInput(vaultInput);
    if (cents == null) {
      setError('Indiquez un montant valide.');
      return;
    }
    setError(null);
    if (mode === 'deposit') vaultDeposit(cents);
    else vaultWithdraw(cents);
  };

  const mates = (circle?.members ?? [])
    .map((m) => m.nickname)
    .filter((n) => n !== circle?.nickname)
    .sort((a, b) => a.localeCompare(b, 'fr'));

  const sendToMate = async () => {
    if (!circle?.cloud || !isSupabaseConfigured()) {
      setError('Envoi réservé au cercle cloud.');
      return;
    }
    if (!sendTo.trim()) {
      setError('Choisissez un pote.');
      return;
    }
    const cents = parseCreditsInput(vaultInput);
    if (cents == null) {
      setError('Indiquez un montant valide.');
      return;
    }
    if (cents > vault) {
      setError('Pas assez dans le coffre.');
      return;
    }
    setSendBusy(true);
    setError(null);
    try {
      // 1) Pousse l’état local (dépôts) puis 2) transfert atomique serveur.
      const incoming = await peekIncomingVault(useGame.getState().vault);
      if (incoming > useGame.getState().vault) applyVaultAtLeast(incoming);
      const g = useGame.getState();
      await pushScore(circle, {
        balance: g.balance,
        peakBalance: g.peakBalance,
        vault: g.vault,
        handsPlayed: g.stats.handsPlayed,
        blackjacks: g.stats.blackjacks,
        bestStreak: g.stats.longestWinStreak,
        highestTable: g.tableId,
        gamesBeforePeak: g.gamesBeforePeak,
        gamesPlayed: g.gamesPlayed,
      });
      if (cents > useGame.getState().vault) {
        setError('Pas assez dans le coffre.');
        return;
      }
      const res = await sendVaultCloud(sendTo, cents);
      setVaultFromServer(
        res.vault,
        `Envoyé ${fmt(res.amount)} à ${res.to_nickname} (coffre → coffre).`,
      );
      const refreshed = await refreshLeaderboards(circle);
      setCircle(refreshed.state);
      setBoards(refreshed.boards);
      setVaultInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Envoi impossible');
    } finally {
      setSendBusy(false);
    }
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
            const incoming = await peekIncomingVault(seed.vault);
            if (incoming > seed.vault) applyVaultAtLeast(incoming);
            next = await pushScore(circle, { ...seed, vault: Math.max(seed.vault, incoming) });
            if (cancelled) return;
            setCircle(next);
          }
          const refreshed = await refreshLeaderboards(next);
          if (cancelled) return;
          setCircle(refreshed.state);
          setBoards(refreshed.boards);
          const me = refreshed.boards.live.find((r) => r.is_me) ?? refreshed.boards.peak.find((r) => r.is_me);
          if (me?.vault != null && me.vault > useGame.getState().vault) {
            applyVaultAtLeast(me.vault);
          }
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
    vault,
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
    if (
      !confirm(
        'Quitter ce cercle ? Vos scores cloud restent sauvegardés — vous pourrez rejoindre avec le même code et pseudo.',
      )
    ) {
      return;
    }
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
        vault,
      })
    : null;
  const rows: LeaderboardRow[] =
    tab === 'live' ? displayBoards?.live ?? [] : displayBoards?.peak ?? [];
  const cloud = isSupabaseConfigured();
  const joined = Boolean(circle?.circleCode);
  const showForm = !joined || switching;

  useEffect(() => {
    const onSection = (e: Event) => {
      const detail = (e as CustomEvent<PanelSection>).detail;
      if (detail === 'cercle' || detail === 'compte') setSection(detail);
    };
    window.addEventListener('nocturne-circle-section', onSection);
    return () => window.removeEventListener('nocturne-circle-section', onSection);
  }, []);

  useEffect(() => {
    if (!joined || tab !== 'curve' || !cloud) return;
    let cancelled = false;
    void (async () => {
      try {
        const pts = await fetchCreditSeries(48);
        if (!cancelled) {
          setSeries(pts);
          setSeriesError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setSeries([]);
          setSeriesError(
            e instanceof Error
              ? e.message
              : 'Courbe indisponible — appliquez la migration SQL côté Supabase.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [joined, tab, cloud, boards]);

  return (
    <div className={`circle-panel-in-drawer ${joined ? 'is-joined' : ''}`}>
      <div className="circle-tabs section-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={section === 'cercle' ? 'on' : ''}
          onClick={() => setSection('cercle')}
        >
          Cercle
        </button>
        <button
          type="button"
          role="tab"
          className={section === 'compte' ? 'on' : ''}
          onClick={() => setSection('compte')}
        >
          Compte
        </button>
      </div>

      {section === 'compte' ? (
        <AccountPanel />
      ) : (
        <>
      <p className="circle-drawer-lead">
        Classement entre amis — pseudo + code.
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

          <div className="circle-vault">
            <div className="circle-vault-head">
              <span className="circle-vault-k">Coffre</span>
              <strong>{fmt(vault)}</strong>
            </div>
            <p className="circle-vault-hint">
              Mettez de côté ce que vous ne voulez pas claquer. Max coffrable :{' '}
              {fmt(canVault)} (les {STARTING_BALANCE / 100} de base restent jouables).
            </p>
            <div className="circle-vault-form">
              <label className="circle-vault-amount">
                <span>Montant</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step={1}
                  placeholder="ex. 250"
                  value={vaultInput}
                  onChange={(e) => setVaultInput(e.target.value)}
                />
              </label>
              <div className="circle-vault-quick">
                <button
                  type="button"
                  className="btn ghost"
                  disabled={canVault <= 0}
                  onClick={() => setVaultInput(String(canVault / 100))}
                >
                  Max surplus
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={vault <= 0}
                  onClick={() => setVaultInput(String(vault / 100))}
                >
                  Max coffre
                </button>
              </div>
              <div className="circle-vault-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={canVault <= 0}
                  onClick={() => applyVaultAmount('deposit')}
                >
                  Coffrer
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={vault <= 0}
                  onClick={() => applyVaultAmount('withdraw')}
                >
                  Retirer
                </button>
              </div>
            </div>

            {circle!.cloud && isSupabaseConfigured() && (
              <div className="circle-vault-send">
                <p className="circle-vault-hint">
                  Envoyer à un pote — depuis ton coffre uniquement (pas le refill).
                </p>
                <label className="circle-vault-amount">
                  <span>Destinataire</span>
                  <select
                    value={sendTo}
                    onChange={(e) => setSendTo(e.target.value)}
                    disabled={mates.length === 0 || sendBusy}
                  >
                    <option value="">
                      {mates.length === 0 ? 'Aucun pote pour l’instant' : 'Choisir…'}
                    </option>
                    {mates.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn primary circle-vault-send-btn"
                  disabled={sendBusy || vault <= 0 || !sendTo || mates.length === 0}
                  onClick={() => void sendToMate()}
                >
                  {sendBusy ? 'Envoi…' : 'Envoyer le montant'}
                </button>
              </div>
            )}
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
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'curve'}
              className={tab === 'curve' ? 'on' : ''}
              onClick={() => setTab('curve')}
            >
              Courbe
            </button>
          </div>

          {tab === 'curve' ? (
            <>
              {seriesError && <p className="circle-error">{seriesError}</p>}
              <CreditCurve data={series} />
            </>
          ) : (
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
                    <span className="vault-line">
                      Coffre {fmt(m.vault ?? 0)}
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
          )}
        </>
      )}
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
