import { LEVELS } from '@loadline/scenarios';
import type { ObjectiveResult, Scenario } from '@loadline/scenarios';
import { useEffect, useRef, useState } from 'react';
import { useLevelText, useMessages } from '../i18n/index.ts';
import { CheckIcon, CrossIcon, ForwardIcon, StarIcon } from '../icons.tsx';
import { hrefOf } from '../route.ts';
import { useSim } from '../sim/store.ts';
import { describeObjective, describeValue } from './objectives.ts';

/** Three marks, as many filled as were earned. With `stamped`, the earned ones land one by one. */
export function Stars({ earned, size = 16, label, stamped = false }: { earned: number; size?: number; label: string; stamped?: boolean }) {
  return (
    <span className="inline-flex gap-0.5 text-ink" role="img" aria-label={label}>
      {[1, 2, 3].map((star) => (
        <span
          key={star}
          className={`inline-flex ${star <= earned ? (stamped ? 'stamp' : '') : 'text-line'}`}
          style={stamped ? { animationDelay: `${180 + star * 170}ms` } : undefined}
        >
          <StarIcon earned={star <= earned} size={size} />
        </span>
      ))}
    </span>
  );
}

export function ResultRow({ result }: { result: ObjectiveResult }) {
  const m = useMessages();
  return (
    <li className="grid grid-cols-[1.1rem_minmax(0,1fr)_auto] items-baseline gap-x-2">
      <span
        className={`grid size-[1.1rem] translate-y-0.5 place-items-center rounded-full text-plate ${result.met ? 'bg-sea' : 'bg-oxide'}`}
      >
        {result.met ? <CheckIcon /> : <CrossIcon />}
        <span className="sr-only">{result.met ? m.level.met : m.level.missed}</span>
      </span>
      <span>{describeObjective(result.objective, m)}</span>
      <span className={`font-mono ${result.met ? 'text-ink-2' : 'font-bold text-oxide'}`}>{describeValue(result, m)}</span>
    </li>
  );
}

/**
 * What a finished run of a level came to. It opens by itself when the run ends and can be put
 * away to look at the canvas; the result stays in the panel on the left.
 */
export function Result({ level }: { level: Scenario }) {
  const m = useMessages();
  const text = useLevelText(level);
  const finished = useSim((state) => state.status === 'finished');
  const outcome = useSim((state) => state.level?.outcome);
  const dialog = useRef<HTMLDialogElement>(null);
  // Put away by the player; a new result opens it again.
  const [dismissed, setDismissed] = useState(false);
  const [wasFinished, setWasFinished] = useState(finished);
  if (finished !== wasFinished) {
    setWasFinished(finished);
    setDismissed(false);
  }
  const open = finished && outcome !== undefined && !dismissed;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const next = LEVELS[LEVELS.indexOf(level) + 1];
  const passed = outcome?.passed ?? false;
  const stars = outcome?.stars ?? 0;
  // The first tier that was not earned says what a better answer would have to do.
  const nextTier = passed && stars < 3 ? outcome?.bonus[stars - 1] : undefined;

  return (
    <dialog
      ref={dialog}
      aria-labelledby="result-title"
      onClose={() => {
        setDismissed(true);
      }}
      className="m-auto w-[34rem] max-w-[calc(100vw-2rem)] rounded-[3px] border border-ink bg-plate p-0 text-ink shadow-[6px_6px_0_var(--color-ink)] backdrop:bg-ink/40"
    >
      {outcome && (
        <div className="flex max-h-[calc(100dvh-4rem)] flex-col">
          <header className={`flex items-center justify-between gap-4 px-5 py-3 ${passed ? 'bg-sea-wash' : 'bg-oxide-wash'}`}>
            <div>
              <p className="font-mono text-[0.85rem] text-ink-2">{text.title}</p>
              <h2 id="result-title" className="marking text-[2rem]!">
                {passed ? m.level.result.passed : m.level.result.failed}
              </h2>
            </div>
            {passed && <Stars earned={stars} size={30} label={m.level.result.stars(stars)} stamped />}
          </header>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
            {outcome.issues.length > 0 ? (
              <p>{m.level.result.blocked}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {outcome.results.map((result, index) => (
                  <ResultRow key={index} result={result} />
                ))}
              </ul>
            )}

            {outcome.broken.length > 0 && (
              <div className="rounded-[3px] bg-oxide-wash px-2 py-1.5">
                <p className="font-bold">{m.level.rules}</p>
                <ul className="list-disc ps-4">
                  {[...new Set(outcome.broken.map((rule) => text.rules?.[rule] ?? m.level.brokenRule))].map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            {nextTier && nextTier.length > 0 && (
              <section className="border-t border-line pt-3">
                <h3 className="mb-1.5 font-bold">{m.level.result.nextStar}</h3>
                <ul className="flex flex-col gap-1.5">
                  {nextTier.map((result, index) => (
                    <ResultRow key={index} result={result} />
                  ))}
                </ul>
              </section>
            )}

            {passed && (
              <section className="border-t border-line pt-3">
                <h3 className="mb-1.5 font-bold">{m.level.result.debrief}</h3>
                <p>{text.debrief}</p>
              </section>
            )}
            {passed && !next && <p className="text-ink-2">{m.level.result.allDone}</p>}
          </div>

          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              onClick={() => {
                dialog.current?.close();
              }}
              className="rounded-[3px] border border-line px-3 py-1.5 hover:border-ink"
            >
              {passed ? m.level.result.stay : m.level.result.retry}
            </button>
            {passed && (
              <a
                href={hrefOf(next ? { page: 'level', id: next.id } : { page: 'sandbox' })}
                className="flex items-center gap-1.5 rounded-[3px] bg-ink px-3 py-1.5 font-bold text-plate hover:bg-ink-2"
              >
                {next ? m.level.result.next : m.level.result.toSandbox}
                <ForwardIcon />
              </a>
            )}
          </footer>
        </div>
      )}
    </dialog>
  );
}
