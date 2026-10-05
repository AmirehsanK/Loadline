import type { NodeType } from '@loadline/engine';
import { useDesign } from '../design/store.ts';
import { useMessages } from '../i18n/index.ts';
import { allowedParts } from '../level/rules.ts';
import { PART_ICONS } from './nodes.tsx';

/** The key under which a dragged part's type travels to the canvas. */
export const PART_MIME = 'application/x-loadline-part';

/** The parts that can be added, each a button that can also be dragged onto the canvas. */
export function PartsList({ types }: { types: readonly NodeType[] }) {
  const m = useMessages();
  const addNode = useDesign((state) => state.addNode);
  const count = useDesign((state) => state.nodes.length);

  return (
    <>
      <ul className="flex flex-col gap-1.5">
        {types.map((type) => (
          <li key={type}>
            <button
              type="button"
              aria-label={m.parts.types[type].name}
              aria-describedby={`part-${type}-hint`}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(PART_MIME, type);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              // Pressing adds the part too, stepped down the canvas so new ones do not stack up.
              onClick={() => {
                addNode(type, m.parts.types[type].name, { x: 40 + (count % 6) * 30, y: 220 + (count % 6) * 30 });
              }}
              className="flex w-full cursor-grab items-start gap-2 rounded-[3px] border border-line bg-deck px-2 py-1.5 text-start hover:border-ink active:cursor-grabbing"
            >
              <span className="mt-0.5 text-ink">{PART_ICONS[type]}</span>
              <span>
                <span className="block font-bold">{m.parts.types[type].name}</span>
                <span id={`part-${type}-hint`} className="block text-[0.85rem] leading-snug text-ink-2">
                  {m.parts.types[type].hint}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[0.85rem] text-ink-3">{m.parts.hint}</p>
    </>
  );
}

/** The left-hand panel of the sandbox: every kind of part. */
export function Palette() {
  const m = useMessages();
  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-e border-line bg-plate p-3" aria-labelledby="parts-title">
      <h2 id="parts-title" className="marking">
        {m.parts.title}
      </h2>
      <PartsList types={allowedParts(null)} />
    </aside>
  );
}
