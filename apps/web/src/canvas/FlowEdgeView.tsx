import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import type { FlowEdge } from '../design/model.ts';
import { useMessages } from '../i18n/index.ts';
import { formatPercent } from '../metrics/format.ts';
import { latestSample, useSim } from '../sim/store.ts';

/**
 * A connection between two parts. Its thickness and the pace of its dashes follow the calls made
 * over it in the last second; its colour and a label say when those calls are failing.
 */
export function FlowEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
}: EdgeProps<FlowEdge>) {
  const m = useMessages();
  const window = useSim((state) => {
    const index = state.edgeIndex[id];
    return index === undefined ? undefined : latestSample(state)?.edges[index];
  });
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  const calls = window?.calls ?? 0;
  const failing = calls > 0 ? (window?.failed ?? 0) / calls : 0;
  // 1.5px at rest, one more for every tenfold increase in traffic.
  const width = 1.5 + Math.min(3.5, Math.log10(1 + calls));
  const pace = Math.max(0.18, 1.6 / Math.log10(10 + calls));
  const colour = failing >= 0.05 ? 'var(--color-oxide)' : failing > 0 ? 'var(--color-signal)' : 'var(--color-sea)';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={24}
        {...(markerEnd === undefined ? {} : { markerEnd })}
        style={{ stroke: selected ? 'var(--color-ink)' : 'var(--color-ink-3)', strokeWidth: selected ? 2.5 : 1.25 }}
      />
      {calls > 0 && (
        <path
          d={path}
          className="flow-traffic"
          style={{ stroke: colour, strokeWidth: Math.max(2, width - 0.5), animationDuration: `${pace}s` }}
        />
      )}
      {failing > 0 && (
        <EdgeLabelRenderer>
          <div
            className={`nodrag nopan pointer-events-none absolute rounded-[3px] px-1.5 py-0.5 font-mono text-[0.8rem] font-bold ${
              failing >= 0.05 ? 'bg-oxide text-plate' : 'bg-signal-wash text-ink'
            }`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {m.edge.failing(formatPercent(failing))}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
