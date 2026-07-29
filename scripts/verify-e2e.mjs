/**
 * Vérification de bout en bout : joue de vraies parties dans Chromium,
 * contrôle la cohérence comptable après chaque manche, exerce les mises,
 * splits, doubles, assurances et side bets, et capture des écrans
 * (bureau + mobile). Nécessite `npm run dev` sur http://localhost:5173.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const SHOTS = 'verify';
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (cond, label) => {
  if (cond) console.log(`  ✔ ${label}`);
  else {
    failures++;
    console.error(`  ✘ ÉCHEC : ${label}`);
  }
};

const state = (page) => page.evaluate(() => {
  const s = window.__game.getState();
  return {
    balance: s.balance,
    screen: s.screen,
    phase: s.round?.phase ?? null,
    dealing: s.display.dealing,
    resultsShown: s.display.resultsShown,
    hands: s.round?.hands.map((h) => ({
      cards: h.cards.map((c) => c.rank + c.suit),
      bet: h.bet,
      doubled: h.doubled,
    })) ?? [],
    active: s.round?.activeHandIndex ?? 0,
    actions: s.round && s.round.phase === 'player' ? s.round.availableActions(s.balance) : [],
    summary: s.round?.result
      ? {
          totalReturned: s.round.result.totalReturned,
          totalWagered: s.round.result.totalWagered,
          totalNet: s.round.result.totalNet,
          outcomes: s.round.result.hands.map((h) => h.outcome),
          sideBets: s.round.result.sideBets.map((b) => ({ id: b.id, net: b.net, label: b.label })),
          insurance: s.round.result.insurance,
        }
      : null,
    historyLen: s.history.length,
    statsRounds: s.stats.rounds,
    staged: Object.values(s.stacks).flat().reduce((a, b) => a + b, 0),
  };
});

/** Attend une phase jouable : actions joueur, assurance, settlement ou résultats. */
async function waitPlayable(page) {
  await page.waitForFunction(() => {
    const s = window.__game.getState();
    if (!s.round) return true;
    if (s.display.dealing) return false;
    return (
      s.round.phase === 'player' ||
      s.round.phase === 'insurance' ||
      s.round.phase === 'settled' ||
      s.display.resultsShown
    );
  }, null, { timeout: 20000 });
}

const covered = { split: false, double: false, insurance: false, surrender: false, sideBetWin: false };

async function playRound(page, { bets, policy }, tag) {
  const before = await state(page);

  for (const [spotLabel, chipLabel, times] of bets) {
    await page.getByLabel(`Jeton de ${chipLabel}`, { exact: true }).click();
    for (let i = 0; i < times; i++) {
      await page.getByLabel(`Miser sur ${spotLabel}`).click();
    }
  }
  const staged = (await state(page)).staged;
  await page.getByRole('button', { name: /^Distribuer/ }).click();
  await waitPlayable(page);

  // Boucle de jeu.
  for (let guard = 0; guard < 30; guard++) {
    const s = await state(page);
    if (s.resultsShown || !s.phase || s.phase === 'settled') break;
    if (s.phase === 'insurance') {
      covered.insurance = true;
      const evenMoney = await page.getByRole('button', { name: /Even money/ }).isVisible().catch(() => false);
      if (evenMoney) await page.getByRole('button', { name: /Even money/ }).click();
      else if (policy.insurance === 'take') await page.getByRole('button', { name: /^Assurance/ }).click();
      else await page.getByRole('button', { name: 'Refuser' }).click();
    } else if (s.phase === 'player') {
      const hand = s.hands[s.active];
      let act = 'stand';
      if (s.actions.includes('split') && policy.split) act = 'split';
      else if (s.actions.includes('surrender') && policy.surrender) act = 'surrender';
      else if (s.actions.includes('double') && policy.double && total(hand.cards) >= 9 && total(hand.cards) <= 11) act = 'double';
      else if (s.actions.includes('hit') && total(hand.cards) < 17) act = 'hit';
      const labels = { hit: 'Tirer', stand: 'Rester', double: 'Doubler', split: 'Séparer', surrender: 'Abandonner' };
      if (act === 'split') covered.split = true;
      if (act === 'double') covered.double = true;
      if (act === 'surrender') covered.surrender = true;
      // le nom accessible inclut le raccourci clavier ("Tirer T")
      await page.getByRole('button', { name: new RegExp('^' + labels[act]) }).click();
    }
    await page.waitForFunction(() => {
      const st = window.__game.getState();
      return (
        !st.round ||
        st.display.resultsShown ||
        st.round.phase === 'player' ||
        st.round.phase === 'insurance' ||
        st.round.phase === 'settled'
      );
    }, null, { timeout: 20000 });
    // petit délai pour laisser les présentations avancer
    await page.waitForTimeout(80);
  }

  await page.waitForFunction(() => window.__game.getState().display.resultsShown, null, { timeout: 25000 });
  const after = await state(page);
  const sum = after.summary;

  // Invariant comptable : solde_final = solde_initial - misé + rendu.
  const expected = before.balance - sum.totalWagered + sum.totalReturned;
  check(after.balance === expected,
    `${tag} : solde exact (${before.balance / 100} - ${sum.totalWagered / 100} + ${sum.totalReturned / 100} = ${after.balance / 100})`);
  check(sum.totalNet === sum.totalReturned - sum.totalWagered, `${tag} : net cohérent`);
  check(after.historyLen === before.historyLen + 1, `${tag} : manche ajoutée à l'historique`);
  if (sum.sideBets.some((b) => b.net > 0)) covered.sideBetWin = true;
  check(staged >= 0, `${tag} : mises posées ${staged / 100}`);

  await page.getByRole('button', { name: 'Nouvelle manche' }).click();
  await page.waitForTimeout(150);
  return sum;
}

function total(cards) {
  let t = 0, aces = 0;
  for (const c of cards) {
    const r = c.slice(0, -1);
    if (r === 'A') { t += 1; aces++; }
    else if (['K', 'Q', 'J'].includes(r)) t += 10;
    else t += parseInt(r, 10);
  }
  if (aces && t + 10 <= 21) t += 10;
  return t;
}

const browser = await chromium.launch();

// ============ BUREAU ============
console.log('— Vérifications bureau (1440×900) —');
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await desktop.newPage();
page.on('pageerror', (e) => { failures++; console.error('  ✘ Erreur page :', e.message); });
await page.goto(BASE);
await page.waitForSelector('.lobby-brand h1');
await page.screenshot({ path: `${SHOTS}/01-lobby.png` });
check(true, 'lobby affiché');

await page.getByRole('button', { name: /Salon Émeraude/ }).click();
await page.waitForSelector('.betting-board');
await page.evaluate(() => window.__game.getState().setGameSpeed('fast'));
check((await state(page)).screen === 'table', 'entrée à la table Émeraude');

// --- système de mise : ajout, annulation, effacement, limites ---
await page.getByLabel('Jeton de 25', { exact: true }).click();
await page.getByLabel('Miser sur Main principale').click();
await page.getByLabel('Miser sur Main principale').click();
check((await state(page)).staged === 50_00, 'deux jetons de 25 posés (50)');
await page.getByLabel('Jeton de 5', { exact: true }).click();
await page.getByLabel('Miser sur Paires').click();
check((await state(page)).staged === 55_00, 'side bet Paires ajouté (5)');
await page.getByRole('button', { name: 'Annuler', exact: true }).click();
check((await state(page)).staged === 50_00, 'annulation du dernier jeton');
await page.getByRole('button', { name: 'Effacer', exact: true }).click();
check((await state(page)).staged === 0, 'effacement des mises');

// limite de zone : jeton 1K > max 500 sur la mise principale
await page.getByLabel('Jeton de 1 000', { exact: true }).click();
await page.getByLabel('Miser sur Main principale').click();
check((await state(page)).staged === 0, 'jeton au-dessus de la limite refusé');
await page.waitForSelector('.notice');
check(true, 'notice de limite affichée');

await page.screenshot({ path: `${SHOTS}/02-mises.png` });
await page.screenshot({ path: `${SHOTS}/desktop-arc.png` });

// --- manches jouées avec side bets et politiques variées ---
let played = 0;
const policies = [
  { split: true, double: true, insurance: 'take', surrender: false },
  { split: true, double: true, insurance: 'decline', surrender: false },
  { split: false, double: true, insurance: 'take', surrender: true },
];
const betsEachRound = [
  [['Main principale', '25', 2], ['Paires', '5', 1], ['21+3', '5', 1]],
  [['Main principale', '25', 1], ['Paires', '5', 1], ['21+3', '5', 1]],
  [['Main principale', '5', 2], ['21+3', '1', 2]],
];

for (let i = 0; i < 40; i++) {
  const bets = betsEachRound[i % betsEachRound.length];
  const policy = policies[i % policies.length];
  await playRound(page, { bets, policy }, `manche ${i + 1}`);
  played++;
  if (i === 2) await page.screenshot({ path: `${SHOTS}/03-resultat.png` });
  if (covered.split && covered.double && covered.insurance && played >= 8) break;
}
console.log('  couverture :', JSON.stringify(covered));

// --- remiser ---
const beforeRebet = await state(page);
await page.getByRole('button', { name: 'Remiser', exact: true }).click();
const afterRebet = await state(page);
check(afterRebet.staged > 0, `remiser restaure la mise précédente (${afterRebet.staged / 100})`);
check(beforeRebet.staged === 0, 'zones vides avant remise');

// capture d'une main en cours
await page.getByRole('button', { name: /^Distribuer/ }).click();
await waitPlayable(page);
await page.screenshot({ path: `${SHOTS}/04-en-jeu.png` });

// abandon si possible, sinon on termine la main proprement
for (let guard = 0; guard < 20; guard++) {
  const s = await state(page);
  if (s.resultsShown) break;
  if (s.phase === 'insurance') await page.getByRole('button', { name: 'Refuser' }).click();
  else if (s.phase === 'player') {
    if (s.actions.includes('surrender')) {
      covered.surrender = true;
      await page.getByRole('button', { name: /^Abandonner/ }).click();
    } else await page.getByRole('button', { name: /^Rester/ }).click();
  }
  await page.waitForTimeout(400);
}
await page.waitForFunction(() => window.__game.getState().display.resultsShown, null, { timeout: 25000 });
check(true, 'manche avec tentative d\u2019abandon terminée');

// --- panneaux ---
await page.getByLabel('Historique').click();
await page.waitForSelector('.round-item');
check(true, 'historique des manches rempli');
await page.getByRole('button', { name: 'Statistiques' }).click();
const roundsTxt = await page.locator('.stat-cell').first().textContent();
check(/\d/.test(roundsTxt), `statistiques affichées (${roundsTxt.replace('Manches', '').trim()} manches)`);
await page.getByRole('button', { name: 'Règles & paiements' }).click();
await page.waitForSelector('.paytable-block table');
const blocks = await page.locator('.paytable-block').count();
check(blocks >= 3, `tables de paiement affichées (${blocks} blocs)`);
await page.screenshot({ path: `${SHOTS}/05-paiements.png` });
await page.getByLabel('Fermer').click();

// persistance
const balBefore = (await state(page)).balance;
await page.reload();
await page.waitForSelector('.lobby-brand h1');
const balAfter = await page.evaluate(() => window.__game.getState().balance);
check(balAfter === balBefore, `persistance du solde après rechargement (${balAfter / 100})`);

await desktop.close();

// ============ MOBILE ============
console.log('— Vérifications mobile (390×844) —');
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
});
const mp = await mobile.newPage();
mp.on('pageerror', (e) => { failures++; console.error('  ✘ Erreur page mobile :', e.message); });
await mp.goto(BASE);
await mp.waitForSelector('.lobby-brand h1');
await mp.screenshot({ path: `${SHOTS}/06-mobile-lobby.png` });

await mp.getByRole('button', { name: /Salon Émeraude/ }).click();
await mp.waitForSelector('.betting-board');
await mp.evaluate(() => window.__game.getState().setGameSpeed('fast'));

// pas de débordement horizontal
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(overflow <= 0, `aucun débordement horizontal (${overflow}px)`);

await mp.getByLabel('Jeton de 5', { exact: true }).click();
await mp.getByLabel('Miser sur Main principale').click();
await mp.getByLabel('Miser sur Main principale').click();
await mp.getByLabel('Miser sur Bust It').click();
check((await state(mp)).staged === 15_00, 'mises posées au doigt (15)');
await mp.screenshot({ path: `${SHOTS}/07-mobile-mises.png` });

const mobileBefore = (await state(mp)).balance;
await mp.getByRole('button', { name: /^Distribuer/ }).click();
await waitPlayable(mp);
await mp.screenshot({ path: `${SHOTS}/08-mobile-en-jeu.png` });

for (let guard = 0; guard < 20; guard++) {
  const s = await state(mp);
  if (s.resultsShown) break;
  if (s.phase === 'insurance') await mp.getByRole('button', { name: 'Refuser' }).click();
  else if (s.phase === 'player') {
    const hand = s.hands[s.active];
    if (s.actions.includes('hit') && total(hand.cards) < 16) await mp.getByRole('button', { name: /^Tirer/ }).click();
    else await mp.getByRole('button', { name: /^Rester/ }).click();
  } else if (s.phase === 'settled') {
    await mp.waitForTimeout(200);
  }
  await mp.waitForTimeout(200);
}
await mp.waitForFunction(() => window.__game.getState().display.resultsShown, null, { timeout: 25000 });
const ms = await state(mp);
check(ms.balance === mobileBefore - ms.summary.totalWagered + ms.summary.totalReturned,
  `mobile : solde exact après la manche (${ms.balance / 100})`);
await mp.screenshot({ path: `${SHOTS}/09-mobile-resultat.png` });

// bouton visible dans le viewport (l'UI est réorganisée, pas juste réduite)
const btn = mp.getByRole('button', { name: 'Nouvelle manche' });
const box = await btn.boundingBox();
check(box && box.y + box.height <= 844 && box.x >= 0, 'actions accessibles dans le viewport mobile');

await mobile.close();
await browser.close();

console.log(covered.sideBetWin ? '  (au moins un side bet gagné pendant la session)' : '  (aucun side bet gagnant sur cette session — aléatoire)');
if (failures > 0) {
  console.error(`\n${failures} vérification(s) en échec`);
  process.exit(1);
}
console.log('\nToutes les vérifications E2E sont passées.');
