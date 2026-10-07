import { ReactFlowProvider } from '@xyflow/react';
import { useEffect } from 'react';
import { Canvas } from './canvas/Canvas.tsx';
import { Palette } from './canvas/Palette.tsx';
import { useDesign } from './design/store.ts';
import { Guide } from './guide/Guide.tsx';
import { Home } from './home/Home.tsx';
import { useMessages } from './i18n/index.ts';
import { ForwardIcon, LoadMark } from './icons.tsx';
import { Inspector } from './inspector/Inspector.tsx';
import { Brief } from './level/Brief.tsx';
import { Result } from './level/Result.tsx';
import { Dock } from './metrics/Dock.tsx';
import { HOME, hrefOf } from './route.ts';
import { useRoute } from './session.ts';
import { TopBar } from './topbar/TopBar.tsx';
import { Tour } from './tour/Tour.tsx';

export function App() {
  const m = useMessages();
  const page = useRoute((state) => state.route.page);
  const shared = useRoute((state) => state.shared);
  if (page === 'home') return <Home />;
  if (page === 'guide') return <Guide />;
  // A design from a link is not shown until it has been unpacked and checked.
  if (shared?.status === 'opening') return <Notice title={m.shared.opening} />;
  if (shared?.status === 'refused') return <Notice title={m.shared.refusedTitle} text={m.shared.refused[shared.code]} />;
  return <Workbench />;
}

/** A page with one thing to say, and the way back to the levels. */
function Notice({ title, text }: { title: string; text?: string }) {
  const m = useMessages();
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="flex max-w-[34rem] flex-col items-start gap-3 border border-ink bg-plate p-6 shadow-[6px_6px_0_var(--color-ink)]">
        <p className="flex items-center gap-2 text-ink">
          <LoadMark />
          <span className="marking text-[1.4rem]!">{m.app.name}</span>
        </p>
        <h1 className="text-[1.3rem] font-bold" role="status">
          {title}
        </h1>
        {text !== undefined && <p className="text-ink-2">{text}</p>}
        {text !== undefined && (
          <a href={hrefOf(HOME)} className="flex items-center gap-1.5 rounded-[3px] bg-ink px-3 py-1.5 font-bold text-plate hover:bg-ink-2">
            {m.shared.home}
            <ForwardIcon />
          </a>
        )}
      </div>
    </main>
  );
}

/** Undo and redo from the keyboard, except where a text field has its own. */
function useHistoryKeys(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const key = event.key.toLowerCase();
      const { undo, redo } = useDesign.getState();
      if (key === 'z' && !event.shiftKey) undo();
      else if ((key === 'z' && event.shiftKey) || key === 'y') redo();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}

/** Where a design is drawn and run: the sandbox, or a level with its brief in place of the parts. */
function Workbench() {
  const level = useDesign((state) => state.level);
  const slot = useDesign((state) => state.slot);
  // A design from a link is somebody else's to look at; the tour is for a visitor's own bench.
  const own = useDesign((state) => !state.transient);
  const payload = useRoute((state) => (state.route.page === 'shared' ? state.route.payload : ''));
  useHistoryKeys();

  return (
    <ReactFlowProvider>
      <div className="grid h-dvh min-w-[62rem] grid-rows-[auto_minmax(0,1fr)_auto]">
        <TopBar />
        <div className={`grid min-h-0 ${level ? 'grid-cols-[19rem_minmax(0,1fr)_19rem]' : 'grid-cols-[13rem_minmax(0,1fr)_20rem]'}`}>
          {level ? <Brief level={level} /> : <Palette />}
          <main id="canvas" data-tour="canvas" className="relative min-w-0">
            {/* A different design is a different canvas, fitted to the view afresh. */}
            <Canvas key={slot + payload} />
            {own && <Tour inLevel={level !== null} />}
          </main>
          <Inspector />
        </div>
        <Dock />
        {level && <Result key={level.id} level={level} />}
      </div>
    </ReactFlowProvider>
  );
}
