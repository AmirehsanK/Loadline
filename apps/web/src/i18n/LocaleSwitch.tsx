import { useMessages } from './index.ts';
import { useLocale } from './locale.ts';

/**
 * Switches between the two languages. The button is the name of the other language, in that
 * language, so it can be found by someone who cannot read the one the page is in.
 */
export function LocaleSwitch() {
  const m = useMessages();
  const locale = useLocale((state) => state.locale);
  const setLocale = useLocale((state) => state.setLocale);
  const other = locale === 'en' ? 'fa' : 'en';
  return (
    <button
      type="button"
      lang={other}
      onClick={() => {
        setLocale(other);
      }}
      className="rounded-[3px] border border-line px-2.5 py-1 whitespace-nowrap hover:border-ink"
    >
      {m.locale.switchTo}
    </button>
  );
}
