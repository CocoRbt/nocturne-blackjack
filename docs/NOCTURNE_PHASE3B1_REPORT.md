# NOCTURNE — Rapport Phase 3B.1

**Date :** 2026-08-18  
**Production :** **NON MODIFIÉE**

`SITE_PAUSED = true`  
Aucun write wallet.  
Aucune migration prod 2b→3A.  
Aucune restauration joueur.

---

## 1. Méthode backup trouvée

### Ce qui est disponible dans l’environnement courant

- `pg_dump` : **présent**
- `psql` : **présent**
- Supabase CLI : **absente**
- variable d’environnement DB / mot de passe Supabase : **absente**

### Conclusion

La méthode **sûre** visée reste bien :

- **Option recommandée : `pg_dump` PostgreSQL**

ou éventuellement :

- `supabase db dump` **si** un environnement authentifié/lié est disponible ailleurs

Mais **depuis cette session**, je n’ai pas les credentials DB nécessaires pour exécuter un vrai dump complet restaurable.

---

## 2. Dump produit ou raison du blocage

### Dump produit ?

**Non.**

### Raison exacte du blocage

Je dispose :

- du host Supabase prod (`db.gyazoruuxxezuodkhwoz.supabase.co`)
- des outils `pg_dump` / `psql`

Mais **pas** :

- de l’URI PostgreSQL complète
- ni du mot de passe DB
- ni d’un accès Supabase CLI déjà lié/authentifié pour le dump

Donc :

- **aucun vrai dump PostgreSQL complet n’a pu être produit depuis cet environnement**

Les exports MCP JSON déjà capturés restent des exports d’analyse, **pas** un backup complet.

---

## 3. Validation / restauration test

### Validation d’un vrai backup restaurable

**Impossible pour l’instant**, puisqu’aucun dump PostgreSQL complet n’a pu être généré.

### Niveau de garantie réellement obtenu

Garantie obtenue actuellement :

- lecture cohérente de plusieurs tables via MCP
- fingerprint prod connu
- exports analytiques lisibles

Garantie **non obtenue** :

- dump transactionnel complet
- test `pg_restore` sur base vide
- preuve qu’un rollback DB complet est faisable à partir du backup

---

## 4. Checksum / fingerprint

### Fingerprint prod confirmé

- `player_scores_count = 12`
- `sum(balance) = 1308297614`
- `sum(vault) = 250000000`
- `sum(peak_balance) = 3077834547`

### État schéma prod avant migration

- `wallet_ledger` : **absent**
- `game_rounds` : **absent**

### Backup local analytique créé

- dossier : `/workspace/artifacts/pre_phase3b_20260818_083709Z`

Mais ce dossier n’est **pas** un backup PostgreSQL restaurable au sens demandé.

Donc :

- **pas de checksum dump**
- **pas de taille dump**
- **pas de restore test dump**

---

## 5. Méthode Vercel prod

### Déploiement actuel identifié

- repo lié : `CocoRbt/nocturne-blackjack`
- branche par défaut GitHub : `main`
- les déploiements **Production** observés correspondent à des commits SHA sur `main`

Exemples récents :

| deployment id | SHA | date UTC |
|---|---|---|
| `5957520970` | `f9eea6727f1ebeeb70a6930a19b6a4756c5d2bc2` | 2026-08-18 06:38:16Z |
| `5952806690` | `c7df385d9531965229ba11183b5fc8a175ab0943` | 2026-08-17 22:54:34Z |
| `5950444933` | `5b951ec6990918eee98a6b446cdbb56e3a6749a6` | 2026-08-17 20:06:32Z |

### Conclusion opérationnelle

Chemin prod actuel :

1. un commit arrive sur `main`
2. Vercel déclenche un déploiement production

### Vercel CLI

- `vercel` CLI : **absente** dans cet environnement

---

## 6. Rollback client identifié

### Dernier déploiement prod actif

- deployment id : `5957520970`
- SHA : `f9eea6727f1ebeeb70a6930a19b6a4756c5d2bc2`
- environment URL build :  
  `https://nocturne-blackjack-5hp4fjcuw-cocos-projects-6825a6b6.vercel.app`
- alias prod attendu :  
  `https://nocturne-blackjack.vercel.app`

### Méthode de rollback client identifiée

Deux chemins possibles :

1. **Vercel Dashboard**  
   ouvrir le déploiement précédent et le **redeployer/promote** en prod

2. **GitHub / branche prod**  
   revenir au SHA précédent sur `main`, ce qui redéclencherait la prod

Le chemin est donc identifié, même si le contrôle d’écriture Vercel n’est pas disponible directement dans cette session.

---

## 7. `DATABASE_BACKUP_READY`

## **NO**

Raison :

- aucun dump PostgreSQL complet et restaurable n’a pu être généré/validé depuis cette session

---

## 8. `PROD_DEPLOYMENT_PATH_READY`

## **YES**

Raison :

- repo prod identifié
- branche de prod identifiée (`main`)
- déploiement prod auto observé
- dernier déploiement et rollback cible identifiés
- absence de CLI locale non bloquante pour l’identification du chemin

---

## 9. Action manuelle minimale éventuelle

### Pour satisfaire `DATABASE_BACKUP_READY = YES`

Action minimale à faire **une seule fois** :

#### Option recommandée

Depuis une machine / terminal ayant accès au secret DB prod :

1. **Supabase Dashboard**
   - ouvrir **Nocturne_Blackjack**
   - aller dans **Project Settings → Database**
   - récupérer la chaîne de connexion PostgreSQL complète (ou le mot de passe DB)

2. **Terminal**
   lancer :

```bash
pg_dump \
  --format=custom \
  --file="pre_phase3b_YYYYMMDD_HHMMSSZ.dump" \
  "postgresql://<user>:<password>@db.gyazoruuxxezuodkhwoz.supabase.co:5432/postgres?sslmode=require"
```

3. **Validation locale**

```bash
createdb nocturne_phase3b_restore_test
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d nocturne_phase3b_restore_test \
  "pre_phase3b_YYYYMMDD_HHMMSSZ.dump"
```

4. **Vérifications à me renvoyer**

```bash
sha256sum pre_phase3b_YYYYMMDD_HHMMSSZ.dump
ls -lh pre_phase3b_YYYYMMDD_HHMMSSZ.dump
psql -d nocturne_phase3b_restore_test -c "select count(*) from public.player_scores;"
psql -d nocturne_phase3b_restore_test -c "select sum(balance), sum(vault), sum(peak_balance) from public.player_scores;"
```

Résultats attendus :

- `count(*) = 12`
- `sum(balance) = 1308297614`
- `sum(vault) = 250000000`
- `sum(peak_balance) = 3077834547`

Quand tu m’auras donné :

- chemin du dump
- taille
- SHA-256
- preuve que `pg_restore` passe
- fingerprint restauré

alors :

- `DATABASE_BACKUP_READY = YES`

---

## Conclusion

- méthode backup : **identifiée (`pg_dump`) mais non exécutable ici faute de credentials**
- dump produit : **non**
- validation restauration : **non**
- méthode Vercel prod : **identifiée**
- rollback client : **identifié**

### Verdicts

- `DATABASE_BACKUP_READY = NO`
- `PROD_DEPLOYMENT_PATH_READY = YES`

## **PRODUCTION NON MODIFIÉE**
