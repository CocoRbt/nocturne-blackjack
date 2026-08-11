/**
 * Contrôle Stampede : comptabilité des spins (base + tours gratuits)
 * et captures d’écran bureau / mobile. Nécessite `npm run dev`.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SLOTS_BASE ?? 'http://127.0.0.1:5174';
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

const state = (page) =>
  page.evaluate(() => {
    const s = window.__game.getState();
    return { balance: s.balance, screen: s.screen, gamesPlayed: s.gamesPlayed };
  });

const settled = (page) =>
  page.evaluate(() => document.querySelectorAll('.slots-reel.is-spinning').length === 0);

async function waitSettled(page) {
  for (let i = 0; i < 120; i++) {
    if (await settled(page)) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

async function inBonus(page) {
  return (await page.locator('.slots-fs-banner').count()) > 0;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => {
  failures++;
  console.error('  ✘ erreur JS :', e.message);
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => window.__game.getState().resetAll());
await page.waitForTimeout(300);

console.log('Lobby → Stampede');
await page.locator('.slots-card').click();
await page.waitForSelector('.slots-reels');
check((await state(page)).screen === 'slots', 'écran slots actif');
check((await page.locator('.slots-reel').count()) === 5, '5 rouleaux rendus');
check((await page.locator('.slots-cell').count()) === 20, '20 cases (5 × 4)');
await page.screenshot({ path: `${SHOTS}/slots-desktop-idle.png` });

console.log('Spins de base');
await page.locator('.slots-panel .slots-chip', { hasText: '5' }).first().click();
let bonusSeen = false;
for (let i = 0; i < 14; i++) {
  const before = await state(page);
  if (before.balance < 100) break;
  const cta = page.locator('.slots-panel .slots-cta');
  if (await cta.isDisabled()) {
    console.log(`  · bouton désactivé au tour ${i + 1} (solde ${before.balance})`);
    break;
  }
  await cta.click();
  const spinning = await page
    .locator('.slots-reel.is-spinning')
    .first()
    .waitFor({ timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  check(spinning, `spin ${i + 1} : rouleaux en rotation`);
  check(await waitSettled(page), `spin ${i + 1} : rouleaux arrêtés`);
  // Le règlement arrive un instant après le dernier rouleau.
  await page
    .waitForFunction(
      () => {
        const b = document.querySelector('.slots-panel .slots-cta');
        return document.querySelector('.slots-fs-banner') || (b && !b.disabled);
      },
      { timeout: 6000 },
    )
    .catch(() => {});
  // Le bandeau de gain se monte via AnimatePresence : on attend son rendu.
  await page
    .waitForFunction(() => document.querySelector('.slots-win strong, .slots-win.is-empty'), {
      timeout: 4000,
    })
    .catch(() => {});
  const payout = await page.evaluate(() => {
    const el = document.querySelector('.slots-win strong');
    if (!el) return 0;
    return Math.round(
      Number(el.textContent.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '')) * 100,
    );
  });
  const after = await state(page);
  const expected = before.balance - 500 + payout;
  check(
    after.balance === expected,
    `spin ${i + 1} : ${before.balance} − 500 + ${payout} = ${after.balance} (attendu ${expected})`,
  );
  if (await inBonus(page)) {
    bonusSeen = true;
    console.log('  · tours gratuits déclenchés');
    await page.screenshot({ path: `${SHOTS}/slots-desktop-freespins.png` });
    const balanceAtBonus = after.balance;
    // Le bonus s’enchaîne seul : la nav doit rester bloquée et rien n’est débité.
    check(
      await page.locator('.game-shell-back').isDisabled(),
      'bonus : retour lobby verrouillé',
    );
    let guard = 0;
    while ((await inBonus(page)) && guard < 400) {
      guard += 1;
      await page.waitForTimeout(250);
    }
    const afterBonus = await state(page);
    check(
      afterBonus.balance >= balanceAtBonus,
      `bonus : aucun débit (${balanceAtBonus} → ${afterBonus.balance})`,
    );
    break;
  }
}
if (!bonusSeen) console.log('  · pas de bonus sur cette série (normal)');

console.log('Règles + retour lobby');
await page.locator('.game-topbar .icon-btn').click();
await page.waitForSelector('.rules-guide-panel.tone-slots');
await page.screenshot({ path: `${SHOTS}/slots-desktop-rules.png` });
await page.locator('.rules-guide-foot .btn').click();
await page.waitForTimeout(250);
await page.locator('.game-shell-back').click();
await page.waitForTimeout(300);
check((await state(page)).screen === 'lobby', 'retour lobby OK');
await page.screenshot({ path: `${SHOTS}/slots-lobby-card.png`, fullPage: true });

console.log('Mobile');
const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await mobile.goto(BASE, { waitUntil: 'networkidle' });
await mobile.locator('.slots-card').click();
await mobile.waitForSelector('.slots-reels');
await mobile.locator('.slots-dock .slots-cta').click();
await mobile.waitForTimeout(2600);
await mobile.screenshot({ path: `${SHOTS}/slots-mobile.png` });
const overflow = await mobile.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check(overflow <= 1, `pas de débordement horizontal mobile (${overflow}px)`);

console.log('Bonus forcé (RNG bridé sur un arrêt à 3 médailles)');
const rigged = await browser.newPage({ viewport: { width: 1280, height: 900 } });
rigged.on('pageerror', (e) => {
  failures++;
  console.error('  ✘ erreur JS :', e.message);
});
await rigged.addInitScript(() => {
  // 0,355 × 40 → arrêt 14 sur chaque bande : 3 médailles en base game.
  const fixed = Math.round(0.355 * 4294967296);
  const native = crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues = (arr) => {
    if (arr instanceof Uint32Array) {
      arr.fill(fixed);
      return arr;
    }
    return native(arr);
  };
});
await rigged.goto(BASE, { waitUntil: 'networkidle' });
await rigged.locator('.slots-card').click();
await rigged.waitForSelector('.slots-reels');
const beforeBonus = await state(rigged);
await rigged.locator('.slots-panel .slots-cta').click();
await rigged.waitForSelector('.slots-fs-banner', { timeout: 15_000 });
check(true, 'tours gratuits déclenchés');
check(await rigged.locator('.game-shell-back').isDisabled(), 'retour lobby verrouillé');
check(
  await rigged.locator('.slots-panel .slots-cta').isDisabled(),
  'bouton lancer verrouillé pendant le bonus',
);
await rigged.waitForSelector('.slots-herd', { timeout: 15_000 });
await rigged.waitForTimeout(1800);
await rigged.screenshot({ path: `${SHOTS}/slots-desktop-freespins.png` });
const debitDuringBonus = await rigged.evaluate(() => window.__game.getState().balance);
let guard = 0;
while ((await rigged.locator('.slots-fs-banner:not(.is-summary)').count()) > 0 && guard < 200) {
  guard += 1;
  await rigged.waitForTimeout(250);
}
const afterBonus = await state(rigged);
check(
  afterBonus.balance > debitDuringBonus,
  `bonus crédité sans débit (${debitDuringBonus} → ${afterBonus.balance})`,
);
check(
  afterBonus.balance > beforeBonus.balance - 500,
  'aucune mise supplémentaire prélevée pendant le bonus',
);
await rigged.waitForTimeout(400);
await rigged.screenshot({ path: `${SHOTS}/slots-desktop-bonus-summary.png` });

const riggedMobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await riggedMobile.addInitScript(() => {
  const fixed = Math.round(0.355 * 4294967296);
  const native = crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues = (arr) => {
    if (arr instanceof Uint32Array) {
      arr.fill(fixed);
      return arr;
    }
    return native(arr);
  };
});
await riggedMobile.goto(BASE, { waitUntil: 'networkidle' });
await riggedMobile.locator('.slots-card').click();
await riggedMobile.waitForSelector('.slots-reels');
await riggedMobile.locator('.slots-dock .slots-cta').click();
await riggedMobile.waitForSelector('.slots-herd', { timeout: 15_000 });
await riggedMobile.waitForTimeout(1500);
await riggedMobile.screenshot({ path: `${SHOTS}/slots-mobile-freespins.png` });

await browser.close();
console.log(failures === 0 ? '\nTout est vert.' : `\n${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
