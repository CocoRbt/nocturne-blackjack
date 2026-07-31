import { useEffect, useState } from 'react';
import {
  getAccountSession,
  isSupabaseConfigured,
  loginAccount,
  logoutAccount,
  registerAccount,
  savedAccountEmail,
} from '../cercle/accountAuth';
import { useGame } from '../store/gameStore';

/** Création / connexion compte pour sync crédit PC ↔ téléphone. */
export function AccountPanel() {
  const hydrateFromCloud = useGame((s) => s.hydrateFromCloud);
  const [email, setEmail] = useState(() => savedAccountEmail() ?? '');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [isAnonymous, setIsAnonymous] = useState(true);

  const cloud = isSupabaseConfigured();

  const refreshSession = async () => {
    const s = await getAccountSession();
    setSessionEmail(s.email);
    setIsAnonymous(s.isAnonymous);
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  const onSubmit = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        await registerAccount(email, password);
        setInfo(
          'Compte créé. Si un e-mail de confirmation arrive, validez-le puis reconnectez-vous sur vos autres appareils.',
        );
        setPassword('');
        await refreshSession();
      } else {
        const score = await loginAccount(email, password);
        if (score?.found && score.balance != null && score.peak_balance != null) {
          hydrateFromCloud({
            balance: score.balance,
            peakBalance: score.peak_balance,
            gamesPlayed: score.games_played,
            gamesBeforePeak: score.games_before_peak,
            handsPlayed: score.hands_played,
            blackjacks: score.blackjacks,
            bestStreak: score.best_streak,
            highestTable: score.highest_table,
          });
        } else {
          setInfo(
            'Connecté. Rejoignez votre cercle pour synchroniser le crédit cloud, ou jouez ici puis sync.',
          );
        }
        setPassword('');
        await refreshSession();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur compte');
    } finally {
      setBusy(false);
    }
  };

  if (!cloud) {
    return (
      <div className="account-panel">
        <p className="circle-hint">Compte indisponible — Supabase non configuré.</p>
      </div>
    );
  }

  return (
    <div className="account-panel">
      <p className="circle-hint">
        Créez un compte pour retrouver le même crédit sur téléphone et PC. Le cercle reste lié à
        votre session.
      </p>

      {sessionEmail && !isAnonymous ? (
        <div className="account-session">
          <span className="account-email">{sessionEmail}</span>
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void logoutAccount()
                .then(() => refreshSession())
                .finally(() => setBusy(false));
            }}
          >
            Déconnexion
          </button>
        </div>
      ) : (
        <>
          <div className="circle-tabs account-mode-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className={mode === 'register' ? 'on' : ''}
              onClick={() => setMode('register')}
            >
              Créer
            </button>
            <button
              type="button"
              role="tab"
              className={mode === 'login' ? 'on' : ''}
              onClick={() => setMode('login')}
            >
              Se connecter
            </button>
          </div>
          <div className="circle-form-row">
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
              />
            </label>
            <label>
              Mot de passe
              <input
                type="password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </label>
          </div>
          {error && <p className="circle-error">{error}</p>}
          {info && <p className="circle-hint">{info}</p>}
          <button
            type="button"
            className="btn primary circle-join-btn"
            disabled={busy || email.trim().length < 5 || password.length < 6}
            onClick={() => void onSubmit()}
          >
            {busy ? '…' : mode === 'register' ? 'Créer mon compte' : 'Se connecter'}
          </button>
        </>
      )}
    </div>
  );
}
