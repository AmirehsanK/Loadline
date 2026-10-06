import type { Command, Design, Workload } from '@loadline/engine';
import type { Scenario } from '@loadline/scenarios';
import { useDesign } from '../design/store.ts';
import type { Messages } from '../i18n/en.ts';
import { useMessages } from '../i18n/index.ts';
import { formatClock, formatCount, formatDuration, formatPercent } from '../metrics/format.ts';
import { useSim } from '../sim/store.ts';

const WIDTH = 1000;
const HEIGHT = 30;
/** Room above the traffic for the marks of what happens to the system. */
const HEADROOM = 8;

/** A run with a shape of its own: a level's, or the traffic a design came with. */
export interface Script {
  /** How much of the run the line shows. A level ends there. */
  durationMs: number;
  /** How much of the start is not scored. */
  warmupMs: number;
  workload: Workload;
  /** The design the script was written for: its names stand in for parts no longer on the canvas. */
  starter?: Design;
}

export function scriptOfLevel(level: Scenario): Script {
  return { durationMs: level.durationMs, warmupMs: level.warmupMs, workload: level.workload, starter: level.starter };
}

/** The script of traffic that has no end of its own: the line runs a little past its last event. */
export function scriptOfWorkload(workload: Workload): Script {
  const ends = [
    ...workload.phases.map((phase) => phase.atMs),
    ...workload.chaos.map(({ atMs, command }) => atMs + ('durationMs' in command ? (command.durationMs ?? 0) : 0)),
  ];
  return { durationMs: Math.max(60_000, Math.max(0, ...ends) + 20_000), warmupMs: 0, workload };
}

interface Happening {
  atMs: number;
  /** How long it lasts; undefined when it is for good, or over at once. */
  durationMs: number | undefined;
  text: string;
}

/** What a scripted fault does, in words. */
function describe(command: Command, m: Messages, nodeName: (id: string) => string, edgeEnds: (id: string) => [string, string]): string {
  const text = m.level.timeline;
  let what: string;
  switch (command.type) {
    case 'kill':
      what = command.count === undefined ? text.killAll(nodeName(command.nodeId)) : text.killSome(nodeName(command.nodeId), command.count);
      break;
    case 'slow':
      what = text.slow(nodeName(command.nodeId), formatCount(command.factor));
      break;
    case 'errors':
      what = text.errors(nodeName(command.nodeId), formatPercent(command.rate));
      break;
    case 'flush':
      return text.flush(nodeName(command.nodeId));
    case 'failover':
      return text.failover(nodeName(command.nodeId));
    case 'sever':
      what = text.sever(...edgeEnds(command.edgeId));
      break;
    case 'delay':
      what = text.delay(...edgeEnds(command.edgeId), formatDuration(command.addMs));
      break;
    case 'traffic':
      what = text.traffic(formatCount(command.multiplier));
      break;
  }
  return command.durationMs === undefined ? text.forGood(what) : text.lasting(what, formatDuration(command.durationMs));
}

/**
 * A run laid out along a line: how its traffic rises and falls, what is done to the system and
 * when, which part is warm-up, and how far the run has got. It shows the story of a level before
 * a single request has been sent.
 */
export function Timeline({ script }: { script: Script }) {
  const m = useMessages();
  const now = useSim((state) => state.now);
  const nodes = useDesign((state) => state.nodes);
  const edges = useDesign((state) => state.edges);

  // Faults name parts by id; the names are the ones on the canvas, which the player may have changed.
  const nodeName = (id: string) =>
    nodes.find((node) => node.id === id)?.data.name || script.starter?.nodes.find((node) => node.id === id)?.name || id;
  const edgeEnds = (id: string): [string, string] => {
    const edge = edges.find((candidate) => candidate.id === id);
    const original = script.starter?.edges.find((candidate) => candidate.id === id);
    return [nodeName(edge?.source ?? original?.from ?? id), nodeName(edge?.target ?? original?.to ?? id)];
  };

  const { durationMs, warmupMs, workload } = script;
  const x = (ms: number) => (Math.min(ms, durationMs) / durationMs) * WIDTH;
  const happenings: Happening[] = workload.chaos.map(({ atMs, command }) => ({
    atMs,
    durationMs: 'durationMs' in command ? command.durationMs : undefined,
    text: describe(command, m, nodeName, edgeEnds),
  }));

  // Traffic as a staircase: each phase holds until the next.
  const phases = [...workload.phases].sort((a, b) => a.atMs - b.atMs);
  const peak = Math.max(1, ...phases.map((phase) => phase.multiplier));
  const y = (multiplier: number) => HEIGHT - (multiplier / peak) * (HEIGHT - HEADROOM);
  const atStart = phases.findLast((phase) => phase.atMs <= 0)?.multiplier ?? 1;
  const steps = phases.filter((phase) => phase.atMs > 0).map((phase) => `H${x(phase.atMs)} V${y(phase.multiplier)}`);
  const path = `M0 ${HEIGHT} V${y(atStart)} ${steps.join(' ')} H${WIDTH} V${HEIGHT} Z`;

  const summary = [
    m.level.timeline.label(formatClock(durationMs)),
    ...(warmupMs > 0 ? [m.level.timeline.warmup(formatClock(warmupMs))] : []),
    ...happenings.map((happening) => m.level.timeline.at(formatClock(happening.atMs), happening.text)),
  ].join(' ');

  return (
    <div className="flex min-w-56 flex-1 items-center gap-2">
      <span className="text-[1.1rem] font-bold tabular-nums" aria-label={m.run.clock}>
        {formatClock(now)}
      </span>
      {/* Time runs left to right in every language, as it does on the charts. */}
      <div dir="ltr" className="relative h-[30px] min-w-0 flex-1" role="img" aria-label={summary}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
          <rect width={WIDTH} height={HEIGHT} fill="var(--color-deck)" />
          <path d={path} fill="var(--color-sea-wash)" stroke="var(--color-sea)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          {warmupMs > 0 && <rect width={x(warmupMs)} height={HEIGHT} fill="url(#warmup-hatch)" />}
          <defs>
            <pattern id="warmup-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="2.5" height="6" fill="var(--color-ink-3)" opacity="0.28" />
            </pattern>
          </defs>
          <rect width={WIDTH} height={HEIGHT} fill="none" stroke="var(--color-line)" vectorEffect="non-scaling-stroke" />
        </svg>
        {warmupMs > 0 && (
          <div
            className="absolute inset-y-0 border-e border-dashed border-ink-3"
            style={{ left: 0, width: `${(x(warmupMs) / WIDTH) * 100}%` }}
            title={m.level.timeline.warmup(formatClock(warmupMs))}
          />
        )}
        {happenings.map((happening, index) => (
          <div
            key={index}
            className="absolute inset-y-0"
            style={{
              left: `${(x(happening.atMs) / WIDTH) * 100}%`,
              width: `${(x(happening.durationMs ?? 0) / WIDTH) * 100}%`,
            }}
            title={m.level.timeline.at(formatClock(happening.atMs), happening.text)}
          >
            {/* A bar for as long as it lasts, hanging from the moment it starts. */}
            <div className="absolute inset-x-0 top-0 h-[3px] bg-oxide" />
            <div className="absolute inset-y-0 w-0.5 bg-oxide" style={{ left: 0 }} />
            <div className="absolute top-0 size-0 border-x-4 border-t-[6px] border-x-transparent border-t-oxide" style={{ left: -3 }} />
          </div>
        ))}
        <div className="absolute inset-y-[-3px] w-0.5 bg-ink" style={{ left: `${(x(now) / WIDTH) * 100}%` }} />
      </div>
      <span className="text-ink-2 tabular-nums">{formatClock(durationMs)}</span>
    </div>
  );
}
