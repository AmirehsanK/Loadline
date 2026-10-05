import { useId } from 'react';
import { useDesign } from '../design/store.ts';
import { useMessages } from '../i18n/index.ts';
import { BoltIcon, LoadMark, PauseIcon, PlayIcon, RestartIcon } from '../icons.tsx';
import { formatClock, formatCount } from '../metrics/format.ts';
import { inject, pause, play, restart, setMultiplier, setSpeed } from '../sim/controller.ts';
import { useSim } from '../sim/store.ts';

const SPEEDS = [1, 2, 5, 10];

export function TopBar() {
  const m = useMessages();
  const status = useSim((state) => state.status);
  const now = useSim((state) => state.now);
  const failure = useSim((state) => state.failure);
  const running = status === 'running';

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-plate px-4 py-2">
      <a href="#canvas" className="sr-only focus:not-sr-only">
        {m.app.skipToCanvas}
      </a>
      <h1 className="flex items-center gap-2 text-ink">
        <LoadMark />
        <span className="marking text-[1.75rem]!">{m.app.name}</span>
      </h1>

      <div className="flex items-center gap-1.5" role="group" aria-label={m.run.controls}>
        <button
          type="button"
          disabled={status === 'blocked'}
          onClick={running ? pause : play}
          className="flex w-24 items-center justify-center gap-1.5 rounded-[3px] bg-ink px-3 py-1.5 font-bold text-plate hover:bg-ink-2 disabled:cursor-not-allowed disabled:bg-ink-3"
        >
          {running ? <PauseIcon /> : <PlayIcon />}
          {running ? m.run.pause : m.run.play}
        </button>
        <button
          type="button"
          disabled={status === 'blocked'}
          onClick={() => {
            restart();
          }}
          className="flex items-center gap-1.5 rounded-[3px] border border-line px-3 py-1.5 hover:border-ink disabled:cursor-not-allowed disabled:text-ink-3"
        >
          <RestartIcon />
          {m.run.restart}
        </button>
      </div>

      <SpeedPicker />
      <TrafficControl />

      <div className="ms-auto flex items-baseline gap-2">
        <span className="text-[0.85rem] text-ink-2">{m.run.clock}</span>
        <span className="text-[1.15rem] font-bold tabular-nums">{formatClock(now)}</span>
      </div>

      <RunNotice />
      {status === 'failed' && failure !== null && (
        <p className="w-full rounded-[3px] bg-oxide-wash px-2 py-1" role="alert">
          <strong>{m.run.failed}.</strong> {failure}
        </p>
      )}
      {status === 'blocked' && <p className="w-full rounded-[3px] bg-oxide-wash px-2 py-1">{m.run.blocked}</p>}
    </header>
  );
}

function SpeedPicker() {
  const m = useMessages();
  const speed = useSim((state) => state.speed);
  return (
    <div className="flex items-center gap-2">
      <span id="speed-label" className="text-[0.85rem] text-ink-2">
        {m.run.speed}
      </span>
      <div className="flex overflow-hidden rounded-[3px] border border-line" role="group" aria-labelledby="speed-label">
        {SPEEDS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={speed === option}
            onClick={() => {
              setSpeed(option);
            }}
            className={`px-2.5 py-1 font-mono ${speed === option ? 'bg-ink text-plate' : 'text-ink-2 hover:bg-deck'}`}
          >
            {m.run.speedOption(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Scales every client's rate, live. This is the control for finding where a design gives way. */
function TrafficControl() {
  const m = useMessages();
  const id = useId();
  const multiplier = useSim((state) => state.multiplier);
  const running = useSim((state) => state.status === 'running');
  const base = useDesign((state) =>
    state.nodes.reduce((sum, node) => (node.type === 'client' ? sum + node.data.params.rps : sum), 0),
  );
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-[0.85rem] text-ink-2">
        {m.run.traffic}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={4}
        step={0.1}
        value={multiplier}
        onChange={(event) => {
          setMultiplier(Number(event.target.value));
        }}
        className="w-40 accent-ink"
      />
      <output htmlFor={id} className="w-44 font-mono whitespace-nowrap tabular-nums">
        {m.run.trafficValue(multiplier.toFixed(1), formatCount(base * multiplier))}
      </output>
      <button
        type="button"
        disabled={!running}
        onClick={() => {
          inject({ type: 'traffic', multiplier: 3, durationMs: 10_000 });
        }}
        className="flex items-center gap-1.5 rounded-[3px] border border-line px-2.5 py-1 hover:border-oxide hover:text-oxide disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:border-line"
      >
        <BoltIcon />
        {m.run.spike}
      </button>
    </div>
  );
}

/** Says so when the simulation is running slower than the speed that was asked for. */
function RunNotice() {
  const m = useMessages();
  const behind = useSim(
    (state) => state.status === 'running' && state.now > 2000 && state.measuredSpeed < state.speed * 0.85,
  );
  const measured = useSim((state) => state.measuredSpeed);
  if (!behind) return null;
  return (
    <p className="w-full rounded-[3px] bg-signal-wash px-2 py-1" role="status">
      {m.run.behind(measured.toFixed(1))}
    </p>
  );
}
