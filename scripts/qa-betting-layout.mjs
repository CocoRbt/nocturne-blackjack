/**
 * QA visuelle multi-places : portrait + paysage, captures + détection de chevauchements.
 * Usage : npm run dev puis node scripts/qa-betting-layout.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OUT = '/opt/cursor/artifacts/betting-qa';
mkdirSync(OUT, { recursive: true });

async function enterEmerald(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const g = window.__game;
    g.setState({
      balance: 500_00,
      peakBalance: 500_00,
      screen: 'lobby',
      round: null,
    });
  });
  await page.getByRole('button', { name: /Salon Émeraude/i }).click();
  await page.waitForSelector('.betting-board');
}

async function measureOverlaps(page) {
  return page.evaluate(() => {
    const rings = [...document.querySelectorAll('.focused-seat-bets .bet-spot .ring')];
    const tabs = [...document.querySelectorAll('.seat-tab')];
    const boxes = (els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
      });
    const ringBoxes = boxes(rings);
    const tabBoxes = boxes(tabs);
    let ringOverlaps = 0;
    for (let i = 0; i < ringBoxes.length; i++) {
      for (let j = i + 1; j < ringBoxes.length; j++) {
        const a = ringBoxes[i];
        const b = ringBoxes[j];
        const overlap =
          a.x < b.right - 2 && a.right > b.x + 2 && a.y < b.bottom - 2 && a.bottom > b.y + 2;
        if (overlap) ringOverlaps++;
      }
    }
    let tabOverlaps = 0;
    for (let i = 0; i < tabBoxes.length; i++) {
      for (let j = i + 1; j < tabBoxes.length; j++) {
        const a = tabBoxes[i];
        const b = tabBoxes[j];
        const overlap =
          a.x < b.right - 1 && a.right > b.x + 1 && a.y < b.bottom - 1 && a.bottom > b.y + 1;
        if (overlap) tabOverlaps++;
      }
    }
    const names = [...document.querySelectorAll('.focused-seat-bets .bet-spot .name')].map((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        text: el.textContent?.trim(),
        visible: style.visibility !== 'hidden' && style.display !== 'none' && r.width > 0,
        w: r.width,
        h: r.height,
      };
    });
    const tray = document.querySelector('.tray');
    const board = document.querySelector('.betting-board');
    let trayOverlap = false;
    if (tray && board) {
      const a = board.getBoundingClientRect();
      const b = tray.getBoundingClientRect();
      trayOverlap = a.bottom > b.top + 4 && a.top < b.bottom;
    }
    return {
      seatCapacity: window.__game.getState().seatCapacity,
      selectedSeat: window.__game.getState().selectedSeat,
      ringCount: rings.length,
      tabCount: tabs.length,
      ringOverlaps,
      tabOverlaps,
      trayOverlap,
      names,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  });
}

async function playQuickRound(page) {
  // Miser place 1 main, place 2 main + side, deal, stand jusqu'à résultats
  await page.getByRole('button', { name: /^Place 1/ }).click();
  await page.getByLabel('Jeton de 5', { exact: true }).click();
  await page.getByLabel(/Miser place 1 sur Main/i).click();
  await page.getByRole('button', { name: /^Place 2/ }).click();
  await page.getByLabel(/Miser place 2 sur Main/i).click();
  const side = page.getByLabel(/Miser place 2 sur 21/i);
  if (await side.count()) await side.click();
  await page.getByRole('button', { name: /Distribuer/i }).click();
  await page.waitForFunction(() => {
    const s = window.__game.getState();
    return s.round && !s.display.dealing;
  }, null, { timeout: 15000 });

  // Assurance éventuelle
  for (let i = 0; i < 8; i++) {
    const s = await page.evaluate(() => {
      const st = window.__game.getState();
      return { phase: st.round?.phase, results: st.display.resultsShown };
    });
    if (s.results) break;
    if (s.phase === 'insurance') {
      await page.getByRole('button', { name: /Refuser/i }).click();
      await page.waitForTimeout(200);
      continue;
    }
    if (s.phase === 'player') {
      const stand = page.getByRole('button', { name: /Rester/i });
      if (await stand.count()) await stand.click();
      else break;
      await page.waitForTimeout(250);
      continue;
    }
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => window.__game.getState().display.resultsShown, null, {
    timeout: 20000,
  }).catch(() => {});
}

async function runViewport(browser, name, size, isLandscape) {
  const context = await browser.newContext({
    viewport: size,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  // Forcer orientation côté store via resize + refreshSeatCapacity
  await enterEmerald(page);
  await page.evaluate((landscape) => {
    // Simule matchMedia landscape pour la capacité
    const g = window.__game.getState();
    // refresh via leave/enter after forcing capacity through orientation API if available
    window.__game.getState().refreshSeatCapacity?.();
    void g;
    void landscape;
  }, isLandscape);

  // Force capacity if orientation media doesn't match headless viewport semantics
  await page.evaluate((cap) => {
    const s = window.__game.getState();
    if (s.seatCapacity !== cap) {
      window.__game.setState({
        seatCapacity: cap,
        selectedSeat: Math.min(s.selectedSeat, cap - 1),
      });
    }
  }, isLandscape ? 7 : 5);

  await page.waitForTimeout(400);
  const before = await measureOverlaps(page);
  const shotBetting = join(OUT, `${name}-betting.png`);
  await page.screenshot({ path: shotBetting, fullPage: false });

  await playQuickRound(page);
  const shotPlay = join(OUT, `${name}-play.png`);
  await page.screenshot({ path: shotPlay, fullPage: false });

  await context.close();
  return { name, before, shotBetting, shotPlay };
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  results.push(await runViewport(browser, 'portrait', { width: 390, height: 844 }, false));
  results.push(await runViewport(browser, 'landscape', { width: 844, height: 390 }, true));
} finally {
  await browser.close();
}

const summary = results.map((r) => ({
  name: r.name,
  seatCapacity: r.before.seatCapacity,
  ringOverlaps: r.before.ringOverlaps,
  tabOverlaps: r.before.tabOverlaps,
  trayOverlap: r.before.trayOverlap,
  ringCount: r.before.ringCount,
  tabCount: r.before.tabCount,
  names: r.before.names,
  ok:
    r.before.ringOverlaps === 0 &&
    r.before.tabOverlaps === 0 &&
    !r.before.trayOverlap &&
    r.before.ringCount === 3,
}));

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

const failed = summary.filter((s) => !s.ok);
if (failed.length) {
  console.error('QA FAILED', failed);
  process.exit(1);
}
console.log('QA OK — pas de chevauchement détecté');
