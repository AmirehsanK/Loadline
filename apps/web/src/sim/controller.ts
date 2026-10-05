import { commandSchema, hasErrors, lintDesign } from '@loadline/engine';
import type { CommandInput, Design } from '@loadline/engine';
import { simulationKey, structureKey } from '../design/model.ts';
import { currentDesign, useDesign } from '../design/store.ts';
import type { FromWorker, ToWorker } from './protocol.ts';
import { EMPTY_RUN, HISTORY, useSim } from './store.ts';

// Owns the worker. The design store says what to simulate, the sim store holds what came back, and
// this module is the only thing that talks to the worker in between.

const SEED = 2026;
const RELOAD_DELAY_MS = 250;

const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
const send = (message: ToWorker) => {
  worker.postMessage(message);
};

// Counts the `load` messages sent. The worker counts the ones it receives, so a frame carrying an
// older number belongs to a design that has since been replaced.
let run = 0;
// What the worker is running: the whole of it, and just its nodes and edges.
let loadedKey: string | null = null;
let loadedStructure: string | null = null;

worker.onmessage = (event: MessageEvent<FromWorker>) => {
  const message = event.data;
  if (message.type === 'failed') {
    if (message.run === run) useSim.setState({ status: 'failed', failure: message.message });
    return;
  }
  const { frame } = message;
  if (frame.run !== run) return;
  useSim.setState((state) => {
    // A blocked or failed run is over; whatever the worker still reports about it is not shown.
    if (state.status === 'failed' || state.status === 'blocked') return state;
    const samples = frame.samples.length > 0 ? [...state.samples, ...frame.samples].slice(-HISTORY) : state.samples;
    return {
      status: frame.playing ? 'running' : 'paused',
      now: frame.now,
      measuredSpeed: frame.measuredSpeed,
      totals: frame.totals,
      gauges: frame.gauges,
      blame: frame.blame,
      bottleneck: frame.bottleneck,
      monthlyCost: frame.monthlyCost,
      samples,
    };
  });
};

/** Starts a run of `design` from time zero. */
function load(design: Design, playing: boolean): void {
  const issues = lintDesign(design);
  loadedKey = simulationKey(design);
  if (hasErrors(issues)) {
    loadedStructure = null;
    send({ type: 'pause' });
    useSim.setState({ ...EMPTY_RUN, issues, status: 'blocked', nodeIndex: {}, edgeIndex: {} });
    return;
  }
  run++;
  loadedStructure = structureKey(design);
  const { multiplier, speed } = useSim.getState();
  useSim.setState({
    ...EMPTY_RUN,
    issues,
    status: playing ? 'running' : 'paused',
    nodeIndex: Object.fromEntries(design.nodes.map((node, index) => [node.id, index])),
    edgeIndex: Object.fromEntries(design.edges.map((edge, index) => [edge.id, index])),
  });
  send({ type: 'load', design, seed: SEED, multiplier });
  send({ type: 'speed', value: speed });
  if (playing) send({ type: 'play' });
}

/** Brings the worker in line with the design, if the part the simulation depends on has changed. */
function sync(): void {
  const design = currentDesign(useDesign.getState());
  if (!design) return;
  const key = simulationKey(design);
  if (key === loadedKey) return;

  const { status } = useSim.getState();
  const issues = lintDesign(design);
  // Only settings changed, and the run is alive: apply them to it rather than starting over.
  if (structureKey(design) === loadedStructure && !hasErrors(issues) && status !== 'failed') {
    loadedKey = key;
    useSim.setState({ issues });
    send({ type: 'reconfigure', design });
    return;
  }
  load(design, status === 'running');
}

let syncTimer: ReturnType<typeof setTimeout> | undefined;
useDesign.subscribe(() => {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, RELOAD_DELAY_MS);
});
sync();

/** Starts the run again from time zero with the same design and seed. */
export function restart(playing = useSim.getState().status === 'running'): void {
  const design = currentDesign(useDesign.getState());
  if (design) load(design, playing);
}

export function play(): void {
  const { status } = useSim.getState();
  if (status === 'blocked') return;
  if (status === 'failed') restart(true);
  else send({ type: 'play' });
}

export function pause(): void {
  send({ type: 'pause' });
}

export function setSpeed(value: number): void {
  useSim.setState({ speed: value });
  send({ type: 'speed', value });
}

export function setMultiplier(value: number): void {
  useSim.setState({ multiplier: value });
  send({ type: 'multiplier', value });
}

/** Injects a fault into the run in progress. */
export function inject(command: CommandInput): void {
  send({ type: 'command', command: commandSchema.parse(command) });
}
