# PLINKO — analyse & spec Nocturne

## 1. Analyse concurrentielle

### Stake (référence principale)
- Bille qui tombe dans une pyramide de picots (Galton board).
- À chaque rangée : gauche / droite **50/50** → slot final = binôme `C(n,k)/2^n`.
- **Lignes** : 8 → 16 (slots = lignes + 1).
- **Risque** : Low / Medium / High (/ Expert) — ne change **pas** les proba, seulement les multiplicateurs.
- Centre fréquent / bords rares ; bords = gros mults.
- RTP affiché **~99 %** (HE ~1 %) sur toutes les configs.
- Max typique : Low 16×, Medium 110×, High 1000×, Expert 10 000× (16 lignes).
- Provably fair (HMAC) ; mode auto-bet côté Stake (hors scope v1 Nocturne).
- UI : panel mise + risque + lignes à gauche/bas, planche animée au centre, buckets en bas.

### Autres plateformes
| Plateforme | Différences clés |
| --- | --- |
| Overtime (on-chain) | 8 lignes fixes, VRF bits = chemin, RTP plafonné 98 % |
| Roobet / Rainbet / BC.Game | Même famille binomiale + risk tiers ; tables proches Stake |
| Physique « fake » | Souvent le slot est tiré d’abord, l’anim suit — Nocturne fait l’inverse honnête : **chemin RNG → slot** |

### Ce qu’on retient pour Nocturne
1. Math binomiale pure + tables type Stake (Low/Medium/High).
2. Lignes **8 / 12 / 16** (lisibles mobile, assez de variance).
3. RTP cible **99 %** (aligné Mines/Crash), vérifié par tests EV.
4. Une mise → un drop → un payout (pas de side bets).
5. Animation : chemin réel (bounces), pas un résultat maquillé.
6. Crédit partagé, GameShell, règles, défis, menu.

---

## 2. Plan d’implémentation (checklist)

### A. Moteur & math
- [x] `src/plinko/math.ts` — tables, binomial, RTP, payoutCents
- [x] `src/plinko/engine.ts` — idle / dropping / settled, path RNG
- [x] Tests math (symétrie, RTP, proba) + engine (seeded)

### B. Store & navigation
- [x] `screen: 'plinko'` + enter/leave/debit/credit + markScoreDirty
- [x] App.tsx lazy
- [x] AppMenu goTo plinko
- [x] Lobby carte

### C. UI
- [x] PlinkoScreen + GameShell accent
- [x] Board SVG/CSS (pegs, ball path, buckets)
- [x] Panel : mise, lignes, risque, CTA Drop, historique
- [x] CSS `plinko-*` + tone RulesGuide
- [x] Mobile : panel puis board, scroll reset

### D. Produit
- [x] RulesGuide Plinko
- [x] Défis plinko_rounds / plinko_mult
- [x] docs/PRODUCT.md
- [x] docs/PLINKO.md (ce fichier)

### E. QA
- [x] Simulations multi-config (RTP empirique)
- [x] Situations : broke, leave pendant drop, double-click, min mise
- [x] Build + suite vitest (173)

---

## 3. Hors scope v1
- Mode Expert / 10 000×
- Auto-bet / turbo multi-balles
- Provably fair UI seed (RNG crypto interne suffit, comme Mines)
- Sons dédiés (réutilise chip/click si besoin)
