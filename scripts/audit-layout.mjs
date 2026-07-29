/**
 * Audit visuel layout table — injecte des états mock via __game pour tester
 * 2/5/8 cartes, split 4 mains, sans toucher au moteur.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const OUT = 'verify/audit';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '390x844', width: 390, height: 844, mobile: true },
];

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function mockCards(n, prefix = 'p') {
  return Array.from({ length: n }, (_, i) => ({
    rank: RANKS[i % RANKS.length],
    suit: SUITS[i % SUITS.length],
    id: `${prefix}-${i}`,
  }));
}

const SCENARIOS = {
  betting: { mode: 'betting' },
  deal2: { mode: 'play', playerCards: 2, dealerCards: 2 },
  player5: { mode: 'play', playerCards: 5, dealerCards: 2 },
  player8: { mode: 'play', playerCards: 8, dealerCards: 2 },
  dealer8: { mode: 'play', playerCards: 2, dealerCards: 8, holeShown: true },
  split4: { mode: 'split', hands: [2, 3, 4, 5] },
  longBets: { mode: 'betting', longAmounts: true },
  result: { mode: 'result' },
};

async function inject(page, scenario) {
  await page.evaluate((sc) => {
    const g = window.__game;
    g.setState({ screen: 'table', tableId: 'emeraude', notice: null });
    const s = g.getState();
    if (sc.mode === 'betting') {
      const stacks = {
        main: sc.longAmounts ? [500_00, 500_00, 500_00] : [25_00, 25_00],
        perfectPairs: sc.longAmounts ? [100_00, 100_00] : [5_00],
        twentyOnePlusThree: [],
        luckyLadies: [],
        bustIt: [],
        royalMatch: [],
      };
      g.setState({
        round: null,
        stacks,
        placementOrder: ['main', 'main', 'perfectPairs'],
        display: {
          dealing: false,
          holeShown: false,
          dealerShown: 0,
          resultsShown: false,
          payoutPhase: 'idle',
          payoutFlies: [],
          dealFlashIds: [],
          animatedNet: 0,
        },
      });
      return;
    }

    const mkHand = (cards, bet = 25_00) => ({
      cards,
      bet,
      fromSplit: false,
      fromSplitAces: false,
      doubled: false,
      surrendered: false,
      stood: false,
      settledEarly: false,
    });

    const pc = (n) =>
      Array.from({ length: n }, (_, i) => ({
        rank: ['2', '3', '4', '5', '6', '7', '8', '9'][i % 8],
        suit: ['♠', '♥', '♦', '♣'][i % 4],
        id: `p${i}`,
      }));
    const dc = (n) =>
      Array.from({ length: n }, (_, i) => ({
        rank: ['10', 'J', 'Q', 'K', 'A', '9', '8', '7'][i % 8],
        suit: ['♣', '♦', '♥', '♠'][i % 4],
        id: `d${i}`,
      }));

    if (sc.mode === 'split') {
      const hands = sc.hands.map((n, i) => mkHand(pc(n).map((c) => ({ ...c, id: `${c.id}-h${i}` })), 25_00 * (i + 1)));
      const round = {
        phase: 'player',
        activeHandIndex: 0,
        hands,
        dealerCards: dc(2),
        holeRevealed: false,
        result: null,
        availableActions: () => ['hit', 'stand'],
      };
      g.setState({
        round,
        display: {
          dealing: false,
          holeShown: false,
          dealerShown: 2,
          resultsShown: false,
          payoutPhase: 'idle',
          payoutFlies: [],
          dealFlashIds: [],
          animatedNet: 0,
        },
        v: s.v + 1,
      });
      return;
    }

    if (sc.mode === 'result') {
      g.setState({
        round: {
          phase: 'settled',
          activeHandIndex: 0,
          hands: [mkHand(pc(2))],
          dealerCards: dc(3),
          holeRevealed: true,
          result: {
            hands: [{ handIndex: 0, outcome: 'win', bet: 25_00, returned: 50_00, net: 25_00 }],
            sideBets: [
              { id: 'perfectPairs', bet: 5_00, label: 'Paire mixte', paysMultiplier: 6, returned: 35_00, net: 30_00 },
            ],
            insurance: null,
            dealerCards: dc(3),
            dealerTotal: 19,
            dealerBust: false,
            dealerBlackjack: false,
            totalReturned: 85_00,
            totalNet: 55_00,
            totalWagered: 30_00,
          },
        },
        display: {
          dealing: false,
          holeShown: true,
          dealerShown: 3,
          resultsShown: true,
          payoutPhase: 'done',
          payoutFlies: [],
          dealFlashIds: [],
          animatedNet: 55_00,
        },
        v: s.v + 1,
      });
      return;
    }

    g.setState({
      round: {
        phase: 'player',
        activeHandIndex: 0,
        hands: [mkHand(pc(sc.playerCards))],
        dealerCards: dc(sc.dealerCards),
        holeRevealed: !!sc.holeShown,
        result: null,
        availableActions: () => ['hit', 'stand'],
      },
      display: {
        dealing: false,
        holeShown: !!sc.holeShown,
        dealerShown: sc.dealerCards,
        resultsShown: false,
        payoutPhase: 'idle',
        payoutFlies: [],
        dealFlashIds: [],
        animatedNet: 0,
      },
      v: s.v + 1,
    });
  }, scenario);
}

async function measure(page) {
  return page.evaluate(() => {
    const issues = [];
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (document.documentElement.scrollWidth > vw + 1) {
      issues.push(`scroll horizontal ${document.documentElement.scrollWidth - vw}px`);
    }
    const clip = (el, label) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.left < -2 || r.right > vw + 2 || r.top < -2 || r.bottom > vh + 2) {
        issues.push(`${label} hors viewport (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})`);
      }
    };
    document.querySelectorAll('.card-outer').forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const parent = el.closest('.hand .cards');
      if (parent) {
        const pr = parent.getBoundingClientRect();
        if (r.right > pr.right + 4 || r.left < pr.left - 4) {
          issues.push(`carte ${i} déborde conteneur mains`);
        }
      }
      clip(el, `carte-${i}`);
    });
    ['.topbar', '.tray', '.action-bar', '.result-tray', '.betting-board'].forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) clip(el, sel);
    });
    const stage = document.querySelector('.stage');
    if (stage && getComputedStyle(stage).overflow === 'hidden') {
      const cards = [...document.querySelectorAll('.card-outer')];
      if (cards.some((c) => {
        const r = c.getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        return r.top < sr.top - 1 || r.bottom > sr.bottom + 1 || r.left < sr.left - 1 || r.right > sr.right + 1;
      })) {
        issues.push('cartes rognées par .stage overflow:hidden');
      }
    }
    return { issues, cardCount: document.querySelectorAll('.card-outer').length };
  });
}

const browser = await chromium.launch();
const report = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: !!vp.mobile,
  });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByRole('button', { name: /Salon Émeraude/ }).click();
  await page.waitForSelector('.table-screen');

  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    await inject(page, scenario);
    await page.waitForTimeout(300);
    const { issues, cardCount } = await measure(page);
    const file = `${OUT}/${vp.name}-${name}.png`;
    await page.screenshot({ path: file, fullPage: false });
    report.push({ viewport: vp.name, scenario: name, cardCount, issues, screenshot: file });
    if (name === 'betting') {
      await page.getByRole('button', { name: 'Historique' }).click().catch(() => {});
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/${vp.name}-drawer-history.png` });
      await page.getByRole('button', { name: 'Fermer' }).click().catch(() => {});
      await page.waitForTimeout(200);
    }
  }
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
const summary = report.filter((r) => r.issues.length > 0);
console.log('=== Problèmes détectés ===');
for (const r of summary) {
  console.log(`${r.viewport} / ${r.scenario}:`, r.issues.join('; '));
}
console.log(`\n${summary.length} scénarios avec issues sur ${report.length}`);
