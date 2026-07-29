# NOCTURNE — cercle privé de blackjack

Casino fictif de blackjack, jouable sur ordinateur et mobile. **Jetons virtuels
uniquement** : aucun argent réel, aucun dépôt, retrait ou achat.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173
```

## Scripts

| Commande            | Rôle                                            |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | serveur de développement                        |
| `npm run build`     | typecheck + build de production                 |
| `npm run test`      | tests unitaires du moteur (Vitest)              |
| `npm run lint`      | lint (oxlint)                                   |
| `npm run typecheck` | vérification TypeScript                         |
| `npm run test:e2e`  | parties jouées dans Chromium (`npm run dev` requis) |

## Architecture

La logique de jeu est totalement séparée de l'interface :

```
src/engine/     moteur pur, sans dépendance UI
  types.ts      types partagés (montants en centimes)
  cards.ts      cartes, valeurs
  hand.ts       totaux, soft hands, blackjack naturel, paires
  shoe.ts       sabot multi-jeux, carte de coupe, re-mélange
  rules.ts      configuration centralisée des règles et des 3 tables
  sidebets.ts   définitions + tables de paiement des 5 side bets
  round.ts      machine à états d'une manche (donne → assurance →
                joueur → croupier → règlement)
  __tests__/    81 tests unitaires (cas limites inclus)

src/store/      Zustand : solde, mises, orchestration des animations,
                historique, statistiques, persistance localStorage
src/components/ React : table, cartes, jetons, actions, panneaux
src/audio/      sons synthétisés en Web Audio (aucun asset)
```

## Règles implémentées

- Sabot de 6 ou 8 jeux, carte de coupe à 75 %, re-mélange entre les manches.
- Blackjack payé **3:2** (exact au centime), hole card américaine avec peek.
- Hit, stand, double (any two), **split et re-split jusqu'à 4 mains**,
  double après split, As splittés à une carte, abandon tardif (selon table).
- **Assurance 2:1** et **even money**.
- Side bets : **Perfect Pairs** (25/12/6), **21+3** (100/40/30/10/5),
  **Lucky Ladies** (1000/125/19/9/4), **Bust It** (250/50/18/4/2),
  **Royal Match** (25 / 5:2). Tables de paiement consultables en jeu (ⓘ).
- Trois tables : Salon Émeraude (S17, abandon), Table Onyx (H17, 8 jeux),
  Suite Impériale (re-split des As, limites hautes).

Toutes les règles et paiements sont centralisés dans `src/engine/rules.ts`
et `src/engine/sidebets.ts`.
