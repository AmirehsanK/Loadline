import type { NodeType } from '@loadline/engine';
import type { ReactNode } from 'react';
import { useDesign } from '../design/store.ts';
import { useMessages } from '../i18n/index.ts';
import { ClientIcon, ServiceIcon } from '../icons.tsx';

/** The key under which a dragged part's type travels to the canvas. */
export const PART_MIME = 'application/x-loadline-part';

const ICONS: Record<NodeType, ReactNode> = { client: <ClientIcon />, service: <ServiceIcon /> };
const TYPES: NodeType[] = ['client', 'service'];

export function Palette() {
  const m = useMessages();
  const addNode = useDesign((state) => state.addNode);
  const count = useDesign((state) => state.nodes.length);

  return (
    <aside className="flex flex-col gap-3 border-e border-line bg-plate p-3" aria-labelledby="parts-title">
      <h2 id="parts-title" className="marking">
        {m.parts.title}
      </h2>
      <ul className="flex flex-col gap-2">
        {TYPES.map((type) => (
          <li key={type}>
            <button
              type="button"
              aria-label={m.parts[type].name}
              aria-describedby={`part-${type}-hint`}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(PART_MIME, type);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              // Pressing adds the part too, stepped down the canvas so new ones do not stack up.
              onClick={() => {
                addNode(type, { x: 40 + (count % 5) * 28, y: 220 + (count % 5) * 28 });
              }}
              className="flex w-full cursor-grab items-start gap-2 rounded-[3px] border border-line bg-deck p-2 text-start hover:border-ink active:cursor-grabbing"
            >
              <span className="mt-0.5 text-ink">{ICONS[type]}</span>
              <span>
                <span className="block font-bold">{m.parts[type].name}</span>
                <span id={`part-${type}-hint`} className="block text-[0.85rem] text-ink-2">
                  {m.parts[type].hint}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[0.85rem] text-ink-3">{m.parts.hint}</p>
    </aside>
  );
}
