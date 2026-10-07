import { ShareError } from '@loadline/share';
import type { ShareInput } from '@loadline/share';
import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { currentDesign, readDocument, useDesign } from '../design/store.ts';
import { useMessages } from '../i18n/index.ts';
import { exportName, exportText, shareLinks, shareOf } from './links.ts';
import type { Shared } from './links.ts';

/** Files larger than this are not read; no design comes near it. */
const MAX_IMPORT_BYTES = 1024 * 1024;

type Links = { status: 'making' } | { status: 'made'; links: Shared } | { status: 'failed'; tooLarge: boolean };

/** What the design on the canvas is shared as, or null while an edit has left it out of bounds. */
function currentShare(): ShareInput | null {
  const state = useDesign.getState();
  const design = currentDesign(state);
  if (!design) return null;
  const { seed, workload } = state;
  return shareOf({ design, ...(seed === null ? {} : { seed }), ...(workload === null ? {} : { workload }) }, state.level?.id ?? null);
}

/** The button in the top bar, and the dialog it opens. */
export function ShareButton() {
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
        {m.share.button}
      </button>
      {open && (
        <ShareDialog
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/** A value to copy: shown in full, selectable, with a button that copies it. */
function Copyable({ label, hint, value, rows }: { label: string; hint: string; value: string; rows: number }) {
  const m = useMessages();
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    // Selecting it as well means a browser that refuses the clipboard still leaves it one keypress away.
    field.current?.select();
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
      },
      () => undefined,
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end justify-between gap-3">
        <label htmlFor={id} className="font-bold">
          {label}
        </label>
        <button type="button" onClick={copy} disabled={value === ''} className="btn border-2 border-line bg-plate px-2.5 py-0.5 hover:border-ink disabled:text-ink-3">
          <span aria-live="polite">{copied ? m.share.copied : m.share.copy}</span>
        </button>
      </div>
      <textarea
        id={id}
        ref={field}
        readOnly
        rows={rows}
        value={value}
        aria-describedby={`${id}-hint`}
        onFocus={(event) => {
          event.target.select();
        }}
        className="field-input resize-none text-[0.85rem] break-all"
      />
      <p id={`${id}-hint`} className="text-[0.85rem] text-ink-3">
        {hint}
      </p>
    </div>
  );
}

function ShareDialog({ onClose }: { onClose: () => void }) {
  const m = useMessages();
  const dialog = useRef<HTMLDialogElement>(null);
  const [links, setLinks] = useState<Links>({ status: 'making' });
  const [imported, setImported] = useState<'done' | 'refused' | 'broken' | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  // The link is for the design as it was when the dialog opened, or as it is after an import.
  useEffect(() => {
    let current = true;
    const share = currentShare();
    if (!share) return;
    shareLinks(share, window.location, m.share.embedTitle).then(
      (made) => {
        if (current) setLinks({ status: 'made', links: made });
      },
      (error: unknown) => {
        if (current) setLinks({ status: 'failed', tooLarge: error instanceof ShareError && error.code === 'too-large' });
      },
    );
    return () => {
      current = false;
    };
  }, [imported, m]);

  const download = () => {
    const share = currentShare();
    if (!share) return;
    const url = URL.createObjectURL(new Blob([exportText(share)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exportName(share.level ?? share.design.name ?? '');
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // The same file can be picked again after it has been refused and fixed.
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setImported('refused');
      return;
    }
    file.text().then(
      (text) => {
        // A file is input like any other: it is checked before anything is done with it.
        const read = readDocument(text);
        if (!read) setImported('refused');
        else setImported(useDesign.getState().adopt(read) ? 'done' : 'broken');
      },
      () => {
        setImported('refused');
      },
    );
  };

  const made = links.status === 'made' ? links.links : null;

  return (
    <dialog
      ref={dialog}
      aria-labelledby="share-title"
      onClose={onClose}
      className="m-auto w-[36rem] max-w-[calc(100vw-2rem)] border-2 border-ink bg-plate p-0 text-ink shadow-[6px_6px_0_var(--color-ink)] backdrop:bg-ink/40"
    >
      <div className="flex max-h-[calc(100dvh-4rem)] flex-col">
        <header className="border-b-2 border-line px-5 py-3">
          <h2 id="share-title" className="marking text-[1.5rem]!">
            {m.share.title}
          </h2>
        </header>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
          {links.status === 'failed' ? (
            <p className="bg-oxide-wash px-2 py-1.5" role="alert">
              {links.tooLarge ? m.share.tooLarge : m.share.failed}
            </p>
          ) : (
            <>
              <Copyable label={m.share.link} hint={m.share.linkHint} value={made?.link ?? ''} rows={3} />
              <Copyable label={m.share.embed} hint={m.share.embedHint} value={made?.embed ?? ''} rows={4} />
              {links.status === 'making' && <p className="text-ink-2">{m.share.making}</p>}
            </>
          )}

          <section className="flex flex-col gap-2 border-t-2 border-line pt-3">
            <h3 className="font-bold">{m.share.file}</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={download} className="btn border-2 border-line bg-plate px-3 py-1.5 hover:border-ink">
                {m.share.export}
              </button>
              <label className="cursor-pointer btn border-2 border-line bg-plate px-3 py-1.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink hover:border-ink">
                {m.share.import}
                <input type="file" accept="application/json,.json" onChange={pick} className="sr-only" />
              </label>
            </div>
            <p className="text-[0.85rem] text-ink-3">{m.share.importHint}</p>
            <p role="status" className={imported === 'done' ? 'text-ink-2' : 'font-bold text-oxide'}>
              {imported === 'done' && m.share.imported}
              {imported === 'refused' && m.share.importRefused}
              {imported === 'broken' && m.share.importBroken}
            </p>
          </section>
        </div>

        <footer className="flex justify-end border-t-2 border-line px-5 py-3">
          <button
            type="button"
            onClick={() => {
              dialog.current?.close();
            }}
            className="btn border-2 border-ink bg-pop px-3 py-1.5 font-bold text-ink"
          >
            {m.share.close}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
