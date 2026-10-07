import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { FlowEdge } from '../design/model.ts';
import { useMessages } from '../i18n/index.ts';
import { formatPercent } from '../metrics/format.ts';
import { latestSample, useSim } from '../sim/store.ts';
import { DOT_SPEED, dotSpacing, failureEvery } from './traffic.ts';

/**
 * A connection between two parts. The calls made over it in the last second travel along it as
 * dots: the more calls, the closer together, and for the share that failed, every so many dots
 * one is red. A label says how many are failing.
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
  const spacing = dotSpacing(calls);
  const every = failureEvery(failing);
  // A dot is a dash of no length with a round cap. Moving the pattern by one period brings every
  // dot to where the next one was, so the animation repeats without a seam.
  const stream = (period: number, colour: string): CSSProperties =>
    ({
      stroke: colour,
      strokeDasharray: `0 ${period}`,
      animationDuration: `${period / DOT_SPEED}s`,
      '--period': `${period}px`,
    }) as CSSProperties;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={24}
        {...(markerEnd === undefined ? {} : { markerEnd })}
        style={{ stroke: selected ? 'var(--color-ink)' : 'var(--color-ink-3)', strokeWidth: selected ? 2.5 : 1.25 }}
      />
      {calls > 0 && <path d={path} className="flow-traffic" style={stream(spacing, 'var(--color-sea)')} />}
      {/* The failures are drawn over the dots they are among: one in every so many. */}
      {Number.isFinite(every) && <path d={path} className="flow-traffic" style={stream(spacing * every, 'var(--color-oxide)')} />}
      {failing > 0 && (
        <EdgeLabelRenderer>
          <div
            className={`nodrag nopan pointer-events-none absolute px-1.5 py-0.5 font-mono text-[0.8rem] font-bold ${
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
