import { commandSchema, designMonthlyCost, hasErrors, lintDesign } from '@loadline/engine';
import type { CommandInput, Design } from '@loadline/engine';
import { simulationKey, structureKey } from '../design/model.ts';
import { currentDesign, useDesign } from '../design/store.ts';
import { useProgress } from '../level/progress.ts';
import { DEFAULT_SEED, FULL_SPEED } from './protocol.ts';
import type { FromWorker, FullReport, ToWorker } from './protocol.ts';
import { EMPTY_RUN, HISTORY, useSim } from './store.ts';

// Owns the worker. The design store says what to simulate, the sim store holds what came back, and
// this module is the only thing that talks to the worker in between.

const RELOAD_DELAY_MS = 250;

const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
const send = (message: ToWorker) => {
  worker.postMessage(message);
};

// Counts the `load` messages sent. The worker counts the ones it receives, so a frame carrying an
// older number belongs to a design that has since been replaced.
let run = 0;
// What the worker is running: the whole of it, just its nodes and edges, and for which level.
let loadedKey: string | null = null;
let loadedStructure: string | null = null;
let loadedLevel: string | null = null;
// Whether the run is of a design that is only being looked at; such a run earns no stars.
let loadedTransient = false;

/** Everything a run depends on, as a string: the design, and the traffic and seed it came with. */
function runKey(state: { seed: number | null; workload: unknown }, design: Design): string {
  return `${simulationKey(design)}|${String(state.seed)}|${JSON.stringify(state.workload)}`;
}

// Requests for a full report that the worker has not answered yet, by their id.
const awaited = new Map<number, (full: FullReport | null) => void>();
let requests = 0;

worker.onmessage = (event: MessageEvent<FromWorker>) => {
  const message = event.data;
  if (message.type === 'report') {
    awaited.get(message.id)?.(message.full);
    awaited.delete(message.id);
    return;
  }
  if (message.type === 'failed') {
    if (message.run === run) useSim.setState({ status: 'failed', failure: message.message });
    return;
  }
  const { frame } = message;
  if (frame.run !== run) return;
  const before = useSim.getState().status;
  // A blocked or failed run is over; whatever the worker still reports about it is not shown.
  if (before === 'failed' || before === 'blocked') return;

  const finished = frame.level?.finished ?? false;
  useSim.setState((state) => ({
    status: finished ? 'finished' : frame.playing ? 'running' : 'paused',
    now: frame.now,
    measuredSpeed: frame.measuredSpeed,
    traffic: frame.traffic,
    totals: frame.totals,
    gauges: frame.gauges,
    blame: frame.blame,
    bottleneck: frame.bottleneck,
    monthlyCost: frame.monthlyCost,
    level: frame.level,
    samples: frame.samples.length > 0 ? [...state.samples, ...frame.samples].slice(-HISTORY) : state.samples,
  }));
  // The moment a run of a level ends is the moment its result counts.
  if (finished && before !== 'finished' && loadedLevel !== null && !loadedTransient && frame.level?.outcome.passed) {
    useProgress.getState().record(loadedLevel, frame.level.outcome.stars);
  }
};

/** Starts a run of `design` from time zero. */
function load(design: Design, playing: boolean): void {
  const state = useDesign.getState();
  const { level } = state;
  const issues = lintDesign(design);
  loadedKey = runKey(state, design);
  loadedLevel = level?.id ?? null;
  loadedTransient = state.transient;
  if (hasErrors(issues)) {
    loadedStructure = null;
    send({ type: 'pause' });
    useSim.setState({ ...EMPTY_RUN, monthlyCost: designMonthlyCost(design), issues, status: 'blocked', nodeIndex: {}, edgeIndex: {} });
    return;
  }
  run++;
  loadedStructure = structureKey(design);
  const { multiplier, speed } = useSim.getState();
  useSim.setState({
    ...EMPTY_RUN,
    // What the design costs is known before the worker has said anything. Until it has, this is
    // the figure on show; the run then reports what it has really cost.
    monthlyCost: designMonthlyCost(design),
    issues,
    status: playing ? 'running' : 'paused',
    nodeIndex: Object.fromEntries(design.nodes.map((node, index) => [node.id, index])),
    edgeIndex: Object.fromEntries(design.edges.map((edge, index) => [edge.id, index])),
  });
  // A level sets its own traffic and seed; the traffic control only applies in the sandbox.
  send({
    type: 'load',
    design,
    seed: level?.seed ?? state.seed ?? DEFAULT_SEED,
    multiplier: level ? 1 : multiplier,
    levelId: level?.id ?? null,
    workload: level ? null : state.workload,
  });
  send({ type: 'speed', value: speed });
  if (playing) send({ type: 'play' });
}

/** Brings the worker in line with the design, if the part the simulation depends on has changed. */
function sync(): void {
  const state = useDesign.getState();
  const design = currentDesign(state);
  if (!design) return;
  const key = runKey(state, design);
  const levelId = state.level?.id ?? null;
  if (key === loadedKey && levelId === loadedLevel) return;

  // A level is scored on one design from start to finish, so any change starts the run over,
  // stopped. So does moving between a level and the sandbox, and so does scripted traffic, which
  // only means something from its beginning.
  if (levelId !== null || levelId !== loadedLevel || state.workload !== null) {
    load(design, false);
    return;
  }

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
useDesign.subscribe((state, previous) => {
  clearTimeout(syncTimer);
  syncTimer = undefined;
  if (state.slot !== previous.slot) {
    // Another design has been opened: show it at once. Full speed is only for runs that end.
    if (!state.level && useSim.getState().speed === FULL_SPEED) setSpeed(1);
    sync();
    return;
  }
  // An edit waits until typing has paused.
  syncTimer = setTimeout(settle, RELOAD_DELAY_MS);
});
sync();

/**
 * Applies an edit that is still waiting. Anything done to the run is meant for the design on the
 * canvas: without this, Run pressed straight after an edit would carry on with the design from
 * before it, and the edit would then arrive and stop the run.
 */
function settle(): void {
  if (syncTimer === undefined) return;
  clearTimeout(syncTimer);
  syncTimer = undefined;
  sync();
}

/** Starts the run again from time zero with the same design and seed. */
export function restart(playing = useSim.getState().status === 'running'): void {
  const design = currentDesign(useDesign.getState());
  if (design) load(design, playing);
}

export function play(): void {
  settle();
  const { status } = useSim.getState();
  if (status === 'blocked') return;
  // A run that is over starts again from the beginning.
  if (status === 'failed' || status === 'finished') restart(true);
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

/** The whole report of the run as it stands, or null when there is nothing to report on. */
export function requestReport(): Promise<FullReport | null> {
  settle();
  if (useSim.getState().status === 'blocked') return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = ++requests;
    awaited.set(id, resolve);
    send({ type: 'report', id });
  });
}

/** Injects a fault into the run in progress. */
export function inject(command: CommandInput): void {
  settle();
  send({ type: 'command', command: commandSchema.parse(command) });
}
