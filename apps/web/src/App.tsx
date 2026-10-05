import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './canvas/Canvas.tsx';
import { Palette } from './canvas/Palette.tsx';
import { Inspector } from './inspector/Inspector.tsx';
import { Dock } from './metrics/Dock.tsx';
import { TopBar } from './topbar/TopBar.tsx';

export function App() {
  return (
    <ReactFlowProvider>
      <div className="grid h-dvh min-w-[62rem] grid-rows-[auto_minmax(0,1fr)_auto]">
        <TopBar />
        <div className="grid min-h-0 grid-cols-[13rem_minmax(0,1fr)_20rem]">
          <Palette />
          <main id="canvas" className="min-w-0">
            <Canvas />
          </main>
          <Inspector />
        </div>
        <Dock />
      </div>
    </ReactFlowProvider>
  );
}
