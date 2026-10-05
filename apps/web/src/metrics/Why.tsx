import type { BlameReport, Bottleneck } from '@loadline/engine';
import { useDesign } from '../design/store.ts';
import type { Messages } from '../i18n/en.ts';
import { useMessages } from '../i18n/index.ts';
import { useSim } from '../sim/store.ts';
import { formatCount } from './format.ts';

/** How many groups of failures to list; the rest are the long tail. */
const SHOWN = 4;

/**
 * The panel that explains a run: where the time has been going over the last few seconds, and
 * what happened to the requests that failed.
 */
export function Why() {
  const m = useMessages();
  const bottleneck = useSim((state) => state.bottleneck);
  const blame = useSim((state) => state.blame);
  const nodes = useDesign((state) => state.nodes);
  const edges = useDesign((state) => state.edges);
  const nameOf = (id: string) => nodes.find((node) => node.id === id)?.data.name || id;

  const explain = (found: Bottleneck): string => {
    const name = nameOf(found.nodeId);
    if (found.kind !== 'pool') return m.why[found.kind](name);
    const target = edges.find((edge) => edge.id === found.edgeId)?.target;
    return m.why.pool(name, target === undefined ? '' : nameOf(target));
  };
  // The parts the slowness passes through before it reaches the one at the end of the trail.
  const through = bottleneck ? bottleneck.path.slice(0, -1).map(nameOf) : [];

  return (
    <div className="flex min-h-0 w-[22rem] flex-col gap-3 overflow-y-auto border-s border-line p-3">
      <section aria-labelledby="where-title">
        <h3 id="where-title" className="mb-1 font-bold">
          {m.why.title}
        </h3>
        <p role="status">{bottleneck ? explain(bottleneck) : m.why.quiet}</p>
        {through.length > 0 && <p className="text-[0.9rem] text-ink-3">{m.why.via(through)}</p>}
      </section>
      <section aria-labelledby="failures-title">
        <h3 id="failures-title" className="mb-1 font-bold">
          {m.why.failuresTitle}
        </h3>
        {blame.length === 0 ? (
          <p className="text-ink-2">{m.why.none}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {blame.slice(0, SHOWN).map((group) => (
              <li key={`${group.cause}-${group.nodeId}-${group.where ?? ''}`} className="flex gap-2">
                <span className="w-12 shrink-0 text-end font-mono font-bold tabular-nums">{formatCount(group.count)}</span>
                <span>{describe(group, nameOf(group.nodeId), m)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** What happened to one group of failed requests, in words. */
function describe(group: BlameReport, name: string, m: Messages): string {
  if (group.cause === 'timeout') return m.why.timeout[group.where ?? 'free'](name);
  return m.why[group.cause](name);
}
