# NOCTURNE — Déploiement Phase 2a (production)

**Statut :** prêt sur branche `cursor/phase2a-stop-loss-d1df` — **en attente de GO final utilisateur.**

**PRODUCTION NON MODIFIÉE** à ce stade.

---

## Prérequis validés (pré-GO)

| Point | Statut |
|-------|--------|
| Tests Vitest/TS | 286 tests OK · `npm run build` OK |
| Tests PostgreSQL réels (local) | `scripts/run-phase2a-pg-test.sh` → **ALL TESTS PASSED** |
| Jackpot `force` | Push uniquement si `financialSessionDepth === 0` ; claim RPC = source serveur du crédit JP |
| `SITE_PAUSED` | **reste `true`** — pas de réouverture après deploy 2a |

---

## 1. Sauvegarde SQL prod (AVANT migration)

Exécuter dans le SQL Editor Supabase **production** (READ ONLY export) :

```sql
-- Sauvegarder les définitions actuelles (copier le résultat dans un fichier daté)
SELECT pg_get_functiondef('public.sync_my_score(integer, integer, integer, integer, integer, text, integer, integer, integer)'::regprocedure);
SELECT pg_get_functiondef('public.enforce_score_invariants()'::regprocedure);
SELECT pg_get_functiondef('public.ensure_circle_membership(text, text)'::regprocedure);
SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.player_scores'::regclass AND NOT tgisinternal;
```

Conserver aussi un snapshot PITR / backup Supabase si disponible (hors scope agent).

---

## 2. Commit / SHA à déployer

Branche : `cursor/phase2a-stop-loss-d1df`  
PR : https://github.com/CocoRbt/nocturne-blackjack/pull/59

**SHA exact :** à renseigner au moment du merge (`git rev-parse HEAD` sur la branche mergée).

Fichiers hors scope **non** inclus : ledger, `game_rounds`, restauration joueurs, `SITE_PAUSED = false`.

---

## 3. Migration exacte

Fichier unique Phase 2a :

`supabase/migrations/20260818120000_phase2a_stop_loss.sql`

Contenu :
- `enforce_score_invariants()` — record monotone, plus de restore OLD
- `sync_my_score(...)` — plus de restore mid-mise (`games_played` égal + balance ↓)
- `ensure_circle_membership(...)` — plus de `peak → balance` millionnaire
- **Aucun** `UPDATE` de wallets joueurs

Application : `supabase db push` **ou** coller le SQL dans le SQL Editor (une seule transaction recommandée).

---

## 4. Vérification post-migration

Exécuter `supabase/diagnostics/PHASE2A_VERIFY.sql` — les 3 colonnes `failed` doivent être `false` / `f`.

Tests d'intégration (optionnel sur clone/staging) : `scripts/run-phase2a-pg-test.sh`.

---

## 5. Smoke production (sans toucher les wallets réels)

Avec `SITE_PAUSED = true` :

1. Vercel deploy depuis le SHA mergé
2. Vérifier que https://nocturne-blackjack.vercel.app affiche **« Salon fermé »**
3. Vérifier bundle contient toujours `Salon fermé` (pas d’app jouable)
4. `PHASE2A_VERIFY.sql` sur prod → 3 checks `failed = false`
5. **Ne pas** ouvrir l’app aux joueurs

Aucun test de mise réelle en prod tant que maintenance active.

---

## 6. Maintenance

`src/sitePaused.ts` : **`SITE_PAUSED = true`** — ne pas modifier dans ce déploiement.

Ordre validé :
1. Deploy Phase 2a (SQL + client)
2. Vérif prod
3. Maintenance **reste**
4. Ledger + game_rounds (phase suivante)
5. Sécuriser tous les jeux
6. Tests
7. Restauration wallets
8. **Alors seulement** `SITE_PAUSED = false`

---

## 7. Rollback

1. Revert merge Vercel → deploy précédent
2. SQL : `CREATE OR REPLACE` depuis les définitions sauvegardées §1
3. Vérifier `PHASE2A_VERIFY` avec anciennes defs si besoin

---

## 8. Tests PostgreSQL locaux (référence)

```bash
bash scripts/run-phase2a-pg-test.sh
```

Scénarios validés :
- 100 cr → perte 50 cr, `games_played` inchangé → **balance = 50** (pas de restore)
- all-in à 0, record conservé
- sync suivante après `games+1`
- balance faible, peak > balance
- trigger + `ensure_circle_membership` ne recollent pas

Environnement : PostgreSQL 16 local (`nocturne_phase2a_test`), **pas** la prod Supabase.
