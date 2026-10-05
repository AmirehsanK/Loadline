import { ReactFlowProvider } from '@xyflow/react';
import { useEffect } from 'react';
import { Canvas } from './canvas/Canvas.tsx';
import { Palette } from './canvas/Palette.tsx';
import { useDesign } from './design/store.ts';
import { Home } from './home/Home.tsx';
import { Inspector } from './inspector/Inspector.tsx';
import { Brief } from './level/Brief.tsx';
import { Result } from './level/Result.tsx';
import { Dock } from './metrics/Dock.tsx';
import { useRoute } from './session.ts';
import { TopBar } from './topbar/TopBar.tsx';

export function App() {
  const page = useRoute((state) => state.route.page);
  return page === 'home' ? <Home /> : <Workbench />;
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
  useHistoryKeys();

  return (
    <ReactFlowProvider>
      <div className="grid h-dvh min-w-[62rem] grid-rows-[auto_minmax(0,1fr)_auto]">
        <TopBar />
        <div className={`grid min-h-0 ${level ? 'grid-cols-[19rem_minmax(0,1fr)_19rem]' : 'grid-cols-[13rem_minmax(0,1fr)_20rem]'}`}>
          {level ? <Brief level={level} /> : <Palette />}
          <main id="canvas" className="min-w-0">
            {/* A different design is a different canvas, fitted to the view afresh. */}
            <Canvas key={slot} />
          </main>
          <Inspector />
        </div>
        <Dock />
        {level && <Result key={level.id} level={level} />}
      </div>
    </ReactFlowProvider>
  );
}
