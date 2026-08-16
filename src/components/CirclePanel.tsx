import { useEffect, useState } from 'react';
import { fetchCreditSeries, depositVaultCloud, sendVaultCloud, withdrawVaultCloud, fetchMyScore, type CreditSeriesPoint } from '../cercle/circleApi';
import { SEND_VAULT_MAX_CENTS } from '../cercle/vaultLimits';
import { peakWealthCents, wealthCents } from '../cercle/wealth';
import { shouldApplyCloudWallet } from '../cercle/walletReconcile';
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
  onCircleChanged,
  type LeaderboardRow,
  type Leaderboards,
  type LocalCircleState,
} from '../cercle/circleStore';
import { consumeScoreDirty, isScoreDirty, onScoreDirty } from '../cercle/scoreSync';
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

/** Pousse le score cloud uniquement après une action de jeu (dirty). */
export function useCircleKeepalive() {
  useEffect(() => {
    let timer: number | undefined;
    let flushing = false;
    const flush = async () => {
      if (flushing) return;
      flushing = true;
      try {
        while (consumeScoreDirty()) {
          const state = loadCircle();
          if (!state?.circleCode) return;
          const incoming = await peekIncomingVault(
            useGame.getState().vault,
            useGame.getState().balance,
          );
          if (incoming !== useGame.getState().vault) {
            useGame.getState().setVaultFromServer(incoming);
          }
          const g = useGame.getState();
          await pushScore(state, {
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
        }
      } catch {
        /* réseau */
      } finally {
        flushing = false;
        if (isScoreDirty()) schedule();
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void flush();
      }, 650);
    };
    const unsub = onScoreDirty(schedule);
    const onHide = () => {
      if (isScoreDirty()) void flush();
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') onHide();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    schedule();
    return () => {
      unsub();
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVis);
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
  const applyIncomingVault = useGame((s) => s.applyIncomingVault);
  const applyVaultServerState = useGame((s) => s.applyVaultServerState);
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

  useEffect(() => {
    return onCircleChanged(() => {
      const next = loadCircle();
      setCircle(next);
      if (next) {
        setNickname(next.nickname);
        setJoinCode(next.circleCode ?? '');
        setBoards(leaderboardsFromLocal(next));
      }
    });
  }, []);

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

  const applyVaultAmount = async (mode: 'deposit' | 'withdraw') => {
    const cents = parseCreditsInput(vaultInput);
    if (cents == null) {
      setError('Indiquez un montant valide.');
      return;
    }
    setError(null);

    const syncThen = async () => {
      const g0 = useGame.getState();
      await pushScore(circle!, {
        balance: g0.balance,
        peakBalance: g0.peakBalance,
        vault: g0.vault,
        handsPlayed: g0.stats.handsPlayed,
        blackjacks: g0.stats.blackjacks,
        bestStreak: g0.stats.longestWinStreak,
        highestTable: g0.tableId,
        gamesBeforePeak: g0.gamesBeforePeak,
        gamesPlayed: g0.gamesPlayed,
      });
    };

    const applySafeCloudWallet = (
      cloudBalance: number,
      cloudVault: number,
      cloudPeak: number,
      notice: string,
    ) => {
      const g = useGame.getState();
      if (
        shouldApplyCloudWallet({
          localBalance: g.balance,
          localVault: g.vault,
          cloudBalance,
          cloudVault,
        }) === 'apply'
      ) {
        applyVaultServerState(
          { balance: cloudBalance, vault: cloudVault, peakBalance: cloudPeak },
          notice,
          { dirty: false },
        );
        return true;
      }
      return false;
    };

    if (mode === 'deposit') {
      if (circle?.cloud && isSupabaseConfigured()) {
        setBusy(true);
        try {
          await syncThen();
          const tryDeposit = async () => depositVaultCloud(cents);
          let res;
          try {
            res = await tryDeposit();
          } catch (e1) {
            const msg1 = e1 instanceof Error ? e1.message : '';
            if (/surplus|Pas assez/i.test(msg1)) {
              await syncThen();
              res = await tryDeposit();
            } else {
              throw e1;
            }
          }
          applyVaultServerState(
            {
              balance: res.balance,
              vault: res.vault,
              peakBalance: res.peak_balance,
            },
            `Coffré. Coffre : ${fmt(res.vault)}.`,
            { dirty: false },
          );
          const refreshed = await refreshLeaderboards(circle);
          setCircle(refreshed.state);
          setBoards(refreshed.boards);
          setVaultInput('');
        } catch (e) {
          const msg = e instanceof Error ? e.message : '';
          if (/deposit_my_vault|Could not find the function|schema cache/i.test(msg)) {
            vaultDeposit(cents);
            setVaultInput('');
            try {
              await syncThen();
            } catch {
              /* sync best-effort */
            }
            setError(
              'Dépôt local OK — colle la migration SQL deposit_my_vault (et sync vault) sur Supabase pour le cloud.',
            );
          } else {
            setError(msg || 'Dépôt impossible');
          }
        } finally {
          setBusy(false);
        }
        return;
      }
      vaultDeposit(cents);
      return;
    }

    // Retrait
    if (circle?.cloud && isSupabaseConfigured()) {
      setBusy(true);
      try {
        await syncThen();

        // Diagnostic cloud avant le RPC.
        try {
          const mine = await fetchMyScore();
          const cloudBal = Math.floor(Number(mine.balance) || 0);
          const cloudVault = Math.floor(Number(mine.vault) || 0);
          const cloudPeak = Math.floor(Number(mine.peak_balance) || 0);
          if (cloudVault < cents) {
            if (cloudVault <= 0) {
              const applied = applySafeCloudWallet(
                cloudBal,
                cloudVault,
                cloudPeak,
                'Rien dans le coffre cloud — tes crédits sont déjà en solde jouable.',
              );
              if (applied) {
                setVaultInput('');
                setError(null);
                return;
              }
              // Coffre fantôme + patrimoine local > cloud : liquider localement
              // puis resync (sans écraser un vrai gain non poussé).
              const g = useGame.getState();
              if (g.vault > 0) {
                vaultWithdraw(g.vault);
                await syncThen();
                try {
                  const again = await fetchMyScore();
                  applySafeCloudWallet(
                    Math.floor(Number(again.balance) || 0),
                    Math.floor(Number(again.vault) || 0),
                    Math.floor(Number(again.peak_balance) || 0),
                    'Coffre cloud vide — solde resynchronisé. Tu peux re-coffrer.',
                  );
                } catch {
                  /* ignore */
                }
                setVaultInput('');
                setError(
                  'Coffre cloud vide. Crédits remis en jouable localement — colle les migrations SQL vault si ça bloque encore.',
                );
                return;
              }
              setError('Coffre cloud vide — rien à retirer.');
              return;
            }
            applySafeCloudWallet(
              cloudBal,
              cloudVault,
              cloudPeak,
              'Coffre aligné avec le cloud.',
            );
            setVaultInput(String(cloudVault / 100));
            setError(`Coffre cloud : seulement ${fmt(cloudVault)}. Montant ajusté — retente Retirer.`);
            return;
          }
        } catch {
          /* continue vers RPC */
        }

        const res = await withdrawVaultCloud(cents);
        applyVaultServerState(
          {
            balance: res.balance,
            vault: res.vault,
            peakBalance: res.peak_balance,
          },
          `Retiré du coffre. Crédit : ${fmt(res.balance)}.`,
          { dirty: false },
        );
        const refreshed = await refreshLeaderboards(circle);
        setCircle(refreshed.state);
        setBoards(refreshed.boards);
        setVaultInput('');
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (/withdraw_my_vault|Could not find the function|schema cache/i.test(msg)) {
          vaultWithdraw(cents);
          setVaultInput('');
          setError(
            'Retrait local OK — colle la migration SQL withdraw_my_vault sur Supabase pour le cloud.',
          );
        } else if (/Pas assez dans le coffre/i.test(msg)) {
          try {
            const mine = await fetchMyScore();
            const cloudBal = Math.floor(Number(mine.balance) || 0);
            const cloudVault = Math.floor(Number(mine.vault) || 0);
            const cloudPeak = Math.floor(Number(mine.peak_balance) || 0);
            if (cloudVault <= 0) {
              applySafeCloudWallet(
                cloudBal,
                cloudVault,
                cloudPeak,
                'Coffre cloud vide — crédits déjà jouables.',
              );
            } else {
              setVaultInput(String(cloudVault / 100));
              setError(`Pas assez — coffre cloud ${fmt(cloudVault)}. Montant ajusté.`);
            }
          } catch {
            setError(msg);
          }
        } else {
          setError(msg || 'Retrait impossible');
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    vaultWithdraw(cents);
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
    if (cents > SEND_VAULT_MAX_CENTS) {
      setError(`Maximum ${fmt(SEND_VAULT_MAX_CENTS)} par envoi.`);
      return;
    }
    if (cents > vault) {
      setError('Pas assez dans le coffre — coffre d’abord, puis envoie.');
      return;
    }
    setSendBusy(true);
    setError(null);
    try {
      const gPeek = useGame.getState();
      const incoming = await peekIncomingVault(gPeek.vault, gPeek.balance);
      if (incoming !== useGame.getState().vault) {
        setVaultFromServer(incoming);
      }
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
      const vaultNow = useGame.getState().vault;
      if (cents > vaultNow) {
        setError(
          vaultNow <= 0
            ? 'Coffre cloud vide — coffre d’abord (bouton Coffrer), puis réessaie.'
            : `Coffre cloud : ${fmt(vaultNow)} seulement. Réduis le montant ou coffre plus.`,
        );
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
      const raw = e instanceof Error ? e.message : 'Envoi impossible';
      if (/Pas assez dans le coffre/i.test(raw)) {
        setError('Pas assez dans le coffre cloud — synchronise / coffre d’abord.');
      } else if (/Montant invalide/i.test(raw)) {
        setError(`Montant invalide (max ${fmt(SEND_VAULT_MAX_CENTS)}).`);
      } else if (/Pote introuvable/i.test(raw)) {
        setError('Pote introuvable — qu’il ouvre le cercle une fois pour apparaître.');
      } else {
        setError(raw);
      }
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
            const incoming = await peekIncomingVault(seed.vault, seed.balance);
            if (incoming !== useGame.getState().vault) {
              setVaultFromServer(incoming);
            }
            const g = useGame.getState();
            next = await pushScore(circle, {
              ...seed,
              vault: g.vault,
              balance: g.balance,
            });
            if (cancelled) return;
            setCircle(next);
          }
          const refreshed = await refreshLeaderboards(next);
          if (cancelled) return;
          setCircle(refreshed.state);
          setBoards(refreshed.boards);
          const me = refreshed.boards.live.find((r) => r.is_me) ?? refreshed.boards.peak.find((r) => r.is_me);
          if (me?.vault != null && me.balance != null) {
            applyIncomingVault(me.vault, me.balance);
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
                  Envoyer à un pote — depuis ton coffre uniquement (coffre d’abord). Max{' '}
                  {fmt(SEND_VAULT_MAX_CENTS)} par envoi.
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
              Patrimoine
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
                      {fmt(
                        tab === 'live'
                          ? wealthCents(m.balance, m.vault ?? 0)
                          : peakWealthCents(m.peak_balance, m.balance, m.vault ?? 0),
                      )}
                    </span>
                    <span className="vault-line">
                      dont coffre {fmt(m.vault ?? 0)}
                      {tab === 'live' ? ` · jouable ${fmt(m.balance)}` : ''}
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
