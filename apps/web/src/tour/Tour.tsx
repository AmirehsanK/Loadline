import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMessages } from '../i18n/index.ts';
import { TOUR_STOPS, useTour } from './state.ts';

const CARD_WIDTH = 320;
const GAP = 12;
const MARGIN = 12;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where on the screen a stop is. Each part of the workbench marks itself with `data-tour`. */
function boxOf(stop: string): Box | null {
  const rect = document.querySelector(`[data-tour="${stop}"]`)?.getBoundingClientRect();
  return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
}

/**
 * Where the card goes: beside what it is about, on whichever side has room, and inside it when it
 * is too large to stand beside, as the canvas is.
 */
function place(box: Box, cardHeight: number): { left: number; top: number } {
  const clamp = (value: number, max: number) => Math.max(MARGIN, Math.min(value, max - MARGIN));
  const centred = box.left + box.width / 2 - CARD_WIDTH / 2;
  const middle = box.top + box.height / 2 - cardHeight / 2;
  let left = centred;
  let top = middle;
  if (box.top + box.height + GAP + cardHeight <= window.innerHeight) top = box.top + box.height + GAP;
  else if (box.top - GAP - cardHeight >= 0) top = box.top - GAP - cardHeight;
  else if (box.left + box.width + GAP + CARD_WIDTH <= window.innerWidth) left = box.left + box.width + GAP;
  else if (box.left - GAP - CARD_WIDTH >= 0) left = box.left - GAP - CARD_WIDTH;
  return { left: clamp(left, window.innerWidth - CARD_WIDTH), top: clamp(top, window.innerHeight - cardHeight) };
}

/** The offer of a tour, and the tour. `inLevel` says which left-hand panel there is to describe. */
export function Tour({ inLevel }: { inLevel: boolean }) {
  const m = useMessages();
  const offered = useTour((state) => state.offered);
  const at = useTour((state) => state.at);
  const start = useTour((state) => state.start);
  const move = useTour((state) => state.move);
  const end = useTour((state) => state.end);
  const card = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [spot, setSpot] = useState({ left: MARGIN, top: MARGIN });
  const stop = at === null ? null : TOUR_STOPS[at]!;

  // Measured after the page has laid itself out, and again whenever the window changes size.
  useLayoutEffect(() => {
    if (stop === null) return;
    const measure = () => {
      const found = boxOf(stop);
      setBox(found);
      if (found) setSpot(place(found, card.current?.offsetHeight ?? 160));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [stop]);

  useEffect(() => {
    if (stop === null) return;
    card.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') end();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [stop, end]);

  if (stop === null || at === null) {
    if (!offered) return null;
    return (
      <div
        role="region"
        aria-label={m.tour.title}
        className="pointer-events-auto absolute inset-x-0 bottom-3 z-10 mx-auto flex w-fit items-center gap-3 border-2 border-ink bg-plate px-3 py-2 whitespace-nowrap shadow-[4px_4px_0_var(--color-ink)]"
      >
        <span>{m.tour.offer}</span>
        <button type="button" onClick={start} className="btn border-2 border-ink bg-pop px-2.5 py-1 font-bold text-ink">
          {m.tour.start}
        </button>
        <button type="button" onClick={end} className="btn border-2 border-line bg-plate px-2.5 py-1 hover:border-ink">
          {m.tour.decline}
        </button>
      </div>
    );
  }

  const words = stop === 'panel' ? m.tour.stops[inLevel ? 'brief' : 'parts'] : m.tour.stops[stop];
  const last = at === TOUR_STOPS.length - 1;
  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {/* A frame round what the card is about. Its shadow is what dims everything else. */}
      {box && (
        <div
          className="absolute outline-3 outline-ink"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height, boxShadow: '0 0 0 100vmax rgb(17 17 17 / 0.45)' }}
        />
      )}
      <div
        ref={card}
        role="dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        tabIndex={-1}
        className="pointer-events-auto absolute flex flex-col gap-2 border-2 border-ink bg-plate p-4 shadow-[6px_6px_0_var(--color-ink)] outline-none"
        style={{ left: spot.left, top: spot.top, width: CARD_WIDTH }}
      >
        <p className="text-[0.85rem] text-ink-3">{m.tour.progress(at + 1, TOUR_STOPS.length)}</p>
        <h2 id="tour-title" className="text-[1.1rem] font-bold">
          {words.title}
        </h2>
        <p id="tour-text" className="text-ink-2">
          {words.text}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <button type="button" onClick={end} className="me-auto text-ink-2 underline hover:text-ink">
            {m.tour.skip}
          </button>
          {at > 0 && (
            <button
              type="button"
              onClick={() => {
                move(-1);
              }}
              className="btn border-2 border-line bg-plate px-2.5 py-1 hover:border-ink"
            >
              {m.tour.back}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              move(1);
            }}
            className="btn border-2 border-ink bg-pop px-3 py-1 font-bold text-ink"
          >
            {last ? m.tour.done : m.tour.next}
          </button>
        </div>
      </div>
    </div>
  );
}
