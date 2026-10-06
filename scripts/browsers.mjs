// Runs the engine in each browser that is installed and checks that it computes exactly what Node
// does: the reference system on its bad day, and the reference answer to every level.
//
//   npm run browsers                       whichever of Firefox, Chrome and Edge are installed
//   npm run browsers -- Firefox Chrome     only these, and it is a failure if one is missing
//
// This is the check on the claim that a run is the same on any JavaScript engine. Node, Chrome and
// Edge all run V8, so they mostly show that nothing differs between Node and a page. Firefox runs
// SpiderMonkey, and is the one that makes it a test. Safari's engine cannot be started from a
// script like this and is not covered.
//
// Nothing drives the browsers. The page computes the hashes and posts them back to the server
// that served it, so all a browser has to do is open an address without showing a window. Each
// one runs from a profile folder of its own, made for the run and removed after it, so it never
// touches the profile of a browser the person at the machine has open.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { URL } from 'node:url';
import { createServer } from 'vite';
import { RUNS } from './browsers/hashes.js';

const TIMEOUT_MS = 180_000;

const installed = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
const onWindows = (...folders) => installed.map((root) => join(root, ...folders));

const chromium = (profile, url) => [
  '--headless=new',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  url,
];

// A new Firefox profile opens a welcome page and offers to send reports. Neither is wanted here.
const FIREFOX_PREFERENCES = [
  ['browser.aboutwelcome.enabled', false],
  ['browser.shell.checkDefaultBrowser', false],
  ['browser.startup.homepage_override.mstone', 'ignore'],
  ['datareporting.policy.dataSubmissionEnabled', false],
  ['datareporting.healthreport.uploadEnabled', false],
  ['toolkit.telemetry.reportingpolicy.firstRun', false],
]
  .map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`)
  .join('');

const BROWSERS = [
  {
    name: 'Firefox',
    engine: 'SpiderMonkey',
    version: /Firefox\/[\d.]+/,
    paths: [...onWindows('Mozilla Firefox', 'firefox.exe'), '/Applications/Firefox.app/Contents/MacOS/firefox', '/usr/bin/firefox'],
    prepare: (profile) => {
      writeFileSync(join(profile, 'user.js'), FIREFOX_PREFERENCES);
    },
    // On Windows the program that is started hands over to another and leaves, unless told to wait.
    args: (profile, url) => ['--headless', '--no-remote', ...(process.platform === 'win32' ? ['--wait-for-browser'] : []), '--profile', profile, url],
  },
  {
    name: 'Chrome',
    engine: 'V8',
    version: /Chrome\/[\d.]+/,
    paths: [
      ...onWindows('Google', 'Chrome', 'Application', 'chrome.exe'),
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
    ],
    args: chromium,
  },
  {
    name: 'Edge',
    engine: 'V8',
    version: /Edg\/[\d.]+/,
    paths: [
      ...onWindows('Microsoft', 'Edge', 'Application', 'msedge.exe'),
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/usr/bin/microsoft-edge',
    ],
    args: chromium,
  },
];

/** Runs a command whose failure means there was nothing left for it to do. */
function attempt(file, args) {
  try {
    execFileSync(file, args, { stdio: 'ignore' });
  } catch {
    // Nothing was running, which is what was wanted.
  }
}

/** Ends a browser and everything it started. */
function stop(child, profile) {
  // Whatever runs from this profile folder is ours: the folder's name is unique to this run. That
  // catches a browser that was handed over to by the program that was started.
  const mark = basename(profile);
  if (process.platform === 'win32') {
    attempt('taskkill', ['/pid', String(child.pid), '/t', '/f']);
    const ours = `$_.CommandLine -like '*${mark}*' -and $_.ProcessId -ne $PID`;
    attempt('powershell', [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process | Where-Object { ${ours} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ]);
  } else {
    child.kill('SIGKILL');
    attempt('pkill', ['-9', '-f', mark]);
  }
}

// What each browser that has been started is waited on for, by its name.
const waiting = new Map();

const server = await createServer({
  configFile: false,
  root: join(import.meta.dirname, 'browsers'),
  logLevel: 'error',
  // Only this machine can reach it.
  server: { host: '127.0.0.1', port: 5185 },
  plugins: [
    {
      name: 'loadline:report',
      configureServer(vite) {
        vite.middlewares.use('/report', (request, response) => {
          let body = '';
          request.on('data', (chunk) => {
            body += chunk;
          });
          request.on('end', () => {
            const browser = new URL(request.url, 'http://localhost').searchParams.get('browser');
            waiting.get(browser)?.(JSON.parse(body));
            response.end();
          });
        });
      },
    },
  ],
});
await server.listen();
const { port } = server.httpServer.address();

/** Opens the page in a browser and returns what it posted back. */
async function ask(browser, executable) {
  const profile = mkdtempSync(join(tmpdir(), 'loadline-browsers-'));
  browser.prepare?.(profile);
  const child = spawn(executable, browser.args(profile, `http://127.0.0.1:${port}/?browser=${browser.name}`), { stdio: 'ignore' });
  try {
    return await Promise.race([
      new Promise((resolve) => {
        waiting.set(browser.name, resolve);
      }),
      new Promise((resolve) => {
        child.on('error', (error) => {
          resolve({ error: `could not be started: ${error.message}` });
        });
      }),
      wait(TIMEOUT_MS, undefined, { ref: false }).then(() => ({ error: `did not answer within ${TIMEOUT_MS / 1000} s` })),
    ]);
  } finally {
    waiting.delete(browser.name);
    stop(child, profile);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch (error) {
      console.log(`  (could not remove ${profile}: ${error.message})`);
    }
  }
}

// With names on the command line, those browsers are checked and each has to be there. Without,
// every browser that is installed is checked and one that is missing is skipped.
const required = process.argv.slice(2).map((name) => name.toLowerCase());
const unknown = required.filter((name) => !BROWSERS.some((browser) => browser.name.toLowerCase() === name));
if (unknown.length > 0) {
  await server.close();
  console.error(`Not a browser this can check: ${unknown.join(', ')}. It knows ${BROWSERS.map((browser) => browser.name).join(', ')}.`);
  process.exit(2);
}

const names = RUNS.map(([name]) => name);
const expected = Object.fromEntries(RUNS.map(([name, hash]) => [name, hash()]));
console.log(`Node ${process.versions.node} (V8): ${names.length} runs`);
for (const name of names) console.log(`  ${expected[name]}  ${name}`);

let checked = 0;
let failed = false;
for (const browser of BROWSERS.filter((each) => required.length === 0 || required.includes(each.name.toLowerCase()))) {
  const executable = browser.paths.find((path) => existsSync(path));
  if (!executable) {
    const needed = required.includes(browser.name.toLowerCase());
    failed ||= needed;
    console.log(`${browser.name}: not installed, ${needed ? 'and it was asked for' : 'skipped'}`);
    continue;
  }
  const answer = await ask(browser, executable);
  const label = `${answer.agent?.match(browser.version)?.[0].replace('/', ' ').replace('Edg ', 'Edge ') ?? browser.name} (${browser.engine})`;
  if (answer.error !== undefined) {
    failed = true;
    console.log(`${label}: ${answer.error}`);
    continue;
  }
  checked++;
  const different = names.filter((name) => answer.hashes[name] !== expected[name]);
  if (different.length === 0) {
    console.log(`${label}: the same on all ${names.length}`);
    continue;
  }
  failed = true;
  console.log(`${label}: DIFFERENT on ${different.length} of ${names.length}`);
  for (const name of different) console.log(`  ${answer.hashes[name] ?? 'nothing'}  ${name}`);
}

await server.close();
if (checked === 0) console.log('No browser could be checked.');
process.exitCode = failed || checked === 0 ? 1 : 0;
