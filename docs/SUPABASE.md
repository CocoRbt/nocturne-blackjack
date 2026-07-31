# Brancher Supabase (projet Nocturne_Blackjack)

## Auth choisie
- Auth **anonyme** par défaut + **pseudo** + **code cercle**.
- **Compte email optionnel** (Menu → Compte) : lie la session anonyme pour retrouver le même crédit sur PC / téléphone.
- Dashboard : activer aussi **Authentication → Providers → Email**.

## Classements
1. **Crédit actuel** — solde live (`balance`)
2. **Record** — plus haut crédit atteint (`peak_balance`) + parties avant ce record (`games_before_peak`)

## Setup dashboard
1. Projet Supabase `Nocturne_Blackjack`
2. **Authentication → Providers → Anonymous** : activer
3. **SQL Editor** : coller / exécuter dans l’ordre :
   - `supabase/migrations/20260730140000_cercle.sql`
   - `supabase/migrations/20260730190000_fix_join_leave.sql` (si la 1ʳᵉ a déjà été jouée)
   - `supabase/migrations/20260730220000_games_before_peak.sql` (parties avant le record)
   - `supabase/migrations/20260731080000_sync_games_before_peak_backfill.sql`
   - `supabase/migrations/20260731100000_score_integrity.sql` (**anti-triche** : plus d’UPDATE direct des scores ; sync via parties)
   - `supabase/migrations/20260731221221_account_credit_curve.sql` (compte `get_my_score` + courbe `credit_snapshots`)

4. **Project Settings → API** : copier `Project URL` + `anon public` key
5. Local : créer `.env` (gitignoré) :
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
6. Vercel → Project → Settings → Environment Variables : mêmes clés (Production + Preview)
7. Redeploy

## Comportement important
- **Créer** : laisser le code vide → génère `NOC-XXXX`.
- **Rejoindre** : coller le code **exact** d’un pote. Un code inexistant renvoie une erreur (ne crée plus un 2ᵉ cercle par typo).
- **Quitter** : retire vraiment ton profil + scores du cloud (`leave_circle`). Les autres appareils mettent ~8 s à rafraîchir.
- Sans compte email : téléphone et PC = **2 joueurs séparés**. Avec compte : même uid → même crédit / cercle après « Se connecter ».

## Nettoyer un profil fantôme (ex. test « Minuit »)
Si quelqu’un a quitté **avant** le fix `leave_circle`, son pseudo peut rester dans le classement.
SQL Editor → coller / Run :

```sql
delete from public.player_scores s
using public.profiles p
where s.profile_id = p.id
  and lower(p.nickname) = lower('Minuit');

update public.profiles
set circle_id = null
where lower(nickname) = lower('Minuit');
```

Puis sur le téléphone : attendre ~8 s ou recharger la page.

## Fichier mdp
Le fichier texte `mdp` / `mdp.txt` avec les secrets **ne doit jamais être push** (déjà dans `.gitignore`).
