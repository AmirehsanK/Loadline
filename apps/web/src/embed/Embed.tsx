import { findLevel } from '@loadline/scenarios';
import type { Scenario } from '@loadline/scenarios';
import { ShareError, decodeShare } from '@loadline/share';
import type { ShareErrorCode } from '@loadline/share';
import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useState } from 'react';
import { Canvas } from '../canvas/Canvas.tsx';
import { useDesign } from '../design/store.ts';
import { useLevelText, useMessages } from '../i18n/index.ts';
import { ForwardIcon, LoadMark, PauseIcon, PlayIcon, RestartIcon } from '../icons.tsx';
import { Stars } from '../level/Result.tsx';
import { formatClock, formatCount, formatDuration, formatPercent } from '../metrics/format.ts';
import { hrefOf } from '../route.ts';
import { pause, play, restart } from '../sim/controller.ts';
import { latestSample, useSim } from '../sim/store.ts';

/** The key the embedded design is held under. Nothing is ever saved there. */
const EMBED_SLOT = 'loadline:embed';

/** What became of the design in the address: `open`, or why it could not be. */
type Outcome = 'open' | ShareErrorCode;

/** The fragment of the address, kept up to date. */
function useFragment(): string {
  const [fragment, setFragment] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => {
      setFragment(window.location.hash);
    };
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
    };
  }, []);
  return fragment;
}

/**
 * A design from a link, on someone else's page: the canvas, a run button, and the numbers that
 * matter. It cannot be edited here; the link at the end opens it where it can.
 */
export function Embed() {
  const m = useMessages();
  const payload = useFragment().replace(/^#\/?/, '');
  // Which payload has been dealt with, and how it went. Until it matches the address, it is opening.
  const [done, setDone] = useState<{ payload: string; outcome: Outcome } | null>(null);

  useEffect(() => {
    if (payload === '') return;
    let current = true;
    // The address is untrusted: nothing is drawn until it has been unpacked and checked.
    decodeShare(payload).then(
      (share) => {
        if (!current) return;
        const level = share.level === undefined ? undefined : findLevel(share.level);
        useDesign.getState().open(EMBED_SLOT, share.design, level ?? null, { seed: share.seed, workload: share.workload, transient: true });
        setDone({ payload, outcome: 'open' });
      },
      (error: unknown) => {
        if (current) setDone({ payload, outcome: error instanceof ShareError ? error.code : 'corrupt' });
      },
    );
    return () => {
      current = false;
    };
  }, [payload]);

  if (payload === '') return <Message text={m.embed.empty} />;
  if (done?.payload !== payload) return <Message text={m.shared.opening} />;
  if (done.outcome !== 'open') return <Message text={`${m.shared.refusedTitle}. ${m.shared.refused[done.outcome]}`} />;

  return (
    <ReactFlowProvider>
      <div className="grid h-dvh grid-rows-[minmax(0,1fr)_auto]">
        <main className="min-h-0">
          <Canvas key={payload} readOnly />
        </main>
        <Strip payload={payload} />
      </div>
    </ReactFlowProvider>
  );
}

function Message({ text }: { text: string }) {
  return (
    <div className="grid h-dvh place-items-center p-6">
      <p className="flex max-w-[30rem] items-center gap-3 text-ink-2">
        <LoadMark size={28} />
        {text}
      </p>
    </div>
  );
}

function Figure({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[0.85rem] text-ink-2">{label}</dt>
      <dd className={`font-mono font-bold tabular-nums ${alert ? 'text-oxide' : ''}`}>{value}</dd>
    </div>
  );
}

/** The bar under the canvas: run and restart, what clients see, and the way to the full app. */
function Strip({ payload }: { payload: string }) {
  const m = useMessages();
  const status = useSim((state) => state.status);
  const now = useSim((state) => state.now);
  const last = useSim(latestSample);
  const cost = useSim((state) => state.monthlyCost);
  const level = useDesign((state) => state.level);
  const running = status === 'running';
  const finished = last ? last.ok + last.failed : 0;
  const failing = finished > 0 && last ? last.failed / finished : 0;

  return (
    <footer className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line bg-plate px-3 py-2">
      <div className="flex items-center gap-1.5" role="group" aria-label={m.run.controls}>
        <button
          type="button"
          disabled={status === 'blocked'}
          onClick={running ? pause : play}
          className="flex min-w-20 items-center justify-center gap-1.5 rounded-[3px] bg-ink px-3 py-1 font-bold whitespace-nowrap text-plate hover:bg-ink-2 disabled:bg-ink-3"
        >
          {running ? <PauseIcon /> : <PlayIcon />}
          {running ? m.run.pause : status === 'finished' ? m.run.again : m.run.play}
        </button>
        <button
          type="button"
          disabled={status === 'blocked'}
          aria-label={m.run.restart}
          title={m.run.restart}
          onClick={() => {
            restart(false);
          }}
          className="rounded-[3px] border border-line p-1.5 hover:border-ink disabled:text-ink-3"
        >
          <RestartIcon />
        </button>
      </div>

      <span className="font-mono tabular-nums" aria-label={m.run.clock}>
        {level ? m.run.progress(formatClock(now), formatClock(level.durationMs)) : formatClock(now)}
      </span>

      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Figure label={m.metrics.requests} value={last ? m.node.perSecond(formatCount(last.created)) : '–'} />
        <Figure label={m.metrics.series.p99} value={last && last.ok > 0 ? formatDuration(last.p99) : '–'} />
        <Figure label={m.metrics.errors} value={last ? formatPercent(failing) : '–'} alert={failing > 0} />
        <Figure label={m.metrics.cost} value={m.metrics.dollars(formatCount(cost))} />
      </dl>

      {level && <LevelResult level={level} />}

      <a
        href={`./${hrefOf({ page: 'shared', payload })}`}
        target="_blank"
        rel="noopener"
        className="ms-auto flex items-center gap-1.5 font-bold underline decoration-line underline-offset-4 hover:decoration-ink"
      >
        <LoadMark size={16} />
        {m.embed.open}
        <ForwardIcon />
      </a>
    </footer>
  );
}

/** For a design that answers a level: which level, and once the run has ended, how it did. */
function LevelResult({ level }: { level: Scenario }) {
  const m = useMessages();
  const text = useLevelText(level);
  const frame = useSim((state) => state.level);
  const result = frame?.finished ? frame.outcome : null;
  return (
    <p className="flex items-center gap-2" role="status">
      <span className="marking text-[1rem]!">{text.title}</span>
      {result &&
        (result.passed ? (
          <Stars earned={result.stars} label={m.level.result.stars(result.stars)} />
        ) : (
          <span className="font-bold text-oxide">{m.level.result.failed}</span>
        ))}
    </p>
  );
}
