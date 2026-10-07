import { findBottleneck, summarize } from '@loadline/engine';
import { buildReviewPrompt } from '@loadline/scenarios';
import type { ReviewPrompt } from '@loadline/scenarios';
import { useEffect, useId, useRef, useState } from 'react';
import { currentDesign, useDesign } from '../design/store.ts';
import { useMessages } from '../i18n/index.ts';
import { useLocale } from '../i18n/locale.ts';
import { requestReport } from '../sim/controller.ts';
import { useSim } from '../sim/store.ts';
import { requestReview } from './claude.ts';
import type { ReviewFailure } from './claude.ts';
import { keepKey, readKey } from './key.ts';
import { parseMarkdown } from './markdown.ts';
import type { Block, Span } from './markdown.ts';

/** The button in the top bar, and the dialog it opens. */
export function ReviewButton() {
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
        {m.review.button}
      </button>
      {open && (
        <ReviewDialog
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((span, index) =>
        span.code ? (
          <code key={index} className="rounded-[2px] bg-deck px-1 font-mono text-[0.9em]">
            {span.text}
          </code>
        ) : span.bold ? (
          <strong key={index}>{span.text}</strong>
        ) : span.italic ? (
          <em key={index}>{span.text}</em>
        ) : (
          <span key={index}>{span.text}</span>
        ),
      )}
    </>
  );
}

/** A reply, drawn from the tree it was read into. No part of it reaches the page as markup. */
function Reply({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <h4 key={index} className="mt-1 font-bold">
              <Spans spans={block.spans} />
            </h4>
          );
        }
        if (block.kind === 'paragraph') {
          return (
            <p key={index}>
              <Spans spans={block.spans} />
            </p>
          );
        }
        const List = block.ordered ? 'ol' : 'ul';
        return (
          <List key={index} className={`flex flex-col gap-1 ps-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
            {block.items.map((item, row) => (
              <li key={row}>
                <Spans spans={item} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

type Asked =
  | { status: 'idle' }
  | { status: 'asking'; text: string }
  | { status: 'answered'; text: string; model: string; cutShort: boolean }
  | { status: 'failed'; why: ReviewFailure; message: string };

function ReviewDialog({ onClose }: { onClose: () => void }) {
  const m = useMessages();
  const locale = useLocale((state) => state.locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const keyId = useId();
  const rememberId = useId();
  const ran = useSim((state) => state.now > 0);
  // The prompt is built from the run as it stands when the dialog opens.
  const [prompt, setPrompt] = useState<ReviewPrompt | null>(null);
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState(readKey);
  const [remember, setRemember] = useState(() => readKey() !== '');
  const [asked, setAsked] = useState<Asked>({ status: 'idle' });
  const stop = useRef<AbortController | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      // Closing the dialog ends a request that is still on its way.
      stop.current?.abort();
    };
  }, []);

  useEffect(() => {
    let current = true;
    if (!ran) return;
    void requestReport().then((answer) => {
      const state = useDesign.getState();
      const design = currentDesign(state);
      if (!current || !answer || !design) return;
      const recent = summarize(answer.report.samples.slice(-5));
      setPrompt(
        buildReviewPrompt({
          design,
          report: answer.report,
          bottleneck: recent ? findBottleneck(design, recent) : null,
          ...(state.level && answer.outcome ? { level: { scenario: state.level, outcome: answer.outcome } } : {}),
          ...(state.workload ? { workload: state.workload } : {}),
          language: locale,
        }),
      );
    });
    return () => {
      current = false;
    };
  }, [ran, locale]);

  const copy = () => {
    if (!prompt) return;
    navigator.clipboard.writeText(`${prompt.system}\n\n${prompt.user}`).then(
      () => {
        setCopied(true);
      },
      () => undefined,
    );
  };

  const ask = () => {
    if (!prompt || apiKey.trim() === '') return;
    keepKey(remember ? apiKey.trim() : '');
    const controller = new AbortController();
    stop.current = controller;
    setAsked({ status: 'asking', text: '' });
    requestReview({
      apiKey: apiKey.trim(),
      prompt,
      signal: controller.signal,
      onText: (delta) => {
        setAsked((before) => (before.status === 'asking' ? { status: 'asking', text: before.text + delta } : before));
      },
    }).then(
      (result) => {
        setAsked(result.ok ? { status: 'answered', text: result.text, model: result.model, cutShort: result.cutShort } : { status: 'failed', ...result });
      },
      () => {
        // Stopped by the visitor: what had arrived stays on show.
        setAsked((before) => (before.status === 'asking' && before.text !== '' ? { status: 'answered', text: before.text, model: '', cutShort: true } : { status: 'idle' }));
      },
    );
  };

  const asking = asked.status === 'asking';
  const reply = asked.status === 'asking' || asked.status === 'answered' ? asked.text : '';
  const quiet = 'btn border-2 border-line bg-plate px-3 py-1.5 hover:border-ink disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:border-line';

  return (
    <dialog
      ref={dialog}
      aria-labelledby="review-title"
      onClose={onClose}
      className="m-auto w-[44rem] max-w-[calc(100vw-2rem)] border-2 border-ink bg-plate p-0 text-ink shadow-[6px_6px_0_var(--color-ink)] backdrop:bg-ink/40"
    >
      <div className="flex max-h-[calc(100dvh-4rem)] flex-col">
        <header className="border-b-2 border-line px-5 py-3">
          <h2 id="review-title" className="marking text-[1.5rem]!">
            {m.review.title}
          </h2>
        </header>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
          <p className="text-ink-2">{m.review.intro}</p>
          {!ran && (
            <p className="bg-signal-wash px-2 py-1.5" role="status">
              {m.review.needRun}
            </p>
          )}

          <section className="flex flex-col items-start gap-2">
            <h3 className="font-bold">{m.review.copyTitle}</h3>
            <p className="text-ink-2">{m.review.copyHint}</p>
            <button type="button" onClick={copy} disabled={!prompt} className={quiet}>
              <span aria-live="polite">{copied ? m.review.copied : m.review.copy}</span>
            </button>
          </section>

          <section className="flex flex-col gap-2 border-t-2 border-line pt-3">
            <h3 className="font-bold">{m.review.keyTitle}</h3>
            <p className="text-ink-2">{m.review.keyHint}</p>
            <label htmlFor={keyId} className="field-label">
              {m.review.keyLabel}
            </label>
            <input
              id={keyId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              className="field-input"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
              }}
            />
            <label htmlFor={rememberId} className="flex cursor-pointer items-center gap-2">
              <input
                id={rememberId}
                type="checkbox"
                className="size-4 accent-ink"
                checked={remember}
                onChange={(event) => {
                  setRemember(event.target.checked);
                  // Unticking forgets a key that was kept before, at once.
                  if (!event.target.checked) keepKey('');
                }}
              />
              {m.review.remember}
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={ask}
                disabled={!prompt || apiKey.trim() === '' || asking}
                className="btn border-2 border-ink bg-pop px-3 py-1.5 font-bold text-ink disabled:cursor-not-allowed disabled:bg-deck disabled:text-ink-3"
              >
                {m.review.ask}
              </button>
              {asking && (
                <button
                  type="button"
                  onClick={() => {
                    stop.current?.abort();
                  }}
                  className={quiet}
                >
                  {m.review.stop}
                </button>
              )}
            </div>

            <div aria-live="polite" className="flex flex-col gap-2">
              {asking && reply === '' && <p className="text-ink-2">{m.review.asking}</p>}
              {reply !== '' && (
                <div className="border-2 border-line bg-deck px-3 py-2">
                  <Reply blocks={parseMarkdown(reply)} />
                </div>
              )}
              {asked.status === 'answered' && asked.model !== '' && <p className="text-[0.85rem] text-ink-3">{m.review.answeredBy(asked.model)}</p>}
              {asked.status === 'answered' && asked.cutShort && <p className="text-[0.85rem] text-ink-3">{m.review.cutShort}</p>}
              {asked.status === 'failed' && (
                <p className="bg-oxide-wash px-2 py-1.5" role="alert">
                  {asked.why === 'other' ? m.review.failed.other(asked.message) : m.review.failed[asked.why]}
                </p>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-2 border-t-2 border-line pt-3">
            <h3 className="font-bold">{m.review.agentTitle}</h3>
            <p className="text-ink-2">{m.review.agentHint}</p>
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
            {m.review.close}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
