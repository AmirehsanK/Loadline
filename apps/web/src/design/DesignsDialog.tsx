import { useEffect, useId, useRef, useState } from 'react';
import { useMessages } from '../i18n/index.ts';
import { useLocale } from '../i18n/locale.ts';
import { LIBRARY_LIMIT, readLibrary, removeDesign, saveDesign, tidyName } from './library.ts';
import type { SavedDesign } from './library.ts';
import { currentDocument, useDesign } from './store.ts';

/** The button in the sandbox's top bar, and the dialog it opens. */
export function DesignsButton() {
  const m = useMessages();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="btn border-2 border-line bg-plate px-3 py-1.5 hover:border-ink"
      >
        {m.designs.button}
      </button>
      {open && (
        <DesignsDialog
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/** The designs put aside under a name: keep the one on the canvas, open one, or let one go. */
function DesignsDialog({ onClose }: { onClose: () => void }) {
  const m = useMessages();
  const locale = useLocale((state) => state.locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const nameId = useId();
  const [list, setList] = useState<SavedDesign[]>(readLibrary);
  const [name, setName] = useState('');
  const [said, setSaid] = useState<'saved' | 'full' | null>(null);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const save = () => {
    const document = currentDocument();
    if (!document || tidyName(name) === '') return;
    const next = saveDesign(name, document, Date.now());
    setSaid(next ? 'saved' : 'full');
    if (next) {
      setList(next);
      setName('');
    }
  };

  const open = (saved: SavedDesign) => {
    // It replaces the design on the canvas as one step, which undo takes back.
    useDesign.getState().adopt(saved.document);
    dialog.current?.close();
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="designs-title"
      onClose={onClose}
      className="m-auto w-[34rem] max-w-[calc(100vw-2rem)] border-2 border-ink bg-plate p-0 text-ink shadow-[6px_6px_0_var(--color-ink)] backdrop:bg-ink/40"
    >
      <div className="flex max-h-[calc(100dvh-4rem)] flex-col">
        <header className="border-b-2 border-line px-5 py-3">
          <h2 id="designs-title" className="marking text-[1.5rem]!">
            {m.designs.title}
          </h2>
        </header>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
          <p className="text-ink-2">{m.designs.intro}</p>

          <form
            className="flex flex-col gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label htmlFor={nameId} className="font-bold">
              {m.designs.name}
            </label>
            <div className="flex gap-2">
              <input
                id={nameId}
                type="text"
                value={name}
                maxLength={80}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaid(null);
                }}
                className="field-input min-w-0 flex-1 font-sans!"
              />
              <button
                type="submit"
                disabled={tidyName(name) === ''}
                className="btn border-2 border-ink bg-pop px-3 py-1.5 font-bold whitespace-nowrap text-ink disabled:cursor-not-allowed disabled:bg-deck disabled:text-ink-3"
              >
                {m.designs.save}
              </button>
            </div>
            <p className="text-[0.85rem] text-ink-3">{m.designs.nameHint}</p>
            <p role="status" className={said === 'full' ? 'font-bold text-oxide' : 'text-ink-2'}>
              {said === 'saved' && m.designs.saved}
              {said === 'full' && m.designs.full(LIBRARY_LIMIT)}
            </p>
          </form>

          <section className="flex flex-col gap-2 border-t-2 border-line pt-3">
            {list.length === 0 ? (
              <p className="text-ink-2">{m.designs.empty}</p>
            ) : (
              <>
              <p className="text-[0.85rem] text-ink-3">{m.designs.openHint}</p>
              <ul className="flex flex-col gap-1.5">
                {list.map((saved) => (
                  <li key={saved.id} className="flex items-center gap-3 border-2 border-line bg-deck px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div dir="auto" className="truncate font-bold">
                        {saved.name}
                      </div>
                      <div className="text-[0.85rem] text-ink-2">
                        {m.designs.about(saved.document.design.nodes.length, when.format(saved.savedAt))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        open(saved);
                      }}
                      className="btn border-2 border-ink bg-plate px-2.5 py-1 font-bold hover:bg-pop"
                    >
                      {m.designs.open}
                    </button>
                    <button
                      type="button"
                      aria-label={m.designs.removeNamed(saved.name)}
                      onClick={() => {
                        setList(removeDesign(saved.id));
                        setSaid(null);
                      }}
                      className="btn border-2 border-line bg-plate px-2.5 py-1 hover:border-oxide hover:text-oxide"
                    >
                      {m.designs.remove}
                    </button>
                  </li>
                ))}
              </ul>
              </>
            )}
          </section>
        </div>

        <footer className="flex justify-end border-t-2 border-line px-5 py-3">
          <button
            type="button"
            onClick={() => {
              dialog.current?.close();
            }}
            className="btn border-2 border-line bg-plate px-3 py-1.5 hover:border-ink"
          >
            {m.designs.close}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
