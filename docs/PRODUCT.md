# NOCTURNE — brief produit (décisions retenues)

Document de référence pour les agents / itérations suivantes.  
Dernière mise à jour : 2026-07-30.

## Vision

Casino fictif de blackjack (jetons virtuels). Enjeu principal = **mises, jetons, progression de crédit**.  
Les micro-différences de règles (S17/H17, abandon, re-split As) sont **secondaires** ; l’ambiance / min / max / jetons priment.

## Tables

### 1–3 — Tables thématiques (progression)

| Table | Rôle | Déblocage |
| --- | --- | --- |
| Salon Émeraude | Entrée | Toujours (si solde ≥ mise min) |
| Table Onyx | Milieu | Pic de crédit ≥ max Émeraude **et** solde ≥ min Onyx |
| Suite Impériale | Haut | Pic de crédit ≥ max Onyx **et** solde ≥ min Impériale |

- On peut **toujours redescendre** sur une table déjà accessible / plus basse.
- Solde de départ calibré pour **forcer Émeraude** au début (`STARTING_BALANCE` sous le seuil Onyx).

### 4 — Table Privée (endgame)

- Débloquée quand le **pic de crédit ≥ max Impériale** (le joueur a été bridé sur la dernière table fixe).
- Le joueur choisit min / max dans une **fourchette bornée** (pas de « sur mesure » total dès le lobby).
- Plateau de jetons **dynamique** selon les limites choisies.
- Les 3 tables thématiques restent le chemin normal ; la Privée = salon VIP, pas un raccourci.

## Multi-spots (places)

- Standard casino : **5 à 7** places ; classique = 7.
- **Portrait → max 5 spots** ; **landscape → max 7 spots**.
- Le nombre max se fige **à l’entrée à la table / entre les manches**, jamais pendant un deal.
- **Pas de lock d’orientation forcé** ; hint possible (« passe en paysage pour 7 places »).
- Chaque spot a sa mise principale + side bets (21+3, Perfect Pairs, etc.).
- Les `hands` du moteur = **splits d’un spot**, pas des sièges.

## Cercle potes (3–4 amis) — à venir / en cours

- Pseudo + **code de cercle** (pas de matchmaking public).
- Stats : solde, pic, table max, mains, BJ, séries, net session.
- Challenges : classement du cercle, saison (bankroll partagée), défis 1v1 simples.
- Pas de multiplayer temps réel sur la même table (trop lourd pour le besoin).
- Stack cible : **Supabase** (auth légère + Postgres + leaderboard).

## Ordre d’implémentation

1. Brief (ce fichier) — **fait**
2. Progression / unlock + lobby — **fait**
3. Table Privée + jetons adaptatifs — **fait**
4. Multi-spots 5/7 + side bets par spot — **fait** (moteur `TableRound` + UI)
5. Cercle + base de données — **socle local + migration SQL** ; sync Supabase quand le projet est branché

### Seuils de déblocage (pic de crédit)

| Table | Pic requis |
| --- | --- |
| Émeraude | 0 |
| Onyx | 500 |
| Impériale | 2 000 |
| Privée | 10 000 |

Solde de départ : **100** (force le Salon Émeraude).
On peut toujours redescendre sur une table déjà accessible.
