import { findLevel } from '@loadline/scenarios';
import type { FromWorker, ToWorker } from '../sim/protocol.ts';
import { Runner } from '../sim/runner.ts';

// The engine runs here so that a heavy simulation never blocks the page.

const STEP_MS = 16;
const STEP_BUDGET_MS = 12;
const FRAME_MS = 100;

const runner = new Runner();
let run = 0;
let framedAt = 0;

const send = (message: FromWorker) => {
  self.postMessage(message);
};
const clock = () => performance.now();

function fail(error: unknown): void {
  runner.pause();
  send({ type: 'failed', run, message: error instanceof Error ? error.message : String(error) });
}

function postFrame(): void {
  framedAt = clock();
  send({ type: 'frame', frame: runner.frame(framedAt) });
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case 'load': {
        run++;
        // A level has rules that are functions, which cannot be posted; it is looked up by id.
        const level = message.levelId === null ? null : findLevel(message.levelId);
        if (level === undefined) throw new Error(`There is no level "${message.levelId ?? ''}".`);
        runner.load(run, message.design, message.seed, message.multiplier, level);
        break;
      }
      case 'play':
        runner.play(clock());
        break;
      case 'pause':
        runner.pause();
        break;
      case 'speed':
        runner.setSpeed(message.value);
        break;
      case 'multiplier':
        runner.setMultiplier(message.value);
        break;
      case 'reconfigure':
        runner.reconfigure(message.design);
        break;
      case 'command':
        runner.command(message.command);
        break;
    }
    // Answer every message straight away, so the page never shows a state the worker has left.
    postFrame();
  } catch (error) {
    fail(error);
  }
};

setInterval(() => {
  if (!runner.isPlaying) return;
  try {
    const now = clock();
    const ended = runner.step(now, STEP_BUDGET_MS, clock);
    // A run that has just ended is reported at once, not on the next tick of the frame clock.
    if (ended || now - framedAt >= FRAME_MS) postFrame();
  } catch (error) {
    fail(error);
  }
}, STEP_MS);
