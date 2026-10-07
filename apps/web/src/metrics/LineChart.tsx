import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface ChartSeries {
  key: string;
  label: string;
  /** Name of the CSS custom property that holds the series colour. */
  colour: string;
  values: number[];
}

interface Props {
  x: number[];
  series: ChartSeries[];
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  /** Read out by assistive technology in place of the picture. */
  label: string;
}

interface Hover {
  index: number;
  left: number;
}

interface EndLabel {
  key: string;
  top: number;
  text: string;
}

// Room at the end of the lines for their value labels.
const GUTTER = 62;
const LABEL_HEIGHT = 15;
const X_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/**
 * A line chart over uPlot. The series are fixed for the life of the chart; only their data changes.
 *
 * Reading a value never depends on hovering: each line ends in a label with its latest value, the
 * pointer or the arrow keys bring up every series at one moment, and the dock offers the same
 * numbers as a table.
 */
export function LineChart({ x, series, formatX, formatY, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [ends, setEnds] = useState<EndLabel[]>([]);
  const [origin, setOrigin] = useState({ left: 0, top: 0, width: 0 });

  // The newest props, for the chart's callbacks, which are created once. This effect is declared
  // before the ones below so that it has run by the time they redraw the chart.
  const latest = useRef({ x, series, formatX, formatY });
  useEffect(() => {
    latest.current = { x, series, formatX, formatY };
  });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const style = getComputedStyle(element);
    const token = (name: string) => style.getPropertyValue(name).trim();
    const colours = latest.current.series.map((item) => token(item.colour));
    const muted = token('--color-ink-3');
    const font = `11px ${token('--font-sans')}`;

    const chart = new uPlot(
      {
        width: Math.max(element.clientWidth, 1),
        height: Math.max(element.clientHeight, 1),
        padding: [10, GUTTER, 0, 0],
        legend: { show: false },
        cursor: {
          y: false,
          drag: { x: false, y: false },
          // Each point wears a ring in the surface colour, so it stays clear where lines cross.
          points: { size: 9, width: 2, stroke: token('--color-plate'), fill: (_self, index) => colours[index - 1] ?? muted },
        },
        scales: {
          x: { time: false },
          y: { range: (_self, _min, max) => [0, max > 0 ? max * 1.15 : 1] },
        },
        axes: [
          {
            stroke: muted,
            font,
            size: 26,
            gap: 4,
            space: 70,
            // Whole steps only, so two ticks never round to the same label.
            incrs: X_STEPS,
            grid: { show: false },
            ticks: { show: false },
            values: (_self, ticks) => ticks.map((tick) => latest.current.formatX(tick)),
          },
          {
            stroke: muted,
            font,
            size: 60,
            gap: 8,
            grid: { stroke: token('--color-grid'), width: 1 },
            ticks: { show: false },
            values: (_self, ticks) => ticks.map((tick) => latest.current.formatY(tick)),
          },
        ],
        series: [
          {},
          ...latest.current.series.map((item, index) => ({
            label: item.label,
            stroke: colours[index] ?? muted,
            width: 2,
            cap: 'round' as const,
            points: { show: false },
          })),
        ],
        hooks: {
          setCursor: [
            (self) => {
              const { idx, left } = self.cursor;
              setHover(idx == null || left == null || left < 0 ? null : { index: idx, left });
            },
          ],
          draw: [
            (self) => {
              const current = latest.current;
              const last = current.x.length - 1;
              setOrigin({ left: self.over.offsetLeft, top: self.over.offsetTop, width: self.over.clientWidth });
              if (last < 0) {
                setEnds([]);
                return;
              }
              const labels = current.series
                .map((item) => {
                  const value = item.values[last] ?? 0;
                  return { key: item.key, top: self.valToPos(value, 'y'), text: current.formatY(value) };
                })
                .filter((item) => Number.isFinite(item.top));
              // Labels that would overlap are left out; the legend and the pointer still carry them.
              const apart = labels.every((a) => labels.every((b) => a === b || Math.abs(a.top - b.top) >= LABEL_HEIGHT));
              setEnds(apart ? labels : []);
            },
          ],
        },
      },
      [[], ...latest.current.series.map(() => [])],
      element,
    );
    plot.current = chart;

    const observer = new ResizeObserver(() => {
      chart.setSize({ width: Math.max(element.clientWidth, 1), height: Math.max(element.clientHeight, 1) });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.destroy();
      plot.current = null;
    };
  }, []);

  useEffect(() => {
    plot.current?.setData([x, ...series.map((item) => item.values)]);
  }, [x, series]);

  // The arrow keys step through time the way the pointer does.
  const onKeyDown = (event: KeyboardEvent) => {
    const chart = plot.current;
    if (!chart || x.length === 0) return;
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const from = hover?.index ?? (step < 0 ? x.length : -1);
    const index = Math.max(0, Math.min(x.length - 1, from + step));
    chart.setCursor({ left: chart.valToPos(x[index]!, 'x'), top: 10 });
  };

  const shown = hover !== null && hover.index < x.length ? hover : null;

  return (
    // A chart is always drawn left to right, earlier on the left, whatever the page's direction.
    <div dir="ltr" className="flex h-full min-h-0 flex-col gap-1">
      <ul className="flex gap-4 ps-[60px] text-[0.85rem] text-ink-2" aria-hidden="true">
        {series.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: `var(${item.colour})` }} />
            {item.label}
          </li>
        ))}
      </ul>
      <div
        ref={host}
        role="img"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => plot.current?.setCursor({ left: -10, top: -10 })}
        className="relative min-h-0 flex-1"
      >
        {ends.map((end) => (
          <span
            key={end.key}
            className="pointer-events-none absolute -translate-y-1/2 font-mono text-[11px] font-bold text-ink"
            style={{ left: origin.left + origin.width + 6, top: origin.top + end.top }}
          >
            {end.text}
          </span>
        ))}
        {shown && (
          <div
            className="pointer-events-none absolute top-0 z-10 border-2 border-line bg-plate px-2 py-1.5 font-mono text-[11px] shadow-[3px_3px_0_var(--color-ink)]"
            style={
              // Flip to the other side of the crosshair in the right half, so it never leaves the chart.
              shown.left > origin.width / 2
                ? { right: `calc(100% - ${origin.left + shown.left - 10}px)` }
                : { left: origin.left + shown.left + 10 }
            }
          >
            <div className="mb-1 text-ink-3">{formatX(x[shown.index] ?? 0)}</div>
            {series.map((item) => (
              <div key={item.key} className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-0.5 w-3 rounded-full" style={{ background: `var(${item.colour})` }} />
                <span className="font-bold text-ink">{formatY(item.values[shown.index] ?? 0)}</span>
                <span className="text-ink-2">{item.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
