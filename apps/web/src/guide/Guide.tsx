import { LEVELS, findLevel, runScenario } from '@loadline/scenarios';
import type { Outcome, Scenario } from '@loadline/scenarios';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { LocaleSwitch } from '../i18n/LocaleSwitch.tsx';
import { useGuide, useLevelText, useMessages } from '../i18n/index.ts';
import { BackIcon, ForwardIcon, LoadMark } from '../icons.tsx';
import { ResultRow, Stars } from '../level/Result.tsx';
import { HOME, hrefOf } from '../route.ts';
import { openWithAnswer, useRoute } from '../session.ts';

/**
 * The guide, for someone who wants to learn and does not know how to solve a level: how to read
 * the screen, what the words mean, and for each level what goes wrong, the idea that fixes it and
 * the best answer step by step. It is a page to read, so unlike the workbench it fits a phone.
 */
export function Guide() {
  const m = useMessages();
  const id = useRoute((state) => (state.route.page === 'guide' ? state.route.id : null));
  // A lesson that does not exist is the list of the ones that do.
  const level = id === null ? undefined : findLevel(id);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line bg-plate px-6 py-3">
        <a href={hrefOf(HOME)} className="flex items-center gap-2.5 text-ink">
          <LoadMark size={28} />
          <span className="marking text-[2.1rem]!">{m.app.name}</span>
        </a>
        <div className="flex items-center gap-4">
          <a href={hrefOf(HOME)} className="flex items-center gap-1.5 text-ink-2 hover:text-ink">
            <BackIcon />
            {m.level.back}
          </a>
          <LocaleSwitch />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[50rem] flex-1 flex-col gap-8 px-5 py-8">
        {level ? <Lesson key={level.id} level={level} /> : <Contents />}
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="marking text-[1.35rem]!">{title}</h2>
      {children}
    </section>
  );
}

/** Terms and what they mean, as a list. */
function Terms({ entries }: { entries: { term: string; text: string }[] }) {
  return (
    <dl className="flex flex-col border-t border-line">
      {entries.map((entry) => (
        <div key={entry.term} className="grid gap-x-5 gap-y-0.5 border-b border-line py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <dt className="font-bold">{entry.term}</dt>
          <dd className="text-ink-2">{entry.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The front of the guide: how to read the playground, and the lessons. */
function Contents() {
  const m = useMessages();
  return (
    <>
      <div className="flex flex-col gap-3">
        <h1 className="headline">{m.guide.title}</h1>
        <p className="text-[1.15rem] text-ink-2">{m.guide.intro}</p>
      </div>
      <Section title={m.guide.readingTitle}>
        <Terms entries={m.guide.reading} />
      </Section>
      <Section title={m.guide.wordsTitle}>
        <Terms entries={m.guide.words} />
      </Section>
      <Section title={m.guide.lessonsTitle}>
        <ol className="flex flex-col border-t border-ink">
          {LEVELS.map((level, index) => (
            <LessonRow key={level.id} level={level} index={index + 1} />
          ))}
        </ol>
      </Section>
    </>
  );
}

function LessonRow({ level, index }: { level: Scenario; index: number }) {
  const m = useMessages();
  const text = useLevelText(level);
  return (
    <li>
      <a
        href={hrefOf({ page: 'guide', id: level.id })}
        className="group grid grid-cols-[3.2rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-line bg-plate px-4 py-2.5 hover:bg-shallows"
      >
        <span className="font-display text-[2rem] leading-none font-bold" aria-hidden="true">
          {m.home.ordinal(index)}
        </span>
        <span>
          <span className="block text-[1.1rem] font-bold">{text.title}</span>
          <span className="block text-ink-2">{text.summary}</span>
        </span>
        <span className="text-ink-3 group-hover:text-ink">
          <ForwardIcon />
        </span>
      </a>
    </li>
  );
}

/** One lesson: the level's problem, the idea, the best answer and why, and what else people try. */
function Lesson({ level }: { level: Scenario }) {
  const m = useMessages();
  const text = useLevelText(level);
  const guide = useGuide(level);
  const index = LEVELS.indexOf(level);
  const previous = LEVELS[index - 1];
  const next = LEVELS[index + 1];

  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[0.9rem] text-ink-2">
          <a href={hrefOf({ page: 'guide', id: null })} className="flex items-center gap-1.5 hover:text-ink">
            <BackIcon />
            {m.guide.all}
          </a>
          <span>{m.guide.lesson(index + 1, LEVELS.length)}</span>
        </p>
        <h1 className="headline">{text.title}</h1>
        <p className="border-s-4 border-ink bg-plate py-2.5 ps-4 pe-4 text-[1.1rem]">{text.brief}</p>
        <p className="rounded-[3px] bg-signal-wash px-3 py-2">{m.guide.spoiler}</p>
        <a
          href={hrefOf({ page: 'level', id: level.id })}
          className="flex items-center gap-1.5 self-start rounded-[3px] border border-ink px-3 py-1.5 font-bold hover:bg-ink hover:text-plate"
        >
          {m.guide.play}
          <ForwardIcon />
        </a>
      </div>

      <Section title={m.guide.problem}>
        <p>{guide.problem}</p>
      </Section>
      <Section title={m.guide.idea}>
        <p>{guide.idea}</p>
      </Section>
      <Section title={m.guide.steps}>
        <ol className="flex list-decimal flex-col gap-1.5 ps-6 marker:font-bold">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            onClick={() => {
              openWithAnswer(level);
            }}
            className="rounded-[3px] bg-ink px-3 py-1.5 font-bold text-plate hover:bg-ink-2"
          >
            {m.guide.apply}
          </button>
          <span className="text-[0.9rem] text-ink-3">{m.guide.applyNote}</span>
        </div>
      </Section>
      <Section title={m.guide.why}>
        <p>{guide.why}</p>
      </Section>
      <Section title={m.guide.scores}>
        <Score level={level} />
      </Section>
      <Section title={m.guide.others}>
        <ul className="flex list-disc flex-col gap-1.5 ps-6">
          {guide.others.map((other) => (
            <li key={other}>{other}</li>
          ))}
        </ul>
      </Section>

      <nav className="flex items-center justify-between gap-4 border-t border-line pt-4">
        {previous ? (
          <a href={hrefOf({ page: 'guide', id: previous.id })} className="flex items-center gap-1.5 hover:underline">
            <BackIcon />
            {m.guide.previous}
          </a>
        ) : (
          <span />
        )}
        {next && (
          <a href={hrefOf({ page: 'guide', id: next.id })} className="flex items-center gap-1.5 font-bold hover:underline">
            {m.guide.next}
            <ForwardIcon />
          </a>
        )}
      </nav>
    </>
  );
}

/**
 * What the level's reference design scores. It is run here, by the same function that scores a
 * level anywhere else, so the figures on the page are measured and cannot fall behind the engine.
 */
function Score({ level }: { level: Scenario }) {
  const m = useMessages();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    // A run takes a moment, so the page is drawn before it starts.
    const timer = setTimeout(() => {
      setOutcome(runScenario(level, level.reference));
    }, 60);
    return () => {
      clearTimeout(timer);
    };
  }, [level]);

  if (!outcome) {
    return (
      <p className="text-ink-2" role="status">
        {m.guide.measuring}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 border border-line bg-plate px-4 py-3">
      <Stars earned={outcome.stars} size={22} label={m.level.result.stars(outcome.stars)} />
      <ul className="flex flex-col gap-1.5">
        {outcome.results.map((result, row) => (
          <ResultRow key={row} result={result} />
        ))}
      </ul>
      {outcome.bonus.map((tier, star) => (
        <div key={star} className="border-t border-line pt-2">
          <p className="mb-1.5 text-[0.9rem] text-ink-2">{m.level.star(star + 2)}</p>
          <ul className="flex flex-col gap-1.5">
            {tier.map((result, row) => (
              <ResultRow key={row} result={result} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
