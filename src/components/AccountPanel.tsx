import { useEffect, useState } from 'react';
import {
  getAccountSession,
  isSupabaseConfigured,
  loginAccount,
  logoutAccount,
  registerAccount,
  savedAccountEmail,
} from '../cercle/accountAuth';
import { applyCloudScore } from '../cercle/accountHydrate';
import { fmt } from '../lib/format';

function fmtCredits(cents: number | undefined): string {
  return fmt(Math.max(0, Math.floor(Number(cents) || 0)));
}

/** Création / connexion compte pour sync crédit PC ↔ téléphone. */
export function AccountPanel() {
  const [email, setEmail] = useState(() => savedAccountEmail() ?? '');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [emailPending, setEmailPending] = useState(false);

  const cloud = isSupabaseConfigured();

  const refreshSession = async () => {
    const s = await getAccountSession();
    setSessionEmail(s.email);
    setIsAnonymous(s.isAnonymous);
    setEmailPending(s.emailPending);
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
        const result = await registerAccount(email, password);
        if (result.needsEmailConfirmation) {
          setInfo(
            `Un e-mail de confirmation vous a été envoyé. Ouvrez le lien (il renvoie vers ${result.redirectTo}), puis utilisez « Se connecter » sur vos autres appareils.`,
          );
        } else {
          setInfo('Compte créé. Vous pouvez vous connecter sur un autre appareil avec le même e-mail.');
        }
        setPassword('');
        await refreshSession();
      } else {
        const score = await loginAccount(email, password);
        const applied = await applyCloudScore(score);
        if (applied) {
          if (score.in_circle && score.circle_code) {
            setInfo(`Connecté — crédit ${fmtCredits(score.balance)} · cercle ${score.circle_code}.`);
          } else {
            setInfo(
              `Connecté — crédit ${fmtCredits(score.balance)} synchronisé. Rejoignez votre cercle si besoin.`,
            );
          }
        } else {
          setInfo(
            'Connecté. Aucun solde cloud pour ce compte — le crédit de cet appareil reste affiché.',
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
          <div>
            <span className="account-email">{sessionEmail}</span>
            {emailPending && (
              <p className="circle-hint" style={{ marginTop: 6 }}>
                Confirmation e-mail en attente — ouvrez le lien reçu.
              </p>
            )}
          </div>
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
