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
      case 'load':
        run++;
        runner.load(run, message.design, message.seed, message.multiplier);
        break;
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
    runner.step(now, STEP_BUDGET_MS, clock);
    if (now - framedAt >= FRAME_MS) postFrame();
  } catch (error) {
    fail(error);
  }
}, STEP_MS);
