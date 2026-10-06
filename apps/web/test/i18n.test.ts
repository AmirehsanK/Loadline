import { LEVELS } from '@loadline/scenarios';
import { normalize, toAsciiDigits } from 'persian-text-guard';
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en.ts';
import { fa } from '../src/i18n/fa.ts';
import { guideEn } from '../src/i18n/guide.en.ts';
import { guideFa } from '../src/i18n/guide.fa.ts';
import { levelsFa } from '../src/i18n/levels.fa.ts';
import { DIRECTION, LOCALES, pickLocale } from '../src/i18n/locale.ts';

/**
 * Every piece of text in a catalog: the plain strings, and what each message that takes values
 * says when it is given some. `path` says where it came from.
 */
function texts(catalog: unknown, path = ''): { path: string; text: string }[] {
  if (typeof catalog === 'string') return [{ path, text: catalog }];
  if (typeof catalog === 'function') {
    const message = catalog as (...values: unknown[]) => unknown;
    // Values that will do for a name, a count or a readout alike.
    let said: unknown;
    try {
      said = message('7', '3', '2');
    } catch {
      // The one message that takes a list.
      said = message(['7', '3']);
    }
    return [{ path: `${path}()`, text: String(said) }];
  }
  if (typeof catalog !== 'object' || catalog === null) throw new Error(`${path} is not text`);
  return Object.entries(catalog).flatMap(([key, value]) => texts(value, path === '' ? key : `${path}.${key}`));
}

/** The paths of a catalog, to compare two of them. */
const shape = (catalog: unknown) => texts(catalog).map((entry) => entry.path);

const levelTexts = Object.entries(levelsFa).flatMap(([id, text]) => texts(text, `levels.${id}`));
const persian = [...texts(fa), ...levelTexts, ...texts(guideFa, 'guide')];
const hasPersian = (text: string) => /[؀-ۿ]/.test(text);
/** The numbers a text gives in digits, whichever digits they are written in. */
const figures = (text: string) => new Set(toAsciiDigits(text).replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?/g) ?? []);

// The package's `standard` preset, taken apart. As a whole it also folds look-alike letters onto
// one form, which is right for comparing text and wrong for showing it: it turns «آ» into «ا».
// So its other steps are applied as they are, and the folding is checked letter by letter, letting
// through the two it would change that correct Persian is written with.
const TIDY = ['compatibilityForms', 'removeTatweel', 'removeBidiControls', 'collapseWhitespace'] as const;
const KEPT = new Set(['آ', 'أ']);

describe('the Persian catalog', () => {
  it('has a message for everything the English one has, and nothing else', () => {
    expect(shape(fa)).toEqual(shape(en));
  });

  it('is actually in Persian, apart from the few things that stay as they are', () => {
    // Readouts and names that are the same in every language.
    const same = new Set(texts(en).filter((entry, index) => entry.text === texts(fa)[index]!.text).map((entry) => entry.path));
    expect([...same].sort()).toEqual(
      [
        'app.name',
        'level.value.p99()',
        'metrics.dollars()',
        'metrics.series.p50',
        'metrics.series.p99',
        'node.instances()',
        'node.perSecond()',
        'node.tail()',
        'parts.types.cache.name',
        'parts.types.client.name',
        'parts.types.database.name',
        'parts.types.load-balancer.name',
        'parts.types.queue.name',
        'parts.types.rate-limiter.name',
        'parts.types.service.name',
        'parts.types.worker.name',
        'run.speedOption()',
        'run.trafficValue()',
        'units.ms',
        'units.times',
      ].sort(),
    );
  });

  it('is written the standard way: Persian letters, single spaces, nothing invisible but the joiner', () => {
    // The same check a Persian site would run on text before storing it. It catches the Arabic
    // forms of ye and kaf that some keyboards type, doubled spaces, and stray direction marks.
    for (const { path, text } of persian) {
      expect(normalize(text, TIDY), path).toBe(text);
      for (const letter of text) {
        if (!KEPT.has(letter)) expect(normalize(letter, ['unifyLetters']), `${path}: ${letter}`).toBe(letter);
      }
    }
  });

  it('uses Persian punctuation in Persian sentences', () => {
    for (const { path, text } of persian) {
      if (!hasPersian(text)) continue;
      expect(text, path).not.toMatch(/[?;]/);
      // A Latin comma is fine inside a readout such as "1,284"; between words it should be «،».
      expect(text, path).not.toMatch(/[؀-ۿ]\s*,|,\s*[؀-ۿ]/);
    }
  });

  it('writes the numbers of a sentence in Persian digits, and leaves readouts alone', () => {
    expect(fa.level.number(3, 10)).toBe('مرحلهٔ ۳ از ۱۰');
    expect(fa.home.passed(2, 10)).toBe('۲ از ۱۰ مرحله گذرانده شده');
    expect(fa.home.ordinal(7)).toBe('۰۷');
    expect(fa.home.stars(0)).toBe('هنوز گذرانده نشده');
    expect(fa.home.stars(2)).toBe('۲ ستاره از ۳');
    expect(fa.level.hint(1, 3)).toBe('راهنمایی ۱ از ۳');
    expect(fa.level.timeline.killSome('API', 1)).toBe('یک نمونه از API از کار می‌افتد');
    expect(fa.level.timeline.killSome('API', 2)).toBe('۲ نمونه از API از کار می‌افتند');
    expect(fa.level.timeline.slow('Payments', '100')).toBe('Payments ۱۰۰ برابر کندتر می‌شود');
    // What is read off the system keeps the digits it has on the canvas and the charts.
    expect(fa.level.objective.p99('500 ms')).toBe('۹۹٪ درخواست‌ها در 500 ms پاسخ بگیرند');
    expect(fa.level.value.errors('0.26%')).toBe('0.26% ناموفق');
    expect(fa.metrics.dollars('1,284')).toBe('$1,284');
    expect(fa.node.instances(3)).toBe('×3');
  });
});

describe('the levels in Persian', () => {
  it('are all there, each with the same hints and rules as the English', () => {
    expect(Object.keys(levelsFa).sort()).toEqual(LEVELS.map((level) => level.id).sort());
    for (const level of LEVELS) {
      const text = levelsFa[level.id]!;
      expect(text.hints, level.id).toHaveLength(level.text.hints.length);
      expect(Object.keys(text.rules ?? {}), level.id).toEqual(Object.keys(level.text.rules ?? {}));
      for (const part of [text.title, text.summary, text.brief, text.debrief, ...text.hints]) {
        expect(hasPersian(part), level.id).toBe(true);
      }
    }
  });

  it('give no number that the English does not', () => {
    // The English text is tuned against the simulation. A figure written in digits here has to
    // be one that is written in digits there, or one of them is wrong.
    for (const level of LEVELS) {
      const persianText = levelsFa[level.id]!;
      const pairs: [string, string, string][] = [
        ['brief', persianText.brief, level.text.brief],
        ['debrief', persianText.debrief, level.text.debrief],
        ...persianText.hints.map((hint, index): [string, string, string] => [`hint ${index + 1}`, hint, level.text.hints[index]!]),
      ];
      for (const [where, translated, original] of pairs) {
        const known = figures(original);
        for (const figure of figures(translated)) expect(known.has(figure), `${level.id} ${where}: ${figure}`).toBe(true);
      }
    }
  });
});

describe('choosing a language', () => {
  it('keeps the one chosen before', () => {
    expect(pickLocale('fa', ['en-US'])).toBe('fa');
    expect(pickLocale('en', ['fa-IR'])).toBe('en');
  });

  it('starts in Persian for a browser that asks for Persian first, and in English otherwise', () => {
    expect(pickLocale(null, ['fa-IR', 'en'])).toBe('fa');
    expect(pickLocale(null, ['fa'])).toBe('fa');
    expect(pickLocale(null, ['en-US', 'fa'])).toBe('en');
    expect(pickLocale(null, ['de'])).toBe('en');
    expect(pickLocale(null, [])).toBe('en');
    expect(pickLocale('klingon', ['fa'])).toBe('fa');
  });

  it('knows which way each language runs', () => {
    expect(LOCALES.map((locale) => DIRECTION[locale])).toEqual(['ltr', 'rtl']);
  });
});

describe('the guide', () => {
  it('has a lesson on every level in both languages, with as many steps and as many other attempts', () => {
    const ids = LEVELS.map((level) => level.id).sort();
    expect(Object.keys(guideEn).sort()).toEqual(ids);
    expect(Object.keys(guideFa).sort()).toEqual(ids);
    for (const id of ids) {
      expect(guideEn[id]!.steps.length, id).toBeGreaterThan(1);
      expect(guideFa[id]!.steps, id).toHaveLength(guideEn[id]!.steps.length);
      expect(guideFa[id]!.others, id).toHaveLength(guideEn[id]!.others.length);
      for (const { path, text } of texts(guideFa[id], id)) expect(hasPersian(text), path).toBe(true);
    }
  });

  it('names every setting as the inspector does', () => {
    // A step puts the name of a setting in quotes. If a label is reworded and the step is not,
    // the reader is sent looking for something that is no longer on the screen.
    const labels = (catalog: unknown) => new Set(texts(catalog).map((entry) => entry.text));
    const quoted = (guide: typeof guideEn, pattern: RegExp) =>
      Object.entries(guide).flatMap(([id, lesson]) => lesson.steps.flatMap((step) => [...step.matchAll(pattern)].map((match) => [id, match[1]!] as const)));

    const english = quoted(guideEn, /"([^"]+)"/g);
    const persianNames = quoted(guideFa, /«([^»]+)»/g);
    expect(english.length).toBeGreaterThan(20);
    expect(persianNames).toHaveLength(english.length);
    for (const [id, name] of english) expect(labels(en.fields).has(name), `${id}: ${name}`).toBe(true);
    for (const [id, name] of persianNames) expect(labels(fa.fields).has(name), `${id}: ${name}`).toBe(true);
  });

  it('gives no number in Persian that the English does not', () => {
    // As for the levels: the English is written against the simulation and the table of attempts.
    const english = new Map(texts(guideEn).map((entry) => [entry.path, entry.text]));
    for (const { path, text } of texts(guideFa)) {
      const allowed = figures(english.get(path) ?? '');
      for (const figure of figures(text)) expect(allowed.has(figure), `${path}: ${figure}`).toBe(true);
    }
  });
});
