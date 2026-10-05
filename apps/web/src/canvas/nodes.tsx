import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { ClientFlowNode, ServiceFlowNode } from '../design/model.ts';
import { useMessages } from '../i18n/index.ts';
import { ClientIcon } from '../icons.tsx';
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

const outline = (selected: boolean | undefined) =>
  selected ? 'outline-2 outline-offset-2 outline-ink' : 'outline-0';

export function ClientNodeView({ id, data, selected }: NodeProps<ClientFlowNode>) {
  const m = useMessages();
  const multiplier = useSim((state) => state.multiplier);
  return (
    <div
      className={`flex w-44 items-center gap-2.5 rounded-full border border-ink bg-plate py-2 ps-3 pe-5 ${outline(selected)}`}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-plate">
        <ClientIcon />
      </span>
      <div className="min-w-0">
        <div className="truncate font-bold">{data.name || id}</div>
        <div className="truncate font-mono text-[0.85rem] text-ink-2">
          {m.node.perSecond(formatCount(data.params.rps * multiplier))}
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function ServiceNodeView({ id, data, selected }: NodeProps<ServiceFlowNode>) {
  const m = useMessages();
  const window = useSim(windowOf(id));
  const gauge = useSim(gaugeOf(id));
  const level = window?.utilization ?? 0;
  const over = level > LOAD_LINE;
  const waiting = gauge?.queued ?? 0;
  return (
    <div className={`flex h-[4.6rem] w-52 overflow-hidden rounded-[3px] border border-ink bg-plate ${outline(selected)}`}>
      <Handle type="target" position={Position.Left} />
      <LoadGauge level={level} label={m.node.load(formatPercent(level))} lineLabel={m.node.loadLine} />
      <div className="flex min-w-0 flex-1 flex-col justify-between py-1.5 ps-2.5 pe-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-bold">{data.name || id}</span>
          <span className={`shrink-0 font-mono text-[0.85rem] ${over ? 'font-bold text-oxide' : 'text-ink-2'}`}>
            {formatPercent(level)}
          </span>
        </div>
        {window && window.arrivals > 0 ? (
          <div className="flex justify-between gap-2 font-mono text-[0.85rem] text-ink-2">
            <span>{m.node.perSecond(formatCount(window.arrivals))}</span>
            <span>{window.ok > 0 ? m.node.tail(formatDuration(window.p99)) : ''}</span>
          </div>
        ) : (
          <div className="text-[0.85rem] text-ink-3">{m.node.idle}</div>
        )}
        <div className={`h-[1.1rem] font-mono text-[0.85rem] ${waiting > 0 ? 'text-signal' : 'text-ink-3'}`}>
          {waiting > 0 ? m.node.waiting(formatCount(waiting)) : ''}
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
