import { describe, expect, it } from 'vitest';
import { REVIEW_MODEL, requestReview } from '../src/review/claude.ts';
import { parseMarkdown, parseSpans } from '../src/review/markdown.ts';

// The review is tested end to end against a provider that is not there: the real SDK makes the
// request, and a stand-in for the network answers it the way the API does, as a stream of events.
// No key is involved and nothing leaves the machine.

const prompt = { system: 'You are reviewing a design.', user: 'The API was full.' };

/** A streamed reply, as the Messages API sends one. */
function streamed(pieces: string[], stopReason = 'end_turn', model = REVIEW_MODEL): string {
  const events: [string, unknown][] = [
    [
      'message_start',
      {
        type: 'message_start',
        message: { id: 'msg_test', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 40, output_tokens: 1 } },
      },
    ],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ...pieces.map((text): [string, unknown] => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }]),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 30 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

interface Seen {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A network that records what it was asked and answers with what it was given. */
function provider(respond: () => Response) {
  const seen: Seen[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    return request.text().then((text) => {
      seen.push({ url: request.url, headers: request.headers, body: JSON.parse(text) as Record<string, unknown> });
      return respond();
    });
  };
  return { fetch, seen };
}

const sse = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
const failure = (status: number, type: string, message: string) =>
  new Response(JSON.stringify({ type: 'error', error: { type, message } }), { status, headers: { 'content-type': 'application/json' } });

describe('asking for a review', () => {
  it('sends the prompt to the Messages API with the visitor’s key, and streams the reply back', async () => {
    const { fetch, seen } = provider(() => sse(streamed(['The API ', 'was **full**.', '\n\n- Add an instance.'])));
    const pieces: string[] = [];
    const result = await requestReview({ apiKey: 'test-key-not-real', prompt, fetch, onText: (delta) => pieces.push(delta) });

    expect(result).toEqual({ ok: true, text: 'The API was **full**.\n\n- Add an instance.', model: REVIEW_MODEL, cutShort: false });
    expect(pieces).toEqual(['The API ', 'was **full**.', '\n\n- Add an instance.']);

    expect(seen).toHaveLength(1);
    const [request] = seen;
    // The only place a request goes.
    expect(new URL(request!.url).origin).toBe('https://api.anthropic.com');
    expect(new URL(request!.url).pathname).toBe('/v1/messages');
    expect(request!.headers.get('x-api-key')).toBe('test-key-not-real');
    expect(request!.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(request!.body).toMatchObject({
      model: 'claude-opus-5-5',
      stream: true,
      fallbacks: 'default',
      output_config: { effort: 'high' },
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    });
    // Thinking is always on for this model and takes no setting; none is sent.
    expect(request!.body).not.toHaveProperty('thinking');
    expect(request!.body).not.toHaveProperty('temperature');
  });

  it('says which model answered when a fallback did', async () => {
    const { fetch } = provider(() => sse(streamed(['Fine.'], 'end_turn', 'claude-opus-4-8')));
    expect(await requestReview({ apiKey: 'k', prompt, fetch, onText: () => undefined })).toMatchObject({ ok: true, model: 'claude-opus-4-8' });
  });

  it('reports a reply that ran into the limit on its length', async () => {
    const { fetch } = provider(() => sse(streamed(['Half a thou'], 'max_tokens')));
    expect(await requestReview({ apiKey: 'k', prompt, fetch, onText: () => undefined })).toEqual({ ok: true, text: 'Half a thou', model: REVIEW_MODEL, cutShort: true });
  });

  it('reports a refusal as a refusal, not as an empty review', async () => {
    const { fetch } = provider(() => sse(streamed([], 'refusal')));
    expect(await requestReview({ apiKey: 'k', prompt, fetch, onText: () => undefined })).toMatchObject({ ok: false, why: 'refused' });
  });

  it('puts each way of failing into its own words', async () => {
    const cases: [number, string, string][] = [
      [401, 'authentication_error', 'key'],
      [403, 'permission_error', 'permission'],
      [400, 'invalid_request_error', 'other'],
    ];
    for (const [status, type, why] of cases) {
      const { fetch } = provider(() => failure(status, type, 'no'));
      expect(await requestReview({ apiKey: 'k', prompt, fetch, onText: () => undefined }), type).toMatchObject({ ok: false, why });
    }
  });

  it('gives up on a rate limit after one more try, and on a network that is not there', { timeout: 30_000 }, async () => {
    const limited = provider(() => new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' } }));
    expect(await requestReview({ apiKey: 'k', prompt, fetch: limited.fetch, onText: () => undefined })).toMatchObject({ ok: false, why: 'rate' });
    expect(limited.seen).toHaveLength(2);

    const down: typeof globalThis.fetch = () => Promise.reject(new TypeError('fetch failed'));
    expect(await requestReview({ apiKey: 'k', prompt, fetch: down, onText: () => undefined })).toMatchObject({ ok: false, why: 'network' });
  });

  it('stops when it is told to', async () => {
    const controller = new AbortController();
    const fetch: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const pending = requestReview({ apiKey: 'k', prompt, fetch, signal: controller.signal, onText: () => undefined });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});

describe('a reply, read as Markdown', () => {
  it('becomes headings, paragraphs and lists', () => {
    const blocks = parseMarkdown('## What limited it\n\nThe API was full,\nall run long.\n\n- Add an instance\n- Put a balancer in front\n\n1. First\n2. Second');
    expect(blocks).toEqual([
      { kind: 'heading', level: 2, spans: [{ text: 'What limited it' }] },
      { kind: 'paragraph', spans: [{ text: 'The API was full, all run long.' }] },
      { kind: 'list', ordered: false, items: [[{ text: 'Add an instance' }], [{ text: 'Put a balancer in front' }]] },
      { kind: 'list', ordered: true, items: [[{ text: 'First' }], [{ text: 'Second' }]] },
    ]);
  });

  it('marks bold, italic and code, and leaves a lone marker alone', () => {
    expect(parseSpans('Set **poolSize** to `5`, *not* 2 * 3.')).toEqual([
      { text: 'Set ' },
      { text: 'poolSize', bold: true },
      { text: ' to ' },
      { text: '5', code: true },
      { text: ', ' },
      { text: 'not', italic: true },
      { text: ' 2 * 3.' },
    ]);
    // An underscore inside a name is part of the name.
    expect(parseSpans('raise max_connections and read_ratio')).toEqual([{ text: 'raise max_connections and read_ratio' }]);
  });

  it('keeps anything that looks like markup as the characters it is', () => {
    const blocks = parseMarkdown('<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1)) <script>bad()</script>');
    expect(blocks).toEqual([
      { kind: 'paragraph', spans: [{ text: '<img src=x onerror=alert(1)>' }] },
      { kind: 'paragraph', spans: [{ text: '[click](javascript:alert(1)) <script>bad()</script>' }] },
    ]);
  });

  it('carries a list item on over an indented line, and copes with a reply that is still arriving', () => {
    expect(parseMarkdown('- one\n  more of one\n- two')).toEqual([
      { kind: 'list', ordered: false, items: [[{ text: 'one' }, { text: ' more of one' }], [{ text: 'two' }]] },
    ]);
    expect(parseMarkdown('The API was **fu')).toEqual([{ kind: 'paragraph', spans: [{ text: 'The API was **fu' }] }]);
    expect(parseMarkdown('')).toEqual([]);
  });
});
