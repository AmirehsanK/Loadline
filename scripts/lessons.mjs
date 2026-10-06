/* global document -- the functions given to the page run in the page, not here */

// Follows the guide's lesson on every level by hand, in the editor, and checks what it earns.
//
//   npm run build -w @loadline/web
//   npm run preview -w @loadline/web -- --port 5184     (in another terminal)
//   npm run lessons
//
// Each entry below is the steps of a lesson (apps/web/src/i18n/guide.en.ts) as a person would
// carry them out: add a part, draw a connection, select something, type into a setting by the
// name the inspector gives it. Then the level is run, and it has to be passed with three stars.
//
// The reference design of a level proves that the level can be solved. This proves something else:
// that the steps a reader is given can be followed in the editor, in the order they are given, and
// that they lead there. It caught a lesson that said to draw a connection the editor refuses.
//
// It drives a browser that is already installed (Edge, or Chrome with BROWSER=chrome).

import { chromium } from 'playwright-core';

const BASE = process.env.LOADLINE_URL ?? 'http://localhost:5184';
const only = process.argv.slice(2);

const browser = await chromium.launch({ channel: process.env.BROWSER === 'chrome' ? 'chrome' : 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-US' });
const page = await context.newPage();
const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));

const pause = (ms) => page.waitForTimeout(ms);
// By its whole name: Shop is not Shoppers.
const part = (name) => page.locator('.react-flow__node').filter({ has: page.getByText(name, { exact: true }) }).first();
const centre = async (locator) => {
  const box = await locator.boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
};

/** Presses a part in the list of parts that may be added, and moves the new part clear of the rest. */
async function add(kind, name, x, y) {
  const before = await page.locator('.react-flow__node').count();
  await page.getByRole('button', { name: new RegExp(`^${kind}`) }).click();
  await page.waitForFunction((count) => document.querySelectorAll('.react-flow__node').length === count + 1, before);
  const [fromX, fromY] = await centre(part(name));
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX + 10, fromY + 10, { steps: 3 });
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
  await pause(250);
}

/** Draws a connection from one part to another, handle to handle. */
async function connect(from, to) {
  const before = await page.locator('.react-flow__edge').count();
  const [fromX, fromY] = await centre(part(from).locator('.react-flow__handle.source'));
  const [toX, toY] = await centre(part(to).locator('.react-flow__handle.target'));
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX + 12, fromY + 6, { steps: 4 });
  await page.mouse.move(toX - 12, toY, { steps: 12 });
  await page.mouse.move(toX, toY, { steps: 4 });
  await pause(120);
  await page.mouse.up();
  await pause(250);
  if ((await page.locator('.react-flow__edge').count()) !== before + 1) throw new Error(`the editor did not draw a connection from ${from} to ${to}`);
}

/** Selects the connection between two parts, by their ids, with a click on the middle of its line. */
async function selectConnection(from, to) {
  const point = await page.evaluate((id) => {
    const path = document.querySelector(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-interaction`);
    if (!path) return null;
    const middle = path.getPointAtLength(path.getTotalLength() / 2);
    const matrix = path.getScreenCTM();
    return [middle.x * matrix.a + middle.y * matrix.c + matrix.e, middle.x * matrix.b + middle.y * matrix.d + matrix.f];
  }, `${from}--${to}`);
  if (!point) throw new Error(`there is no connection ${from}--${to}`);
  await page.mouse.click(point[0], point[1]);
  await pause(200);
}

const select = async (name) => {
  await part(name).click();
  await pause(150);
};
const remove = async () => {
  await page.keyboard.press('Backspace');
  await pause(250);
};
/** Types into the setting with this label in the inspector. */
const set = async (label, value) => {
  await page.getByLabel(label, { exact: true }).fill(String(value));
  await page.keyboard.press('Tab');
  await pause(120);
};
const choose = async (label, option) => {
  await page.getByLabel(label, { exact: true }).selectOption({ label: option });
  await pause(120);
};
const turnOn = async (label) => {
  await page.getByLabel(label, { exact: true }).check();
  await pause(120);
};

// A spot on the canvas below the row the parts start in, and one to its right.
const BELOW = [660, 570];
const BELOW_RIGHT = [930, 600];

const LESSONS = {
  'first-traffic': async () => {
    await add('Load balancer', 'Load balancer 1', ...BELOW);
    await selectConnection('users', 'api');
    await remove();
    await connect('Users', 'Load balancer 1');
    await connect('Load balancer 1', 'API');
    await select('API');
    await set('Instances', 2);
  },
  'read-heavy': async () => {
    await add('Cache', 'Cache 1', ...BELOW);
    await connect('API', 'Cache 1');
    await select('Cache 1');
    await set('Items it can hold', 2000);
  },
  'pool-party': async () => {
    await selectConnection('api', 'db');
    await set('Connections per instance', 5);
  },
  'slow-dependency': async () => {
    await selectConnection('api', 'payments');
    await set('Give up after', 300);
  },
  'retry-storm': async () => {
    await select('API');
    await set('Waiting room, per instance', 8);
    await selectConnection('users', 'api');
    await set('Retries', 2);
    await set('Wait before the first retry', 50);
    await set('Each further wait is longer by', 2);
    await set('Randomise the wait', 1);
  },
  'write-burst': async () => {
    await select('Ledger');
    await remove();
    await add('Queue', 'Queue 1', ...BELOW);
    await add('Worker', 'Worker 1', ...BELOW_RIGHT);
    await connect('Orders', 'Queue 1');
    await connect('Queue 1', 'Worker 1');
    await selectConnection('api', 'queue-1');
    await choose('The caller', 'Hands it over and moves on');
    await select('Worker 1');
    await set('Instances', 2);
  },
  stampede: async () => {
    await select('Cache');
    await turnOn('Fetch a missing item once, for everyone waiting on it');
    await selectConnection('api', 'db');
    await set('Connections per instance', 8);
  },
  'black-friday': async () => {
    await select('Shop');
    await turnOn('Add and remove instances by itself');
    await set('Share of slots to keep busy', 0.3);
    await set('Most instances', 5);
  },
  'node-down': async () => {
    await select('API');
    await set('Instances', 3);
    await select('Balancer');
    await set('Check for dead instances every', 1000);
    await selectConnection('lb', 'api');
    await set('Retries', 1);
  },
  'the-bill': async () => {
    await select('API');
    await set('Instances', 2);
    await select('Database');
    await set('Queries at full speed at once', 8);
    await set('Read replicas', 0);
    await select('Cache');
    await set('Items it can hold', 5000);
    await select('Mailer');
    await set('Instances', 2);
  },
  'luck-of-the-draw': async () => {
    await select('Balancer');
    await choose('How it picks an instance', 'The least busy');
  },
  patience: async () => {
    await selectConnection('api', 'search');
    await set('Give up after', 300);
  },
  'full-house': async () => {
    await add('Rate limiter', 'Rate limiter 1', ...BELOW);
    await selectConnection('users', 'api');
    await remove();
    await connect('Fans', 'Rate limiter 1');
    await connect('Rate limiter 1', 'Tickets');
    await select('Rate limiter 1');
    await set('Calls let through per second', 230);
    await set('Calls let through at once after a quiet spell', 20);
  },
  'never-twice': async () => {
    await select('Database');
    await set('Read replicas', 2);
    await selectConnection('api', 'db');
    await set('Connections per instance', 10);
  },
  clockwork: async () => {
    await select('Cache');
    await set('Randomise lifetimes', 0.1);
  },
  'nine-times': async () => {
    await selectConnection('users', 'web');
    await set('Retries', 0);
  },
  'wrong-suspect': async () => {
    await select('Database');
    await set('Queries at full speed at once', 6);
    await selectConnection('api', 'db');
    await set('Connections per instance', 7);
  },
  failover: async () => {
    await select('Database');
    await set('Read replicas', 1);
    await add('Queue', 'Queue 1', ...BELOW);
    await add('Worker', 'Worker 1', ...BELOW_RIGHT);
    await connect('Shop', 'Queue 1');
    await connect('Queue 1', 'Worker 1');
    await connect('Worker 1', 'Database');
    await selectConnection('api', 'queue-1');
    await choose('Used by', 'Writes only');
    await choose('The caller', 'Hands it over and moves on');
    await selectConnection('api', 'db');
    await choose('Used by', 'Reads only');
    await selectConnection('worker-1', 'db');
    await set('Retries', 10);
    await set('Wait before the first retry', 2000);
    await set('Each further wait is longer by', 1);
  },
  'heavy-lifting': async () => {
    await connect('CDN', 'Images');
    await selectConnection('cdn', 'bucket');
    await choose('Used by', 'Files only');
    await select('CDN');
    await set('Keep each file for', 300000);
    await select('Site');
    await set('Instances', 1);
  },
  'cold-start': async () => {
    await select('Checkout');
    await set('Environments kept ready', 18);
  },
};

let failed = false;
for (const [id, follow] of Object.entries(LESSONS)) {
  if (only.length > 0 && !only.includes(id)) continue;
  let outcome;
  try {
    await page.goto(`${BASE}/#/`);
    await page.goto(`${BASE}/#/level/${id}`);
    await page.waitForSelector('.react-flow__node');
    // Whatever an earlier run left in this browser, the lesson starts from the level as it is given.
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await pause(400);
    await follow();
    await pause(500);
    await page.getByRole('button', { name: 'Max', exact: true }).click();
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForSelector('dialog[open] #result-title', { timeout: 180_000 });
    const title = await page.locator('#result-title').innerText();
    const stars = title === 'PASSED' ? await page.locator('dialog[open] [role="img"]').first().getAttribute('aria-label') : 'no stars';
    const rows = (await page.locator('dialog[open] ul').first().innerText()).replace(/\s+/g, ' ');
    await page.keyboard.press('Escape');
    outcome = `${title}, ${stars}${stars === '3 stars of 3' ? '' : `   <-- ${rows}`}`;
    failed ||= stars !== '3 stars of 3';
  } catch (error) {
    outcome = `could not be followed: ${error.message.split('\n')[0]}`;
    failed = true;
  }
  console.log(`${id.padEnd(17)} ${outcome}`);
}

if (problems.length > 0) {
  failed = true;
  console.log(problems.join('\n'));
}
await browser.close();
process.exitCode = failed ? 1 : 0;
