import type { Scenario } from '@loadline/scenarios';
import { useId } from 'react';
import { useDesign } from '../design/store.ts';
import { useLevelText, useMessages } from '../i18n/index.ts';
import { BackIcon, BoltIcon, LoadMark, PauseIcon, PlayIcon, RedoIcon, RestartIcon, UndoIcon } from '../icons.tsx';
import { Timeline, scriptOfLevel, scriptOfWorkload } from '../level/Timeline.tsx';
import { ShareButton } from '../share/ShareDialog.tsx';
import { formatClock, formatCount } from '../metrics/format.ts';
import { HOME, hrefOf } from '../route.ts';
import { keepShared, useRoute } from '../session.ts';
import { inject, pause, play, restart, setMultiplier, setSpeed } from '../sim/controller.ts';
import { FULL_SPEED } from '../sim/protocol.ts';
import { useSim } from '../sim/store.ts';

const SPEEDS = [1, 2, 5, 10];

const quiet = 'rounded-[3px] border border-line hover:border-ink disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:border-line';

export function TopBar() {
  const m = useMessages();
  const level = useDesign((state) => state.level);
  const workload = useDesign((state) => state.workload);
  const status = useSim((state) => state.status);
  const failure = useSim((state) => state.failure);
  const running = status === 'running';

  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-plate px-4 py-2">
      <a href="#canvas" className="sr-only focus:not-sr-only">
        {m.app.skipToCanvas}
      </a>
      <h1 className="flex items-center gap-2 text-ink">
        <LoadMark />
        <span className="marking text-[1.75rem]!">{m.app.name}</span>
      </h1>
      <a href={hrefOf(HOME)} className="flex items-center gap-1.5 text-ink-2 hover:text-ink">
        <BackIcon />
        {m.level.back}
      </a>

      <div className="flex items-center gap-1.5" role="group" aria-label={m.run.controls}>
        <button
          type="button"
          disabled={status === 'blocked'}
          onClick={running ? pause : play}
          className="flex min-w-24 items-center justify-center gap-1.5 rounded-[3px] bg-ink px-3 py-1.5 font-bold whitespace-nowrap text-plate hover:bg-ink-2 disabled:cursor-not-allowed disabled:bg-ink-3"
        >
          {running ? <PauseIcon /> : <PlayIcon />}
          {running ? m.run.pause : status === 'finished' ? m.run.again : m.run.play}
        </button>
        <button
          type="button"
          disabled={status === 'blocked'}
          onClick={() => {
            restart();
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 ${quiet}`}
        >
          <RestartIcon />
          {m.run.restart}
        </button>
      </div>

      <History />
      <ShareButton />
      <SpeedPicker ends={level !== null} />
      {level ? (
        <Timeline script={scriptOfLevel(level)} />
      ) : workload ? (
        <Scripted />
      ) : (
        <>
          <TrafficControl />
          <Clock />
        </>
      )}

      <RunNotice />
      <SharedNotice />
      {status === 'failed' && failure !== null && (
        <p className="w-full rounded-[3px] bg-oxide-wash px-2 py-1" role="alert">
          <strong>{m.run.failed}.</strong> {failure}
        </p>
      )}
      {status === 'blocked' && <p className="w-full rounded-[3px] bg-oxide-wash px-2 py-1">{m.run.blocked}</p>}
    </header>
  );
}

/** A sandbox design that came with traffic of its own: its timeline, and a way back to the control. */
function Scripted() {
  const m = useMessages();
  const workload = useDesign((state) => state.workload);
  const dropWorkload = useDesign((state) => state.dropWorkload);
  if (!workload) return null;
  return (
    <>
      <Timeline script={scriptOfWorkload(workload)} />
      <button type="button" onClick={dropWorkload} title={m.shared.scripted} className={`px-2.5 py-1 ${quiet}`}>
        {m.shared.unscript}
      </button>
    </>
  );
}

function Clock() {
  const m = useMessages();
  const now = useSim((state) => state.now);
  return (
    <div className="ms-auto flex items-baseline gap-2">
      <span className="text-[0.85rem] text-ink-2">{m.run.clock}</span>
      <span className="text-[1.15rem] font-bold tabular-nums">{formatClock(now)}</span>
    </div>
  );
}

/** Undo and redo. The keyboard shortcuts for them are set up with the workbench. */
function History() {
  const m = useMessages();
  const canUndo = useDesign((state) => state.past.length > 0);
  const canRedo = useDesign((state) => state.future.length > 0);
  const undo = useDesign((state) => state.undo);
  const redo = useDesign((state) => state.redo);
  return (
    <div className="flex items-center gap-1" role="group">
      <button type="button" disabled={!canUndo} onClick={undo} aria-label={m.edit.undo} title={m.edit.undo} className={`p-2 ${quiet}`}>
        <UndoIcon />
      </button>
      <button type="button" disabled={!canRedo} onClick={redo} aria-label={m.edit.redo} title={m.edit.redo} className={`p-2 ${quiet}`}>
        <RedoIcon />
      </button>
    </div>
  );
}

/** How fast simulated time passes. A run that ends can also go as fast as it will. */
function SpeedPicker({ ends }: { ends: boolean }) {
  const m = useMessages();
  const speed = useSim((state) => state.speed);
  const options = ends ? [...SPEEDS, FULL_SPEED] : SPEEDS;
  return (
    <div className="flex items-center gap-2">
      <span id="speed-label" className="text-[0.85rem] text-ink-2">
        {m.run.speed}
      </span>
      <div className="flex overflow-hidden rounded-[3px] border border-line" role="group" aria-labelledby="speed-label">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={speed === option}
            onClick={() => {
              setSpeed(option);
            }}
            className={`px-2.5 py-1 font-mono ${speed === option ? 'bg-ink text-plate' : 'text-ink-2 hover:bg-deck'}`}
          >
            {option === FULL_SPEED ? m.run.fullSpeed : m.run.speedOption(option)}
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

/** Over a design that came from a link: that it is not the visitor's, and how to make it so. */
function SharedNotice() {
  const m = useMessages();
  const open = useRoute((state) => state.shared?.status === 'open');
  const level = useDesign((state) => state.level);
  if (!open) return null;
  return level ? <SharedLevelNotice level={level} /> : <SharedBar text={m.shared.banner} keep={m.shared.keepSandbox} />;
}

function SharedLevelNotice({ level }: { level: Scenario }) {
  const m = useMessages();
  return <SharedBar text={m.shared.bannerLevel(useLevelText(level).title)} keep={m.shared.keepLevel} />;
}

function SharedBar({ text, keep }: { text: string; keep: string }) {
  const m = useMessages();
  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-[3px] bg-shallows px-2 py-1" role="status">
      <p>{text}</p>
      <button type="button" onClick={keepShared} className="rounded-[3px] border border-ink bg-plate px-2.5 py-0.5 font-bold hover:bg-ink hover:text-plate">
        {keep}
      </button>
      <span className="text-[0.85rem] text-ink-3">{m.shared.keepNote}</span>
    </div>
  );
}

/** Says so when the simulation is running slower than the speed that was asked for. */
function RunNotice() {
  const m = useMessages();
  const behind = useSim(
    (state) =>
      state.status === 'running' && state.speed !== FULL_SPEED && state.now > 2000 && state.measuredSpeed < state.speed * 0.85,
  );
  const measured = useSim((state) => state.measuredSpeed);
  if (!behind) return null;
  return (
    <p className="w-full rounded-[3px] bg-signal-wash px-2 py-1" role="status">
      {m.run.behind(measured.toFixed(1))}
    </p>
  );
}
