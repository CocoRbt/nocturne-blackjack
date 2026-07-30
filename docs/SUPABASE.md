# Brancher Supabase (projet Nocturne_Blackjack)

## Auth choisie
- **Pas de compte email** pour les potes.
- Auth **anonyme** Supabase + **pseudo** + **code cercle**.
- Chaque appareil garde sa session ; le pseudo est unique **dans le cercle**.

## Classements
1. **Crédit actuel** — solde live (`balance`)
2. **Record** — plus haut crédit atteint (`peak_balance`)

## Setup dashboard
1. Projet Supabase `Nocturne_Blackjack`
2. **Authentication → Providers → Anonymous** : activer
3. **SQL Editor** : coller / exécuter `supabase/migrations/20260730140000_cercle.sql`
4. **Project Settings → API** : copier `Project URL` + `anon public` key
5. Local : créer `.env` (gitignoré) :
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
6. Vercel → Project → Settings → Environment Variables : mêmes clés (Production + Preview)
7. Redeploy

## Fichier mdp
Le fichier texte `mdp` / `mdp.txt` avec les secrets **ne doit jamais être push** (déjà dans `.gitignore`).
