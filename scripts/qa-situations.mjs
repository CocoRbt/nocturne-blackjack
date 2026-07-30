/**
 * QA situations critiques : assurance (centrage), rythme de donne, portrait/paysage.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OUT = '/opt/cursor/artifacts/situations-qa';
mkdirSync(OUT, { recursive: true });

async function goTable(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.__game.setState({
      balance: 500_00,
      peakBalance: 500_00,
      screen: 'lobby',
      round: null,
      gameSpeed: 'classic',
    });
  });
  await page.getByRole('button', { name: /Salon Émeraude/i }).click();
  await page.waitForSelector('.table-screen');
}

function panelMetrics(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.insurance-panel');
    if (!panel) return null;
    const r = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    const text = panel.textContent || '';
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      right: r.right,
      bottom: r.bottom,
      vw: innerWidth,
      vh: innerHeight,
      fullyVisible:
        r.left >= -1 &&
        r.top >= -1 &&
        r.right <= innerWidth + 1 &&
        r.bottom <= innerHeight + 1,
      hasRefuse: /Refuser/i.test(text),
      hasAssure: /Assurance/i.test(text),
      truncatedLook: style.overflow === 'hidden' && r.width < 200,
    };
  });
}

async function runInsurance(browser, name, size) {
  const context = await browser.newContext({
    viewport: size,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await goTable(page);
  await page.evaluate(() => window.__game.getState().qaForceInsurance());
  await page.waitForSelector('.insurance-panel', { timeout: 5000 });
  await page.waitForTimeout(400);
  const metrics = await panelMetrics(page);
  await page.screenshot({ path: join(OUT, `${name}-insurance.png`) });
  // Refuser place 1 puis place 2
  await page.getByRole('button', { name: /Refuser/i }).click();
  await page.waitForTimeout(300);
  if (await page.locator('.insurance-panel').count()) {
    await page.getByRole('button', { name: /Refuser/i }).click();
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${name}-after-insurance.png`) });
  await context.close();
  return { name, metrics };
}

async function runDealTiming(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await goTable(page);
  await page.evaluate(() => {
    window.__game.setState({ gameSpeed: 'classic' });
  });
  await page.getByLabel('Jeton de 5', { exact: true }).click();
  await page.getByRole('button', { name: /^Place 1/ }).click();
  await page.getByLabel(/Miser place 1 sur Main/i).click();
  const t0 = Date.now();
  await page.getByRole('button', { name: /Distribuer/i }).click();
  await page.waitForFunction(() => {
    const s = window.__game.getState();
    return s.round && !s.display.dealing;
  }, null, { timeout: 15000 });
  const elapsed = Date.now() - t0;
  await page.screenshot({ path: join(OUT, 'portrait-deal-done.png') });
  await context.close();
  // 1 seat = 4 cards → classic dealUnlock ~2100ms minimum
  return { elapsed, ok: elapsed >= 1800 };
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  results.push(await runInsurance(browser, 'portrait', { width: 390, height: 844 }));
  results.push(await runInsurance(browser, 'landscape', { width: 844, height: 390 }));
  results.push({ name: 'dealTiming', ...(await runDealTiming(browser)) });
} finally {
  await browser.close();
}

const summary = results.map((r) => {
  if (r.name === 'dealTiming') return r;
  const m = r.metrics;
  return {
    name: r.name,
    fullyVisible: m?.fullyVisible ?? false,
    hasRefuse: m?.hasRefuse ?? false,
    hasAssure: m?.hasAssure ?? false,
    width: m?.w,
    right: m?.right,
    vw: m?.vw,
    ok: Boolean(m?.fullyVisible && m?.hasRefuse && m?.hasAssure),
  };
});

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

const failed = summary.filter((s) => s.ok === false);
if (failed.length) {
  console.error('QA FAILED', failed);
  process.exit(1);
}
console.log('SITUATIONS QA OK');
