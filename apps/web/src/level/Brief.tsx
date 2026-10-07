import { LEVELS } from '@loadline/scenarios';
import type { ObjectiveResult, Outcome, Scenario } from '@loadline/scenarios';
import { useState } from 'react';
import { PartsList } from '../canvas/Palette.tsx';
import { useDesign } from '../design/store.ts';
import { useLevelText, useMessages } from '../i18n/index.ts';
import { CheckIcon, CrossIcon, StarIcon } from '../icons.tsx';
import { formatClock } from '../metrics/format.ts';
import { hrefOf } from '../route.ts';
import { useSim } from '../sim/store.ts';
import { describeObjective, describeValue, isMeasured } from './objectives.ts';
import { allowedParts } from './rules.ts';

/**
 * The left-hand panel while a level is played: what is going on, what has to be achieved and how
 * the run stands against it, help when it is wanted, and the parts that may be added.
 */
export function Brief({ level }: { level: Scenario }) {
  const m = useMessages();
  const text = useLevelText(level);
  const index = LEVELS.indexOf(level) + 1;
  const parts = allowedParts(level);

  return (
    <aside data-tour="panel" className="flex min-h-0 flex-col gap-4 overflow-y-auto border-e border-line bg-plate p-3" aria-labelledby="level-title">
      <header className="flex flex-col gap-1.5">
        <p className="font-mono text-[0.85rem] text-ink-2">{m.level.number(index, LEVELS.length)}</p>
        <h2 id="level-title" className="marking text-[1.6rem]!">
          {text.title}
        </h2>
        <p>{text.brief}</p>
      </header>

      <Objectives level={level} />
      {/* Remounted for each level, so one level's revealed hints do not carry over to the next. */}
      <Hints key={level.id} level={level} />

      <section className="flex flex-col gap-2" aria-labelledby="parts-title">
        <h3 id="parts-title" className="marking">
          {m.level.parts}
        </h3>
        {parts.length > 0 ? <PartsList types={parts} /> : <p className="text-ink-2">{m.level.noParts}</p>}
      </section>

      <StartOver level={level} />
    </aside>
  );
}

/** How one objective stands: a mark, what it asks, and what the run has achieved. */
function ObjectiveRow({ result, outcome, now }: { result: ObjectiveResult; outcome: Outcome; now: number }) {
  const m = useMessages();
  const measured = isMeasured(result, outcome, now);
  const state = !measured ? 'pending' : result.met ? 'met' : 'missed';
  return (
    <li className="grid grid-cols-[1.1rem_minmax(0,1fr)] gap-x-1.5">
      <span
        className={`mt-0.5 grid size-[1.1rem] place-items-center rounded-full ${
          state === 'met' ? 'bg-sea text-plate' : state === 'missed' ? 'bg-oxide text-plate' : 'border border-line'
        }`}
      >
        {state === 'met' && <CheckIcon />}
        {state === 'missed' && <CrossIcon />}
        <span className="sr-only">{m.level[state]}</span>
      </span>
      <span>{describeObjective(result.objective, m)}</span>
      <span className={`col-start-2 font-mono text-[0.9rem] ${state === 'missed' ? 'font-bold text-oxide' : 'text-ink-2'}`}>
        {measured ? describeValue(result, m) : '–'}
      </span>
    </li>
  );
}

function Objectives({ level }: { level: Scenario }) {
  const m = useMessages();
  const text = useLevelText(level);
  const frame = useSim((state) => state.level);
  const now = useSim((state) => state.now);
  // A run that has not reported yet, or a design that cannot run, has judged nothing. The
  // objectives are listed all the same, waiting.
  const judged = frame && frame.outcome.results.length > 0 ? frame.outcome : null;
  const outcome = judged ?? NOTHING;
  const measuredAt = judged ? now : 0;
  const waiting = (objectives: Scenario['objectives']): ObjectiveResult[] =>
    objectives.map((objective) => ({ objective, value: 0, met: false }));
  const results = judged ? judged.results : waiting(level.objectives);
  const bonus = level.bonus.map((tier, index) => (judged ? judged.bonus[index]! : waiting(tier)));
  const broken = frame?.outcome.broken ?? [];

  return (
    <section className="flex flex-col gap-2" aria-labelledby="objectives-title">
      <h3 id="objectives-title" className="marking">
        {m.level.objectives}
      </h3>
      <ul className="flex flex-col gap-2" aria-live="off">
        {results.map((result, index) => (
          <ObjectiveRow key={index} result={result} outcome={outcome} now={measuredAt} />
        ))}
      </ul>
      {level.warmupMs > 0 && <p className="text-[0.85rem] text-ink-3">{m.level.scoredFrom(formatClock(level.warmupMs))}</p>}

      {broken.length > 0 && (
        <div className="rounded-[3px] bg-oxide-wash px-2 py-1.5" role="alert">
          <p className="font-bold">{m.level.rules}</p>
          <ul className="list-disc ps-4">
            {[...new Set(broken.map((rule) => text.rules?.[rule] ?? m.level.brokenRule))].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {bonus.map((tier, index) => (
        <div key={index} className="flex flex-col gap-1.5 border-t border-line pt-2">
          <p className="flex items-center gap-1 text-[0.85rem] text-ink-2">
            <span className="flex text-ink" aria-hidden="true">
              {Array.from({ length: index + 2 }, (_, star) => (
                <StarIcon key={star} earned size={12} />
              ))}
            </span>
            {m.level.star(index + 2)}
          </p>
          <ul className="flex flex-col gap-2">
            {tier.map((result, row) => (
              <ObjectiveRow key={row} result={result} outcome={outcome} now={measuredAt} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** An outcome with nothing in it, for showing objectives before a run has reported. */
const NOTHING: Outcome = {
  passed: false,
  stars: 0,
  results: [],
  bonus: [[], []],
  broken: [],
  issues: [],
  score: { fromMs: 0, ok: 0, failed: 0, meanMs: 0, p50: 0, p95: 0, p99: 0 },
  monthlyCost: 0,
};

/** Hints come one at a time, on request, and after the last one a solution can be loaded. */
function Hints({ level }: { level: Scenario }) {
  const m = useMessages();
  const text = useLevelText(level);
  const replace = useDesign((state) => state.replace);
  const [shown, setShown] = useState(0);
  const all = shown >= text.hints.length;

  return (
    <section className="flex flex-col gap-2" aria-labelledby="hints-title">
      <h3 id="hints-title" className="marking">
        {m.level.hints}
      </h3>
      {shown > 0 && (
        <ol className="flex flex-col gap-2" aria-live="polite">
          {text.hints.slice(0, shown).map((hint, index) => (
            <li key={index} className="rounded-[3px] bg-shallows px-2 py-1.5">
              <span className="block font-mono text-[0.8rem] text-ink-2">{m.level.hint(index + 1, text.hints.length)}</span>
              {hint}
            </li>
          ))}
        </ol>
      )}
      {!all && (
        <button
          type="button"
          onClick={() => {
            setShown(shown + 1);
          }}
          className="self-start rounded-[3px] border border-line px-2.5 py-1 hover:border-ink"
        >
          {shown === 0 ? m.level.showHint : m.level.nextHint}
        </button>
      )}
      {all && (
        <>
          <button
            type="button"
            onClick={() => {
              replace(level.reference);
            }}
            className="self-start rounded-[3px] border border-line px-2.5 py-1 hover:border-ink"
          >
            {m.level.showSolution}
          </button>
          <p className="text-[0.85rem] text-ink-3">{m.level.solutionNote}</p>
        </>
      )}
      {/* The other way in, for someone who would rather be told: the lesson on this level. */}
      <a href={hrefOf({ page: 'guide', id: level.id })} className="self-start text-ink-2 underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink">
        {m.guide.stuck}
      </a>
    </section>
  );
}

function StartOver({ level }: { level: Scenario }) {
  const m = useMessages();
  const replace = useDesign((state) => state.replace);
  return (
    <button
      type="button"
      onClick={() => {
        replace(level.starter);
      }}
      className="mt-auto self-start rounded-[3px] border border-line px-2.5 py-1 text-ink-2 hover:border-oxide hover:text-oxide"
    >
      {m.level.startOver}
    </button>
  );
}
