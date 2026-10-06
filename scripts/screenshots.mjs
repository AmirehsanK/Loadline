// Takes the screenshots the README shows, from the built app.
//
//   npm run build -w @loadline/web
//   npm run preview -w @loadline/web -- --port 5184     (in another terminal)
//   npm run screenshots
//
// It drives a browser that is already installed (Edge, or Chrome with BROWSER=chrome), so there is
// nothing to download. The pictures are of real runs: each one plays a level and waits for it.

/* global document, localStorage -- the functions given to the page run in the page, not here */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.LOADLINE_URL ?? 'http://localhost:5184';
const OUT = join(import.meta.dirname, '..', 'docs', 'screenshots');
const SIZE = { width: 1440, height: 900 };

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER === 'chrome' ? 'chrome' : 'msedge' });

/** A fresh visitor: their own storage, in a language, with some levels already passed. */
async function visitor(locale, stars = {}) {
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await context.addInitScript(
    ([language, progress]) => {
      localStorage.setItem('loadline:locale:v1', language);
      localStorage.setItem('loadline:progress:v1', progress);
    },
    [locale, JSON.stringify(stars)],
  );
  return context.newPage();
}

const shoot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`docs/screenshots/${name}.png`);
};

/** The simulated time on the level clock, in seconds. */
const clock = async (page) => {
  const text = await page.locator('header [aria-label]').filter({ hasText: /^\d+:\d\d$/ }).first().innerText();
  const [minutes, seconds] = text.split(':').map(Number);
  return minutes * 60 + seconds;
};

const PROGRESS = { 'first-traffic': 3, 'read-heavy': 3, 'pool-party': 2, 'slow-dependency': 3, 'retry-storm': 1 };

for (const [locale, words] of [
  ['en', { run: 'Run', pause: 'Pause', hint: 'Show a hint', another: 'Show another', solution: 'Show a solution', max: 'Max' }],
  ['fa', { run: 'اجرا', pause: 'مکث', hint: 'نمایش یک راهنمایی', another: 'راهنمایی بعدی', solution: 'نمایش یک راه‌حل', max: 'بیشینه' }],
]) {
  const suffix = locale === 'en' ? '' : `-${locale}`;
  const button = (page, name) => page.getByRole('button', { name, exact: true });

  // The front page, part of the way through the levels.
  const home = await visitor(locale, PROGRESS);
  await home.goto(`${BASE}/#/`);
  await home.waitForSelector('ol li a');
  await shoot(home, `home${suffix}`);
  await home.context().close();

  // A level in trouble: the starting design of the first level, as traffic passes what it can do.
  const level = await visitor(locale, PROGRESS);
  await level.goto(`${BASE}/#/level/first-traffic`);
  await button(level, '5×').click();
  await button(level, words.run).click();
  while ((await clock(level)) < 44) await level.waitForTimeout(200);
  await button(level, words.pause).click();
  await level.waitForTimeout(300);
  await shoot(level, `level${suffix}`);

  // The same level, solved: the result with its debrief.
  await button(level, words.hint).click();
  await button(level, words.another).click();
  await button(level, words.another).click();
  await button(level, words.solution).click();
  await button(level, words.max).click();
  await button(level, words.run).click();
  await level.waitForSelector('dialog[open]');
  // The stars are stamped on one after another.
  await level.waitForTimeout(1200);
  await shoot(level, `result${suffix}`);
  await level.context().close();
}

// A lesson from the guide, once the answer it describes has been run and scored on the page.
const guide = await visitor('en');
await guide.goto(`${BASE}/#/guide/first-traffic`);
await guide.waitForFunction(() => document.querySelectorAll('main ul').length >= 3);
await shoot(guide, 'guide');
await guide.context().close();

// The sandbox, with a design that came with traffic and a fault of its own.
const sandbox = await visitor('en');
await sandbox.goto(`${BASE}/#/sandbox`);
await sandbox.getByRole('button', { name: '5×', exact: true }).click();
await sandbox.getByRole('button', { name: 'Run', exact: true }).click();
await sandbox.waitForTimeout(6000);
await sandbox.getByRole('button', { name: 'Pause', exact: true }).click();
await sandbox.locator('.react-flow__node').nth(1).click();
await sandbox.waitForTimeout(300);
await shoot(sandbox, 'sandbox');
await sandbox.context().close();

await browser.close();
