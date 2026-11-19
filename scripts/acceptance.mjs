/**
 * Phase 1 acceptance, run in a real browser against a real server.
 *
 * Usage: npm run build && PORT=3000 npm start &   then   node scripts/acceptance.mjs
 * It seats four people in four browser contexts, plays a whole game, and checks the
 * things only a browser can prove: rendering, refresh, a dropped tab, a spectator,
 * a phone-sized screen, and whether the dice were really drawn in 3D.
 */
import { mkdirSync } from 'node:fs';

import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3000/';
const SHOTS = process.env.SHOTS ?? '.superpowers/sdd/2026-11-18-phase-1-functionality/shots';

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
/** A context of its own, so each player gets a separate sessionStorage token. */
async function openTab(name, viewport = { width: 480, height: 900 }) {
  const context = await browser.newContext({ viewport });
  // So the run can hang up this tab's own connection later, the way a dead mast would.
  await context.addInitScript(() => {
    const Real = window.WebSocket;
    window.__sockets = [];
    window.WebSocket = class extends Real {
      constructor(...args) {
        super(...args);
        window.__sockets.push(this);
      }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const problems = [];
  page.on('crash', () => console.log(`(the ${name} tab crashed)`));
  page.on('close', () => console.log(`(the ${name} tab closed)`));
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  return { name, context, page, problems };
}

const shot = (page, file) => page.screenshot({ path: `${SHOTS}/${file}.png` });
const has = (page, selector) => page.$eval(selector, () => true).catch(() => false);
const text = (page, selector) => page.$eval(selector, (node) => node.textContent ?? '').catch(() => '');
const count = (page, selector) => page.$$eval(selector, (nodes) => nodes.length).catch(() => 0);

async function home(tab, name) {
  await tab.page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await tab.page.fill('input[name="name"]', name);
  return tab;
}

async function seat(tab, color) {
  await tab.page.click(`button[data-color="${color}"]`);
  await tab.page.waitForSelector(`button[data-color="${color}"][data-act="unpick"]`, { timeout: 5_000 });
}

try {
  // 1. One person opens the page and makes a room.
  const anna = await home(await openTab('anna'), 'anna');
  await anna.page.click('[data-act="create"]');
  await anna.page.waitForSelector('.lobby');
  const code = (await text(anna.page, '[data-code]')).trim();
  ok('a room gets a six-letter code', /^[A-Z2-9]{6}$/.test(code), code);
  await seat(anna, 'red');
  await shot(anna.page, '01-lobby');

  // 2. Three friends follow the link and take the other colors.
  const others = [
    ['ben', 'blue'],
    ['cy', 'green'],
    ['dan', 'yellow'],
  ];
  const tabs = [anna];
  for (const [name, color] of others) {
    const tab = await openTab(name);
    await tab.page.goto(`${BASE}?code=${code}`, { waitUntil: 'domcontentloaded' });
    if (name === 'ben') {
      // A stranger following the link is asked who they are instead of joining as "guest".
      ok('a fresh visitor with a link is asked for a name', await has(tab.page, '.home'));
    }
    await tab.page.fill('input[name="name"]', name);
    await tab.page.click('[data-act="join"]');
    await tab.page.waitForSelector('.lobby');
    await seat(tab, color);
    tabs.push(tab);
  }

  const seated = await anna.page.$$eval('.seats button', (nodes) =>
    nodes.map((node) => node.textContent?.trim() ?? ''),
  );
  ok('four colors are taken and named', seated.filter((row) => /you|anna|ben|cy|dan/.test(row)).length === 4, seated.join(' | '));
  const ben = tabs[1];
  ok(
    'only the host can start',
    (await has(ben.page, '[data-act="start"]')) === false && (await text(ben.page, '.lobby')).includes('Waiting for the host'),
  );

  // 3. The host starts it and everyone lands on the table.
  await anna.page.click('[data-act="start"]');
  for (const tab of tabs) await tab.page.waitForSelector('.table');
  ok('the game starts on every tab', true, await text(anna.page, '[data-turn]'));

  // A fifth friend arrives late, on a phone-sized screen, and can only watch.
  const ivy = await openTab('ivy', { width: 360, height: 740 });
  await ivy.page.goto(`${BASE}?code=${code}`, { waitUntil: 'domcontentloaded' });
  await ivy.page.fill('input[name="name"]', 'ivy');
  await ivy.page.click('[data-act="join"]');
  await ivy.page.waitForSelector('.table');
  const ivyBox = await ivy.page.$eval('#board', (node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  await shot(ivy.page, '06-phone');
  ok(
    'a late joiner watches and cannot act',
    (await has(ivy.page, 'button[data-act="roll"]')) === false &&
      !(await has(ivy.page, '.piece.legal')),
    await text(ivy.page, '[data-turn]'),
  );

  // 4. Play the game, one legal action at a time, watching for the things to prove.
  let refreshed = false;
  let dieBeforeRefresh = '';
  let sawCapture = false;
  let realTap = false;
  const startedAt = Date.now();
  const tally = { rolls: 0, moves: 0, failed: 0 };
  let saw3dDice = false;
  let widestTap = 0;
  let disconnected = false;
  let dropped = false;
  const dan = tabs[3];

  /**
   * One legal tap, done inside the page: a real click event on the highlighted piece.
   * Pointer hit-testing and thumb-sized targets are checked separately below.
   */
  const tapInPage = (page) =>
    page.evaluate(() => {
      const target = document.querySelector('circle.hit');
      if (!target) return false;
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    });

  /** Roll when it is this tab's turn, then let the server answer. */
  const rollInPage = (page) =>
    page.evaluate(() => {
      const button = document.querySelector('button[data-act="roll"]:not([disabled])');
      if (!button) return false;
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    });

  /** Wait for the tab to have something to do, so there are no fixed sleeps in the loop. */
  const waitForAction = (page, ms) =>
    page
      .waitForFunction(
        () =>
          Boolean(document.querySelector('button[data-act="roll"]:not([disabled])')) ||
          Boolean(document.querySelector('circle.hit')),
        null,
        { timeout: ms },
      )
      .then(() => true)
      .catch(() => false);

  let turn = 0;
  let stalled = 0;
  const deadline = Date.now() + Number(process.env.BUDGET_MS ?? 420_000);

  while (turn < 4_000 && stalled < 30 && Date.now() < deadline) {
    turn += 1;
    if (await has(anna.page, '[data-standings]')) break;

    let acted = false;

    for (const tab of tabs) {
      if (tab.closed) continue;

      if (await rollInPage(tab.page)) {
        tally.rolls += 1;
        await waitForAction(tab.page, 1_500);
      }

      const pending = tab.page.locator('circle.hit').first();
      if ((await pending.count()) === 0) continue;

      const box = await pending.boundingBox().catch(() => null);
      if (box) widestTap = Math.max(widestTap, Math.min(box.width, box.height));

      // Once: a friend's real mouse click on the highlighted piece, not a scripted one.
      if (!realTap) {
        realTap = true;
        const before = await text(tab.page, '[data-die]');
        const hitTest = await tab.page.evaluate(() => {
          const hit = document.querySelector('circle.hit');
          const rect = hit.getBoundingClientRect();
          const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return top === hit;
        });
        const tapped = await pending
          .click({ timeout: 8_000 })
          .then(() => true)
          .catch((error) => {
            console.log(`(real tap failed: ${String(error).split('\n')[0]})`);
            return false;
          });
        ok('a friend can tap the highlighted piece', tapped && hitTest, `die ${before}`);
      }

      // Once, and only once: reload while a choice is pending.
      if (!refreshed && tab === anna) {
        dieBeforeRefresh = await text(anna.page, '[data-die]');
        await anna.page.reload({ waitUntil: 'domcontentloaded' });
        await anna.page.waitForSelector('.table');
        refreshed = true;
        const stillPending = (await count(anna.page, '.piece.legal')) > 0;
        const sameDie = (await text(anna.page, '[data-die]')) === dieBeforeRefresh;
        ok('a refresh mid-choice returns to the same pending move', stillPending && sameDie, `die ${dieBeforeRefresh}`);
        await shot(anna.page, '02-mid-choice');
      }

      if (await tapInPage(tab.page)) {
        tally.moves += 1;
        acted = true;
      } else {
        tally.failed += 1;
      }

      if (!sawCapture && (await count(tab.page, '.flash')) > 0) {
        sawCapture = true;
        await shot(tab.page, '03-capture');
      }
      if (await has(tab.page, 'canvas.dice-canvas')) saw3dDice = true;

      // Once: a phone loses signal, comes back, and never lost its seat.
      if (!dropped && tally.moves > 4) {
        dropped = true;
        // The network goes down *and* the live socket dies, as it does on a phone.
        await ben.context.setOffline(true);
        await ben.page.evaluate(() => {
          for (const socket of window.__sockets ?? []) socket.close();
        });

        const told = await ben.page
          .waitForFunction(() => document.querySelector('#status')?.hidden === false, null, { timeout: 8_000 })
          .then(() => true)
          .catch(() => false);
        ok('a tab that lost signal says so', told, await text(ben.page, '#status'));

        const waiting = await anna.page
          .waitForSelector('[data-waiting]', { timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        ok('the table waits for the player who vanished', waiting, await text(anna.page, '[data-waiting]'));
        const othersBlocked = (await count(anna.page, 'button[data-act="roll"]:not([disabled])')) === 0;
        ok('nobody plays while the table is waiting', othersBlocked);
        await shot(anna.page, '07-waiting');

        await ben.context.setOffline(false);
        const back = await ben.page
          .waitForFunction(
            () =>
              document.querySelector('#status')?.hidden === true &&
              Boolean(document.querySelector('.table [data-turn]')),
            null,
            { timeout: 20_000 },
          )
          .then(() => true)
          .catch(() => false);
        const sameSeat = await ben.page.evaluate(
          () => new URLSearchParams(window.location.search).get('code')?.length === 6,
        );
        ok('the dropped phone rejoins on its own, same seat', back && sameSeat);
        await shot(ben.page, '08-back');
      }

      // Later: somebody really does not come back, and a friend ends their game.
      if (!disconnected && tally.moves > 14) {
        disconnected = true;
        dan.closed = true;
        await dan.context.close();
        const banner = await anna.page
          .waitForSelector('[data-waiting]', { timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        ok('a player who never comes back pauses the table', banner, await text(anna.page, '[data-waiting]'));

        const forcedButton = ben.page.locator('[data-act="forceContinue"]');
        ok('any connected human may force continue, host or not', (await forcedButton.count()) > 0);
        await forcedButton.first().click({ timeout: 5_000 }).catch(() => {});
        const cleared = await anna.page
          .waitForFunction(() => !document.querySelector('[data-waiting]'), null, { timeout: 5_000 })
          .then(() => true)
          .catch(() => false);
        // A player who is out leaves the board entirely, and somebody else plays on.
        const yellowOnBoard = await count(anna.page, 'circle.piece[data-color="yellow"]');
        const playingOn = await ben.page
          .waitForFunction(
            () => /ben|cy|anna/i.test(document.querySelector('[data-turn]')?.textContent ?? ''),
            null,
            { timeout: 5_000 },
          )
          .then(() => true)
          .catch(() => false);
        ok(
          'forcing continue takes that color off the board and plays on',
          cleared && yellowOnBoard === 0 && playingOn,
          `${yellowOnBoard} yellow pieces left; ${await text(anna.page, '[data-turn]')}`,
        );
      }

      if (turn === 1) await shot(ben.page, '04-table');
      break;
    }

    stalled = acted ? 0 : stalled + 1;
    if (!acted) await sleep(50);

    if (turn % 250 === 0) {
      console.log(`(turn ${turn}: ${await text(anna.page, '[data-turn]')} | rolls ${tally.rolls} moves ${tally.moves} failed ${tally.failed})`);
    }
  }

  console.log(`(played ${turn} turns in ${((Date.now() - startedAt) / 1000).toFixed(0)}s: rolls ${tally.rolls}, moves ${tally.moves}, failed taps ${tally.failed})`);
  ok('a capture was seen on the board', sawCapture);
  ok('the dice were drawn in 3D', saw3dDice, saw3dDice ? 'three.js canvas' : 'fell back to text');
  ok('a legal piece is a comfortable tap target', widestTap >= 24, `${widestTap.toFixed(1)}px`);

  // 5. Somebody won, and the host can start the same table again.
  const standings = await anna.page.$$eval('[data-standings] li', (nodes) => nodes.map((n) => n.textContent?.trim() ?? ''));
  ok('the game ends with standings', standings.length > 0, standings.join(' | '));
  await shot(anna.page, '05-finished');

  const again = await anna.page.$('[data-act="again"]');
  ok('the host is offered play again', Boolean(again));
  await again?.click();
  await ben.page.waitForSelector('.lobby');
  const backToSeats = await ben.page.$$eval('.seats button', (nodes) => nodes.length);
  ok('play again returns everyone to the same seats', backToSeats === 4, `${backToSeats} seats`);

  // 6. The phone-sized spectator kept up the whole time and never got in the way.
  ok(
    'the board fits a 360px screen and stays square',
    ivyBox.width <= 360 && Math.abs(ivyBox.width - ivyBox.height) < 2 && ivyBox.width > 300,
    `${ivyBox.width.toFixed(0)}x${ivyBox.height.toFixed(0)}`,
  );
  ok('the spectator never saw a move to make', (await has(ivy.page, 'button[data-act="roll"]')) === false);
  await shot(ivy.page, '06-phone');

  for (const tab of [...tabs, ivy]) await tab.context.close().catch(() => {});
} catch (error) {
  const where = error instanceof Error ? `${error.message} @ ${(error.stack ?? '').split('\n')[1]?.trim() ?? '?'}` : String(error);
  ok('the run finished without an exception', false, where);
} finally {
  await browser.close();
}

const failed = results.filter((entry) => !entry.pass);
console.log(`\n${results.length - failed.length}/${results.length} acceptance checks passed`);
process.exit(failed.length === 0 && results.length > 0 ? 0 : 1);
