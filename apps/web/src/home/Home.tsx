import { LEVELS } from '@loadline/scenarios';
import type { Scenario } from '@loadline/scenarios';
import { useLevelText, useMessages } from '../i18n/index.ts';
import { LocaleSwitch } from '../i18n/LocaleSwitch.tsx';
import { ForwardIcon, LoadMark } from '../icons.tsx';
import { useProgress } from '../level/progress.ts';
import { Stars } from '../level/Result.tsx';
import { hrefOf } from '../route.ts';

const SOURCE = 'https://github.com/AmirehsanK/Loadline';

/** The front page: what this is, the levels and how far the visitor has got, and the sandbox. */
export function Home() {
  const m = useMessages();
  const stars = useProgress((state) => state.stars);
  const passed = LEVELS.filter((level) => (stars[level.id] ?? 0) > 0).length;

  return (
    <div className="flex min-h-dvh min-w-[62rem] flex-col">
      <header className="flex items-center justify-between gap-6 border-b border-line bg-plate px-6 py-3">
        <h1 className="flex items-center gap-2.5 text-ink">
          <LoadMark size={28} />
          <span className="marking text-[2.1rem]!">{m.app.name}</span>
        </h1>
        <div className="flex items-center gap-4">
          <a href={hrefOf({ page: 'guide', id: null })} className="font-bold underline decoration-line underline-offset-4 hover:decoration-ink">
            {m.guide.link}
          </a>
          <a href={SOURCE} className="text-ink-2 underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink">
            {m.home.source}
          </a>
          <LocaleSwitch />
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[84rem] flex-1 grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-12 px-6 py-10">
        <section className="flex flex-col gap-6">
          <p className="headline">{m.home.tagline}</p>
          <p className="max-w-[36rem] text-[1.15rem] text-ink-2">{m.home.intro}</p>
          <Hull passed={passed} total={LEVELS.length} />
          <div className="flex flex-col items-start gap-2 border-s-4 border-ink bg-plate py-3 ps-4 pe-5">
            <h2 className="marking">{m.home.sandbox}</h2>
            <p className="text-ink-2">{m.home.sandboxHint}</p>
            <a
              href={hrefOf({ page: 'sandbox' })}
              className="flex items-center gap-1.5 rounded-[3px] border border-ink px-3 py-1.5 font-bold hover:bg-ink hover:text-plate"
            >
              {m.home.openSandbox}
              <ForwardIcon />
            </a>
          </div>
          <div className="flex flex-col items-start gap-2 border-s-4 border-sea bg-plate py-3 ps-4 pe-5">
            <h2 className="marking">{m.guide.homeTitle}</h2>
            <p className="text-ink-2">{m.guide.homeHint}</p>
            <a
              href={hrefOf({ page: 'guide', id: null })}
              className="flex items-center gap-1.5 rounded-[3px] border border-ink px-3 py-1.5 font-bold hover:bg-ink hover:text-plate"
            >
              {m.guide.open}
              <ForwardIcon />
            </a>
          </div>
        </section>

        <section aria-labelledby="levels-title">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 id="levels-title" className="marking text-[1.5rem]!">
              {m.home.levels}
            </h2>
            <p className="font-mono text-ink-2">{m.home.passed(passed, LEVELS.length)}</p>
          </div>
          <ol className="flex flex-col border-t border-ink">
            {LEVELS.map((level, index) => (
              <LevelRow key={level.id} level={level} index={index + 1} stars={stars[level.id] ?? 0} />
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}

function LevelRow({ level, index, stars }: { level: Scenario; index: number; stars: number }) {
  const m = useMessages();
  const text = useLevelText(level);
  const done = stars > 0;
  return (
    <li>
      <a
        href={hrefOf({ page: 'level', id: level.id })}
        className={`group grid grid-cols-[4.2rem_minmax(0,1fr)_auto_auto] items-center gap-4 border-b border-s-4 border-b-line bg-plate py-3 ps-4 pe-4 hover:bg-shallows ${
          done ? 'border-s-sea' : 'border-s-line'
        }`}
      >
        <span className={`font-display text-[2.6rem] leading-none font-bold ${done ? 'text-sea' : 'text-ink'}`} aria-hidden="true">
          {m.home.ordinal(index)}
        </span>
        <span>
          <span className="block text-[1.2rem] font-bold">{text.title}</span>
          <span className="block text-ink-2">{text.summary}</span>
        </span>
        <Stars earned={stars} label={m.home.stars(stars)} />
        <span className="flex items-center gap-1.5 text-ink-3 group-hover:text-ink">
          <span className="sr-only">{done ? m.home.again : m.home.play}</span>
          <ForwardIcon />
        </span>
      </a>
    </li>
  );
}

const WIDTH = 460;
const HEIGHT = 190;
/** Where the load line is painted, and where the water lies with nothing aboard. */
const LADEN_Y = 62;
const LIGHT_Y = 168;

/**
 * The side of a hull with its load line. Every level passed is more load carried, so the water
 * comes up the marks; with all of them passed it sits exactly on the line and no higher.
 */
function Hull({ passed, total }: { passed: number; total: number }) {
  const waterY = LIGHT_Y - ((LIGHT_Y - LADEN_Y) * passed) / total;
  const markY = (step: number) => LIGHT_Y - ((LIGHT_Y - LADEN_Y) * step) / total;
  // One wavelength longer than the picture, so it can drift by a wavelength and repeat.
  const wave = `M-60 0 ${'q15 -5 30 0 t30 0 '.repeat(Math.ceil(WIDTH / 60) + 1)}V${HEIGHT} H-60 Z`;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full max-w-[36rem] border border-ink bg-plate" aria-hidden="true" focusable="false">
      {/* Below the line the hull is painted red. */}
      <rect y={LADEN_Y} width={WIDTH} height={HEIGHT - LADEN_Y} fill="var(--color-oxide)" opacity="0.14" />
      <path d={`M0 ${LADEN_Y}H${WIDTH}`} stroke="var(--color-oxide)" strokeWidth="1" strokeDasharray="2 5" />

      {/* Draught marks: one for each level. */}
      <g stroke="var(--color-ink)" fill="var(--color-ink)">
        <path d={`M34 ${LADEN_Y - 8}V${LIGHT_Y + 8}`} strokeWidth="2" />
        {Array.from({ length: total + 1 }, (_, step) => (
          <path key={step} d={`M34 ${markY(step)}h${step % 5 === 0 ? 20 : 11}`} strokeWidth="2" />
        ))}
        {[0, total / 2, total].map((step) => (
          <text key={step} x="60" y={markY(step) + 6} stroke="none" className="font-display text-[17px] font-bold">
            {step}
          </text>
        ))}
      </g>

      {/* The load line: a ring with a bar through its centre. */}
      <g stroke="var(--color-ink)" strokeWidth="7" fill="none">
        <circle cx={WIDTH / 2} cy={LADEN_Y} r="34" />
        <path d={`M${WIDTH / 2 - 62} ${LADEN_Y}h124`} />
      </g>

      <g transform={`translate(0 ${waterY})`}>
        <path d={wave} className="hull-water" fill="var(--color-sea)" opacity="0.5" />
      </g>
    </svg>
  );
}
