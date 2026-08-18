# NOCTURNE — Rapport Phase 3A

**Date :** 2026-08-18  
**Branche :** `cursor/phase3a-wallet-migration-d1df`  
**Production :** **NON MODIFIÉE**

`SITE_PAUSED = true`  
Aucune migration 2b/2c/2d/2e prod.  
Aucune restauration joueur prod.  
Aucun `UPDATE` joueur prod.

---

## 1. Cercle principal ciblé

- **Code cercle :** `NOC-EJV7`
- **Membres réels trouvés :** **9**

Membres :

- Aubin
- I2S
- KikiLoki
- Lea
- Lea2
- Lofty
- Selmex
- Vincent
- ZaaariX

Le profil Selmex actif confirmé est bien :

- `7997ace8-c050-49f1-afd8-e4bb9c817cc3`
- cercle `NOC-EJV7`

L’autre Selmex (`NOC-EVJ7`) n’est **pas** à utiliser.

---

## 2. Tableau final joueurs

Fichier de travail exporté :

- `supabase/diagnostics/phase3a_targets.csv`

Tableau synthèse :

| profile_id | pseudo | balance actuelle | vault actuel | peak actuel | balance cible | vault cible | peak cible | stats cible | source / preuve | confiance | décision requise |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| `aff69e30-69c6-480d-9cf0-80384dafac1b` | Aubin | 9000 | 0 | 48000 | **UNKNOWN** | 0 | **UNKNOWN** | UNKNOWN / MANUAL | aucun snapshot ≤ T0 ; uniquement données post-T0 (17/08 18:01–18:36 UTC) | faible | **OUI** |
| `08846d54-1d68-4ed2-ba0d-c58e25825638` | I2S | 10000 | 0 | 10000 | 10000 | 0 | 10000 | SAFE CURRENT VALUE (stats 0) | `updated_at = 2026-07-30 19:32:33+00 < T0`, aucune autre trace contradictoire | haute | non |
| `a30d8791-5fa5-4a7c-89d6-7f459095b0f6` | KikiLoki | 1304569500 | 0 | 1904569500 | **121100000** | **0** | **121100000** | MANUAL / UNKNOWN | décision manuelle définitive validée | haute | non |
| `d1609022-3303-4259-b563-2c38f5b9022d` | Lea | 9262 | 50000000 | 50009262 | 9262 | 0 | 3170654 | UNKNOWN | 47 snapshots ≤ T0 ; dernier solde 9262 ; max snapshot 3170654 | moyenne-haute | non |
| `9596457a-0fd3-4db7-a34c-ce0a3d745463` | Lea2 | 250 | 100000000 | 100000250 | 250 | 0 | 28000 | UNKNOWN | 22 snapshots ≤ T0 ; dernier solde 250 ; max snapshot 28000 | moyenne | non |
| `018a50d7-4d53-46ab-a176-f6d37710f135` | Lofty | 10000 | 0 | 16612 | 10000 | 0 | 16612 | SAFE CURRENT VALUE | `updated_at < T0` + 11 snapshots ≤ T0 compatibles | haute | non |
| `7997ace8-c050-49f1-afd8-e4bb9c817cc3` | Selmex | 10000 | 50000000 | 50010000 | 10000 | 0 | 2060512 | UNKNOWN | profil actif confirmé ; 109 snapshots ≤ T0 ; max snapshot 2060512 ; dernier solde 10000 | haute balance / moyenne pic | non |
| `3afdb4e8-33ff-4148-9c26-17a3ea8cfbe3` | Vincent | 10000 | 0 | 910536621 | **100000** | **0** | **UNKNOWN** | UNKNOWN | balance manuelle validée ; peak actuel corrompu ; snapshots uniquement post-bug | haute balance / nulle pic | **OUI** |
| `12a585fb-bff6-4748-8e95-14ce2d3022b9` | ZaaariX | 3299602 | 50000000 | 53299602 | 3299602 | 0 | 3299602 | UNKNOWN | 90 snapshots ≤ T0 ; dernier solde = max snapshot = 3299602 | haute | non |

---

## 3. Reconstruction des records

Règle étudiée :

> `max(credit_snapshots.balance) <= T0` peut servir de record **seulement** si l’historique snapshots paraît suffisamment couvrant pour ce joueur.

### Résultats

| Joueur | snapshots ≤ T0 | premier | dernier | max snapshot ≤ T0 | record proposé | confiance | remarque |
|---|---:|---|---|---:|---:|---|---|
| Lea | 47 | 2026-08-13 10:01Z | 2026-08-15 13:58Z | 3170654 | 3170654 | moyenne-haute | couverture dense |
| Lea2 | 22 | 2026-08-16 11:42Z | 2026-08-16 14:30Z | 28000 | 28000 | moyenne | fenêtre courte mais cohérente |
| Lofty | 11 | 2026-08-13 14:46Z | 2026-08-13 18:10Z | 16612 | 16612 | haute | `updated_at < T0` cohérent |
| Selmex actif | 109 | 2026-08-01 08:50Z | 2026-08-13 15:41Z | 2060512 | 2060512 | moyenne-haute | historique riche |
| ZaaariX | 90 | 2026-07-31 22:22Z | 2026-08-14 18:15Z | 3299602 | 3299602 | haute | dernier = max = balance T0 |
| Vincent | 0 ≤ T0, snapshots seulement post-bug | — | — | — | **UNKNOWN** | nulle | décision manuelle requise |
| Aubin | 0 ≤ T0 | — | — | — | **UNKNOWN** | nulle | décision manuelle requise |
| I2S | 0 ≤ T0 | — | — | — | 10000 | haute | `updated_at < T0`, aucune contradiction |
| KikiLoki | 0 ≤ T0 | — | — | — | 121100000 | haute | décision manuelle définitive |

---

## 4. Reconstruction des stats

Règle suivie :

- **KNOWN** : preuve fiable indépendante
- **SAFE CURRENT VALUE** : `updated_at < T0` et aucune contradiction
- **UNKNOWN** : pas de preuve suffisante
- **MANUAL** : doit être décidé explicitement

### Par joueur

| Joueur | games_played | hands_played | blackjacks | best_streak | highest_table | games_before_peak |
|---|---|---|---|---|---|---|
| KikiLoki | UNKNOWN / MANUAL | UNKNOWN / MANUAL | UNKNOWN / MANUAL | UNKNOWN / MANUAL | UNKNOWN / MANUAL | UNKNOWN / MANUAL |
| Vincent | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Selmex | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| ZaaariX | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Lea | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Lea2 | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Lofty | SAFE CURRENT VALUE | SAFE CURRENT VALUE | SAFE CURRENT VALUE | SAFE CURRENT VALUE | SAFE CURRENT VALUE | SAFE CURRENT VALUE |
| I2S | SAFE CURRENT VALUE (= 0 / emeraude) | SAFE CURRENT VALUE | SAFE CURRENT VALUE | SAFE CURRENT VALUE | SAFE CURRENT VALUE | SAFE CURRENT VALUE |
| Aubin | UNKNOWN / MANUAL | UNKNOWN / MANUAL | UNKNOWN / MANUAL | UNKNOWN / MANUAL | UNKNOWN / MANUAL | UNKNOWN / MANUAL |

### Conclusion stats

La restauration Phase 3B doit prioriser :

1. `balance`
2. `vault`
3. `peak_balance`

Les stats inconnues peuvent rester neutres temporairement **uniquement après validation manuelle**, pas automatiquement.

---

## 5. Décision Aubin

### Conclusion

**AUBIN = MANUAL DECISION REQUIRED**

### Pourquoi

- aucune ligne `credit_snapshots` ≤ T0
- état `player_scores` actuel = **post-T0**
- peak et stats actuels ne sont pas utilisables pour reconstruire T0

### Donc

- ne pas inventer une balance cible
- ne pas inventer un peak cible
- ne pas migrer Aubin automatiquement en production

---

## 6. Décision Vincent peak

### Balance

Décision manuelle validée :

- `balance cible = 100000`
- `vault cible = 0`

### Peak

**peak_balance = UNKNOWN**

Pourquoi :

- tous les snapshots observés pour Vincent sont **post-bug**
- le peak actuel `910536621` est explicitement corrompu

### Donc

un arbitrage manuel est encore requis avant la restauration prod.

---

## 7. Validation I2S

État observé :

- `balance = 10000`
- `vault = 0`
- `peak = 10000`
- `games_played = 0`
- `updated_at = 2026-07-30 19:32:33+00`

Constat :

- `updated_at < T0`
- aucune autre source n’indique une mutation ultérieure
- aucun snapshot contradictoire trouvé

### Proposition retenue

État T0 fiable :

- `balance = 10000`
- `vault = 0`
- `peak = 10000`
- stats actuelles compatibles avec T0

**Confiance : haute**

---

## 8. Format MIGRATION_OPENING

Mécanisme conservé :

- `private.ledger_migration_opening(uid, balance, vault, authorized_by)`

Préparation supplémentaire :

- migration `20260818180000_phase3a_migration_opening_optype.sql`
- `wallet_ledger.op_type` autorise maintenant explicitement `MIGRATION_OPENING`

### Sens métier

`MIGRATION_OPENING` représente :

- l’ancrage comptable validé du solde historique
- l’ancrage comptable validé du coffre historique
- **sans** prétendre reconstituer les opérations antérieures

Le `peak_balance` reste restauré séparément.

---

## 9. Dry-run DB complet

Script ajouté :

- `scripts/run-phase3a-dry-run.sh`

SQL ajouté :

- `supabase/diagnostics/phase3a_dry_run.sql`

### Ce que fait le dry-run

1. applique toutes les migrations jusqu’à 3A localement
2. recrée le cercle `NOC-EJV7`
3. recrée les 9 profils
4. charge un état initial représentatif des données corrompues actuelles
5. applique `MIGRATION_OPENING` sur les profils résolus
6. restaure séparément `peak_balance`
7. vérifie que `sync_my_score` ne peut plus réécrire un wallet ledger

### Résultat

- `PHASE3A DRY-RUN PASSED`

---

## 10. Audit ledger après migration

Le dry-run vérifie pour tous les profils migrés :

- `player_scores.balance == SUM(wallet_ledger.amount)`
- `player_scores.vault == SUM(wallet_ledger.vault_delta)`
- `peak_balance >= balance + vault`

Résultat :

- **OK** pour tous les profils simulés migrés

---

## 11. Tests vrais profils simulés

### KikiLoki

Départ vérifié :

- `1 211 000` crédits (`121100000`)

Tests exécutés :

- Plinko
- settle
- dépôt coffre
- retrait coffre
- transfert vers Vincent
- refresh / recover

### Vincent

Départ vérifié :

- `1 000` crédits (`100000`)

Tests exécutés :

- Plinko
- settle
- dépôt coffre
- retrait coffre
- refresh / recover

### Lea2

Départ vérifié :

- `2,50` crédits (`250`)

Tests exécutés :

- tentative de mise trop élevée refusée
- aucune création accidentelle de `ACCOUNT_OPENING`
- balance inchangée après échec

### Point crucial validé

Un ancien joueur petit wallet **ne reçoit pas automatiquement 100 crédits** lors du passage ledger.

---

## 12. Runbook production proposé (pas exécuté)

### Étape 1 — garder maintenance

- Action : laisser `SITE_PAUSED = true`
- Résultat attendu : aucun joueur actif
- STOP si : prod non pausée
- Rollback : remettre le flag de pause avant toute suite

### Étape 2 — snapshot / exports prod

- Action : exports SQL read-only + backups dashboard
- Résultat attendu : rollback exact disponible
- STOP si : snapshot incomplet
- Rollback : ne rien lancer de plus

### Étape 3 — appliquer migrations 2b → 2e puis 3A

- Action : schéma ledger / game_rounds / hardening / migration opening type
- Résultat attendu : fonctions/RPC présents
- STOP si : une migration échoue
- Rollback : restaurer schéma depuis backup si nécessaire

### Étape 4 — vérifier schéma/RPC

- Action : smoke SQL read-only
- Résultat attendu : toutes les fonctions attendues existent
- STOP si : fonction manquante / drift
- Rollback : corriger hors prod, ne pas poursuivre

### Étape 5 — restaurer `player_scores`

- Action : écrire `balance`, `vault=0`, `peak_balance` validés
- Résultat attendu : état restauré par joueur
- STOP si : une valeur cible est encore UNKNOWN / MANUAL non validée
- Rollback : restaurer snapshot pré-write

### Étape 6 — créer `MIGRATION_OPENING`

- Action : ancrer le ledger avec `balance` / `vault`
- Résultat attendu : une base comptable propre par profil
- STOP si : double ancrage / dérive audit
- Rollback : supprimer lot de migration hors ligne / restaurer snapshot

### Étape 7 — audit ledger

- Action : comparer `wallet_ledger` vs `player_scores`
- Résultat attendu : zéro dérive
- STOP si : une dérive apparaît
- Rollback : restauration snapshot

### Étape 8 — déployer client ledger

- Action : déployer le SHA client validé
- Résultat attendu : profils migrés passent par ledger
- STOP si : fallback legacy détecté
- Rollback : redeploy client précédent

### Étape 9 — smoke tests en maintenance

- Action : tests contrôlés sans réouverture
- Résultat attendu : wallets stables
- STOP si : dérive / jackpot / coffre / transfer incorrect
- Rollback : maintenance conservée + rollback SQL/client

### Étape 10 — vérification finale joueurs

- Action : comparaison joueur par joueur
- Résultat attendu : Kiki, Vincent, Selmex, etc. conformes
- STOP si : un joueur diverge
- Rollback : snapshot pré-restauration

### Étape 11 — réouverture plus tard seulement

- Hors scope 3A

---

## 13. Blockers restants avant Phase 3B

### Bloquants métier

1. **Aubin**
   - balance cible inconnue
   - peak cible inconnu

2. **Vincent**
   - peak cible encore inconnu

3. **Blackjack ledger**
   - toujours fermé pour profils ledger
   - split / side bets / 8 decks non portés serveur

### Non bloquant pour la migration wallets hors Blackjack

- autres jeux ledger OK
- coffre / transfert OK
- ancrage MIGRATION_OPENING prêt

---

## 14. Actions READ ONLY éventuelles

Si vous voulez résoudre les derniers inconnus sans aucun write :

### Aubin

```sql
select *
from public.credit_snapshots
where profile_id = 'aff69e30-69c6-480d-9cf0-80384dafac1b'
order by recorded_at;
```

Objectif :

- confirmer définitivement qu’aucun snapshot ≤ T0 n’existe

### Vincent peak

```sql
select *
from public.credit_snapshots
where profile_id = '3afdb4e8-33ff-4148-9c26-17a3ea8cfbe3'
order by recorded_at;
```

Objectif :

- confirmer qu’aucune trace fiable pré-corruption n’existe pour son peak

Si rien de mieux n’existe :

- décision manuelle requise

---

## 15. Confirmation finale

**PRODUCTION NON MODIFIÉE**
