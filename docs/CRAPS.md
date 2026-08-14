# NOCTURNE — Craps (Street / GWYF-like)

## Inspiration

Règles inspirées du **Street Craps** de *Gamble With Your Friends* (pas le craps casino Pass/Don’t Pass) :

| Source | Détail retenu |
| --- | --- |
| Steam (analyse joueur) | **×2** avant la cible, **×4** une fois la cible fixée |
| Gameplay / guides | 7 / 11 win, 2 / 3 / 12 lose au 1er jet ; sinon point |
| Feeling GWYF (« souvent remboursé ») | Après **3 jets** en phase cible sans hit ni 7 → **push** (mise rendue) |
| UI | Les chiffres gagnants / perdants **changent** après le 1er total |

## Flow

1. **Mise unique** — poser un jeton, puis lancer. **Reprendre** rend le jeton tant que les dés n’ont pas volé.
2. **Premier jet (×2)**  
   - 7 ou 11 → win (crédit = mise × 2)  
   - 2, 3 ou 12 → lose  
   - 4 / 5 / 6 / 8 / 9 / 10 → **cible** fixée, multi passe à ×4
3. **Phase cible (×4)** — jusqu’à 3 jets :  
   - total = cible → win (crédit = mise × 4)  
   - total = 7 → lose  
   - autre → continue ; au 3ᵉ neutre → **remboursement**

## Affichage

| Phase | Gagne | Perd |
| --- | --- | --- |
| Libre | 7, 11 | 2, 3, 12 |
| Cible N | N | 7 |

## Fairness

Deux dés 1–6 via `crypto.getRandomValues`. Jetons virtuels, crédit partagé.

Recharge lobby (+100) **interdite** tant qu’une mise est sur le feutre — évite l’all-in + refill infini.
