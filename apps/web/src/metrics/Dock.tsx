import type { WindowSample } from '@loadline/engine';
import { useMemo, useState } from 'react';
import { useMessages } from '../i18n/index.ts';
import { useSim } from '../sim/store.ts';
import { LineChart } from './LineChart.tsx';
import type { ChartSeries } from './LineChart.tsx';
import { formatClock, formatCount, formatDuration, formatPercent } from './format.ts';

const formatSeconds = (seconds: number) => formatClock(seconds * 1000);

/** The strip along the bottom: what clients are experiencing, now and over the run. */
export function Dock() {
  const m = useMessages();
  const samples = useSim((state) => state.samples);
  const inFlight = useSim((state) => state.totals.created - state.totals.ok - state.totals.failed);
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const last = samples[samples.length - 1];
  const finished = last ? last.ok + last.failed : 0;
  const failing = finished > 0 && last ? last.failed / finished : 0;

  const x = useMemo(() => samples.map((sample) => sample.t / 1000), [samples]);
  const series = useMemo<ChartSeries[]>(
    () => [
      { key: 'p50', label: m.metrics.series.p50, colour: '--color-sea', values: samples.map((sample) => sample.p50) },
      { key: 'p99', label: m.metrics.series.p99, colour: '--color-violet', values: samples.map((sample) => sample.p99) },
    ],
    [samples, m],
  );

  return (
    // The one row is pinned to the dock's height, so a long table scrolls inside it instead of
    // stretching it.
    <section
      className="grid h-64 grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] border-t border-line bg-plate"
      aria-labelledby="metrics-title"
    >
      <div className="flex min-h-0 w-[25rem] flex-col gap-2 border-e border-line p-3">
        <h2 id="metrics-title" className="marking">
          {m.metrics.title}
        </h2>
        <dl className="grid flex-1 grid-cols-3 content-between gap-x-4 gap-y-2">
          <Tile label={m.metrics.requests} value={last ? formatCount(last.created) : '–'} note={m.metrics.perSecond} />
          <Tile label={m.metrics.succeeded} value={last ? formatCount(last.ok) : '–'} note={m.metrics.perSecond} />
          <Tile
            label={m.metrics.errors}
            value={last ? formatPercent(failing) : '–'}
            note={m.metrics.lastSecond}
            alert={failing > 0}
          />
          <Tile label={m.metrics.series.p50} value={last && last.ok > 0 ? formatDuration(last.p50) : '–'} note={m.metrics.median} />
          <Tile label={m.metrics.series.p99} value={last && last.ok > 0 ? formatDuration(last.p99) : '–'} note={m.metrics.tail} />
          <Tile label={m.metrics.inFlight} value={formatCount(inFlight)} />
        </dl>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col gap-1 p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-bold">{m.metrics.latencyTitle}</h3>
          <div className="flex overflow-hidden rounded-[3px] border border-line" role="group" aria-label={m.metrics.view}>
            {(['chart', 'table'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => {
                  setView(option);
                }}
                className={`px-2 py-0.5 text-[0.85rem] ${view === option ? 'bg-ink text-plate' : 'text-ink-2 hover:bg-deck'}`}
              >
                {option === 'chart' ? m.metrics.showChart : m.metrics.showTable}
              </button>
            ))}
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          {view === 'chart' ? (
            <LineChart x={x} series={series} formatX={formatSeconds} formatY={formatDuration} label={m.metrics.chartLabel} />
          ) : (
            <SampleTable samples={samples} />
          )}
          {samples.length === 0 && (
            <p className="absolute inset-0 grid place-items-center text-ink-2">{m.metrics.empty}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function Tile({ label, value, note, alert = false }: { label: string; value: string; note?: string; alert?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[0.85rem] text-ink-2">{label}</dt>
      <dd className="flex items-center gap-1.5 text-[1.55rem] leading-tight font-bold">
        {alert && <span className="size-2 shrink-0 rounded-full bg-oxide" aria-hidden="true" />}
        {value}
      </dd>
      {note !== undefined && <dd className="truncate text-[0.8rem] text-ink-3">{note}</dd>}
    </div>
  );
}

/** The same numbers as the chart, newest first, for reading exact values or without the picture. */
function SampleTable({ samples }: { samples: WindowSample[] }) {
  const m = useMessages();
  const rows = samples.slice(-60).reverse();
  return (
    <div className="h-full overflow-y-auto">
      <table className="w-full border-collapse font-mono text-[0.85rem] tabular-nums">
        <thead className="sticky top-0 bg-plate text-ink-2">
          <tr>
            {[m.metrics.time, m.metrics.requests, m.metrics.series.p50, m.metrics.series.p99, m.metrics.errors].map((heading) => (
              <th key={heading} scope="col" className="border-b border-line py-1 pe-4 text-end font-normal first:text-start">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((sample) => {
            const finished = sample.ok + sample.failed;
            return (
              <tr key={sample.t} className="border-b border-grid">
                <th scope="row" className="py-0.5 pe-4 text-start font-normal">
                  {formatClock(sample.t)}
                </th>
                <td className="pe-4 text-end">{formatCount(sample.created)}</td>
                <td className="pe-4 text-end">{sample.ok > 0 ? formatDuration(sample.p50) : '–'}</td>
                <td className="pe-4 text-end">{sample.ok > 0 ? formatDuration(sample.p99) : '–'}</td>
                <td className="pe-4 text-end">{formatPercent(finished > 0 ? sample.failed / finished : 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
