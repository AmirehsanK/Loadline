import type { Gauge, NodeType, NodeWindow } from '@loadline/engine';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import type { FlowNodeOf } from '../design/model.ts';
import { useMessages } from '../i18n/index.ts';
import {
  CacheIcon,
  ClientIcon,
  DatabaseIcon,
  LoadBalancerIcon,
  QueueIcon,
  RateLimiterIcon,
  ServiceIcon,
  WorkerIcon,
} from '../icons.tsx';
import { formatCount, formatDuration, formatPercent } from '../metrics/format.ts';
import { latestSample, useSim } from '../sim/store.ts';
import type { SimState } from '../sim/store.ts';
import { LOAD_LINE, LoadGauge } from './LoadGauge.tsx';

// Live numbers come straight from the sim store, keyed by node id. They never pass through the
// canvas's own node state, so an update repaints a few numbers and not the graph.

const windowOf = (id: string) => (state: SimState) => {
  const index = state.nodeIndex[id];
  return index === undefined ? undefined : latestSample(state)?.nodes[index];
};

const gaugeOf = (id: string) => (state: SimState) => {
  const index = state.nodeIndex[id];
  return index === undefined ? undefined : state.gauges[index];
};

/** What a node is doing: its last sampling window, and what it holds right now. */
function useLive(id: string): { window: NodeWindow | undefined; gauge: Gauge | undefined } {
  return { window: useSim(windowOf(id)), gauge: useSim(gaugeOf(id)) };
}

export const PART_ICONS: Record<NodeType, ReactNode> = {
  client: <ClientIcon />,
  'load-balancer': <LoadBalancerIcon />,
  'rate-limiter': <RateLimiterIcon />,
  service: <ServiceIcon />,
  cache: <CacheIcon />,
  database: <DatabaseIcon />,
  queue: <QueueIcon />,
  worker: <WorkerIcon />,
};

const outline = (selected: boolean | undefined) => (selected ? 'outline-2 outline-offset-2 outline-ink' : 'outline-0');
const small = 'font-mono text-[0.85rem]';

/** A source of traffic: a pill, because it is outside the system and nothing calls it. */
export function ClientNodeView({ id, data, selected }: NodeProps<FlowNodeOf<'client'>>) {
  const m = useMessages();
  const traffic = useSim((state) => state.traffic);
  return (
    <div className={`flex w-44 items-center gap-2.5 rounded-full border border-ink bg-plate py-2 ps-3 pe-5 ${outline(selected)}`}>
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-plate">{PART_ICONS.client}</span>
      <div className="min-w-0">
        <div className="truncate font-bold">{data.name || id}</div>
        <div className={`truncate text-ink-2 ${small}`}>{m.node.perSecond(formatCount(data.params.rps * traffic))}</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

/** A part that passes calls on without doing work of its own: a load balancer or a rate limiter. */
export function GateNodeView({ id, type, data, selected }: NodeProps<FlowNodeOf<'load-balancer' | 'rate-limiter'>>) {
  const m = useMessages();
  const { window, gauge } = useLive(id);
  const failing = window?.failed ?? 0;
  return (
    <div className={`flex w-44 items-center gap-2 rounded-[3px] border border-ink bg-deck py-1.5 ps-2.5 pe-3 ${outline(selected)}`}>
      <Handle type="target" position={Position.Left} />
      <span className="shrink-0 text-ink">{PART_ICONS[type]}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold">{data.name || id}</div>
        <div className={`flex justify-between gap-2 ${small}`}>
          <span className="text-ink-2">
            {gauge?.instances === 0
              ? m.node.down
              : window && window.arrivals > 0
                ? m.node.perSecond(formatCount(window.arrivals))
                : '–'}
          </span>
          {failing > 0 && <span className="font-bold text-oxide">{m.node.failing(formatCount(failing))}</span>}
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

interface PlateProps {
  id: string;
  type: NodeType;
  name: string;
  selected: boolean | undefined;
  /** Busy share to show against the load line; omit for parts that have no slots. */
  level?: number;
  /** Up to three short lines under the name. */
  children: ReactNode;
  /** Whether the part makes calls of its own. */
  calls?: boolean;
}

/** The plate every working part is drawn on: its gauge, its name, how many of it there are. */
function Plate({ id, type, name, selected, level, children, calls = true }: PlateProps) {
  const m = useMessages();
  const instances = useSim(gaugeOf(id))?.instances;
  return (
    <div className={`flex h-[4.6rem] w-52 overflow-hidden rounded-[3px] border border-ink bg-plate ${outline(selected)}`}>
      <Handle type="target" position={Position.Left} />
      {level !== undefined && <LoadGauge level={level} label={m.node.load(formatPercent(level))} lineLabel={m.node.loadLine} />}
      <div className="flex min-w-0 flex-1 flex-col justify-between py-1.5 ps-2.5 pe-3">
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 translate-y-0.5 text-ink-2">{PART_ICONS[type]}</span>
          <span className="truncate font-bold">{name || id}</span>
          {instances !== undefined && instances !== 1 && (
            <span className={`shrink-0 ${small} ${instances === 0 ? 'font-bold text-oxide' : 'text-ink-2'}`}>
              {instances === 0 ? m.node.down : m.node.instances(instances)}
            </span>
          )}
          {level !== undefined && (
            <span className={`ms-auto shrink-0 ${small} ${level > LOAD_LINE ? 'font-bold text-oxide' : 'text-ink-2'}`}>
              {formatPercent(level)}
            </span>
          )}
        </div>
        {children}
      </div>
      {calls && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

/** The line every busy part shows: how much is arriving, and how long the slow calls take. */
function Throughput({ window }: { window: NodeWindow | undefined }) {
  const m = useMessages();
  if (!window || window.arrivals === 0) return <div className="text-[0.85rem] text-ink-3">{m.node.idle}</div>;
  return (
    <div className={`flex justify-between gap-2 text-ink-2 ${small}`}>
      <span>{m.node.perSecond(formatCount(window.arrivals))}</span>
      <span>{window.ok > 0 ? m.node.tail(formatDuration(window.p99)) : ''}</span>
    </div>
  );
}

/** A warning line, or an empty one of the same height so the plate does not jump. */
function Trouble({ text }: { text: string | false }) {
  return <div className={`h-[1.1rem] truncate text-signal ${small}`}>{text || ''}</div>;
}

export function ServiceNodeView({ id, type, data, selected }: NodeProps<FlowNodeOf<'service' | 'worker'>>) {
  const m = useMessages();
  const { window, gauge } = useLive(id);
  const waiting = gauge?.queued ?? 0;
  return (
    <Plate id={id} type={type} name={data.name} selected={selected} level={window?.utilization ?? 0}>
      <Throughput window={window} />
      <Trouble text={waiting > 0 && m.node.waiting(formatCount(waiting))} />
    </Plate>
  );
}

export function DatabaseNodeView({ id, type, data, selected }: NodeProps<FlowNodeOf<'database'>>) {
  const m = useMessages();
  const { window, gauge } = useLive(id);
  const over = gauge?.queued ?? 0;
  return (
    <Plate id={id} type={type} name={data.name} selected={selected} level={window?.utilization ?? 0} calls={false}>
      <Throughput window={window} />
      <Trouble text={over > 0 && m.node.over(formatCount(over))} />
    </Plate>
  );
}

export function CacheNodeView({ id, type, data, selected }: NodeProps<FlowNodeOf<'cache'>>) {
  const m = useMessages();
  const { window } = useLive(id);
  const lookups = window ? window.hits + window.misses : 0;
  return (
    <Plate id={id} type={type} name={data.name} selected={selected} calls={false}>
      <Throughput window={window} />
      <div className={`h-[1.1rem] text-ink-2 ${small}`}>{lookups > 0 ? m.node.hits(formatPercent(window!.hits / lookups)) : ''}</div>
    </Plate>
  );
}

export function QueueNodeView({ id, type, data, selected }: NodeProps<FlowNodeOf<'queue'>>) {
  const m = useMessages();
  const { window, gauge } = useLive(id);
  const backlog = gauge?.queued ?? 0;
  return (
    <Plate id={id} type={type} name={data.name} selected={selected}>
      {window && window.arrivals > 0 ? (
        <div className={`flex justify-between gap-2 text-ink-2 ${small}`}>
          <span>{m.node.perSecond(formatCount(window.arrivals))}</span>
          <span>{window.p99 > 0 ? m.node.oldest(formatDuration(window.p99)) : ''}</span>
        </div>
      ) : (
        <div className="text-[0.85rem] text-ink-3">{m.node.idle}</div>
      )}
      <Trouble text={backlog > 0 && m.node.backlog(formatCount(backlog))} />
    </Plate>
  );
}

/** The component that draws each kind of part. */
export const NODE_VIEWS = {
  client: ClientNodeView,
  'load-balancer': GateNodeView,
  'rate-limiter': GateNodeView,
  service: ServiceNodeView,
  worker: ServiceNodeView,
  database: DatabaseNodeView,
  cache: CacheNodeView,
  queue: QueueNodeView,
} satisfies Record<NodeType, (props: NodeProps<never>) => ReactNode>;

