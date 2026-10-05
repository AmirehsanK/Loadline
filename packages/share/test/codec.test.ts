import { designSchema } from '@loadline/engine';
import { LEVELS } from '@loadline/scenarios';
import { describe, expect, it } from 'vitest';
import { MAX_DECODED_BYTES, MAX_ENCODED_CHARS, SHARE_PREFIX, ShareError, decodeShare, encodeShare } from '../src/index.ts';

const theBill = LEVELS.find((level) => level.id === 'the-bill')!;

/** Makes the text of a link out of any bytes, as someone forging one would. */
async function forge(content: string | Uint8Array): Promise<string> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const packed = new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  return SHARE_PREFIX + Buffer.from(packed).toString('base64url');
}

/** The code of the error a link is refused with. */
async function refusal(text: string): Promise<string> {
  try {
    await decodeShare(text);
  } catch (error) {
    if (error instanceof ShareError) return error.code;
    throw error;
  }
  return 'accepted';
}

describe('a share link', () => {
  it('comes back as the design that went in, for every level', async () => {
    for (const level of LEVELS) {
      for (const design of [level.starter, level.reference]) {
        const share = { design, seed: level.seed, level: level.id };
        const text = await encodeShare(share);
        expect(text.startsWith(SHARE_PREFIX), level.id).toBe(true);
        expect(text.slice(SHARE_PREFIX.length), level.id).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(await decodeShare(text), level.id).toEqual(share);
      }
    }
  });

  it('carries traffic and faults when it is given them', async () => {
    const share = { design: theBill.reference, seed: 7, workload: theBill.workload };
    expect(await decodeShare(await encodeShare(share))).toEqual(share);
  });

  it('is the same text every time for the same design', async () => {
    const share = { design: theBill.reference, seed: 1 };
    expect(await encodeShare(share)).toBe(await encodeShare(structuredClone(share)));
  });

  it('is short: settings left at their defaults are not sent', async () => {
    // Seven parts, six connections and a few dozen settings between them.
    const text = await encodeShare({ design: theBill.starter });
    expect(text.length).toBeLessThan(700);
    expect(text.length).toBeLessThan(JSON.stringify(theBill.starter).length / 4);
    // And no level's answer needs more than that.
    for (const level of LEVELS) expect((await encodeShare({ design: level.reference })).length, level.id).toBeLessThan(700);
  });

  it('keeps a setting that happens to equal nothing in particular', async () => {
    // Values that are falsy, or equal to another field's default, must not be mistaken for defaults.
    const design = designSchema.parse({
      name: 'Edge cases',
      nodes: [
        { id: 'users', type: 'client', name: '', x: 0, y: 0, params: { rps: 0, readRatio: 0, skew: 0 } },
        { id: 'cache', type: 'cache', params: { ttlMs: 0, ttlJitter: 1, singleFlight: true } },
        { id: 'api', type: 'service', params: { queue: 0, autoscale: { enabled: true, min: 2 } } },
      ],
      edges: [{ id: 'users--api', from: 'users', to: 'api', params: { timeoutMs: 0, retries: 0, breaker: { enabled: true } } }],
    });
    expect((await decodeShare(await encodeShare({ design, seed: 0 }))).design).toEqual(design);
    expect((await decodeShare(await encodeShare({ design, seed: 0 }))).seed).toBe(0);
  });

  it('opens a design the editor would show with problems', async () => {
    // A service that calls itself in a circle cannot run, and can be looked at.
    const design = designSchema.parse({
      nodes: [
        { id: 'a', type: 'service' },
        { id: 'b', type: 'service' },
      ],
      edges: [
        { id: 'a--b', from: 'a', to: 'b' },
        { id: 'b--a', from: 'b', to: 'a' },
      ],
    });
    expect((await decodeShare(await encodeShare({ design }))).design).toEqual(design);
  });
});

describe('a link that should not be opened', () => {
  it('is refused when it is not one of ours', async () => {
    expect(await refusal('')).toBe('format');
    expect(await refusal('hello')).toBe('format');
    expect(await refusal('v2.AAAA')).toBe('format');
    expect(await refusal(`${SHARE_PREFIX.toUpperCase()}AAAA`)).toBe('format');
  });

  it('is refused when it is damaged', async () => {
    const text = await encodeShare({ design: theBill.reference });
    expect(await refusal(`${text}!`)).toBe('corrupt');
    expect(await refusal(`${SHARE_PREFIX}=====`)).toBe('corrupt');
    expect(await refusal(text.slice(0, text.length / 2))).toBe('corrupt');
    expect(await refusal(`${SHARE_PREFIX}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).toBe('corrupt');
    // Any one character changed either breaks the compression or the document inside it.
    const at = SHARE_PREFIX.length + 20;
    const flipped = text.slice(0, at) + (text[at] === 'A' ? 'B' : 'A') + text.slice(at + 1);
    expect(['corrupt', 'invalid']).toContain(await refusal(flipped));
  });

  it('is refused when what it holds is not a document', async () => {
    expect(await refusal(await forge('not json at all'))).toBe('corrupt');
    expect(await refusal(await forge(new Uint8Array([0xff, 0xfe, 0xfd])))).toBe('corrupt');
  });

  it('is refused when the document is not a design', async () => {
    expect(await refusal(await forge('{}'))).toBe('invalid');
    expect(await refusal(await forge('[]'))).toBe('invalid');
    expect(await refusal(await forge('{"design":{"nodes":[{"id":"u","type":"client","params":{"rps":-1}}]}}'))).toBe('invalid');
    expect(await refusal(await forge('{"design":{"nodes":[{"id":"u","type":"mainframe"}]}}'))).toBe('invalid');
    expect(await refusal(await forge('{"design":{"nodes":[]},"seed":1.5}'))).toBe('invalid');
    expect(await refusal(await forge('{"design":{"nodes":[]},"level":"../../etc"}'))).toBe('invalid');
    // More parts than a design may have.
    const crowd = Array.from({ length: 201 }, (_, i) => ({ id: `s${i}`, type: 'service' }));
    expect(await refusal(await forge(JSON.stringify({ design: { nodes: crowd } })))).toBe('invalid');
  });

  it('is refused when the design could not even be drawn', async () => {
    const twins = '{"design":{"nodes":[{"id":"a","type":"service"},{"id":"a","type":"cache"}]}}';
    const loose = '{"design":{"nodes":[{"id":"a","type":"service"}],"edges":[{"id":"e","from":"a","to":"nowhere"}]}}';
    expect(await refusal(await forge(twins))).toBe('invalid');
    expect(await refusal(await forge(loose))).toBe('invalid');
  });

  it('is refused before it is unpacked when the text is too long', async () => {
    expect(await refusal(SHARE_PREFIX + 'A'.repeat(MAX_ENCODED_CHARS))).toBe('too-large');
  });

  it('is refused when a small link expands into something huge', async () => {
    // A megabyte of the same letter compresses to about a thousand characters.
    const bomb = await forge(`{"design":{"name":"${'a'.repeat(2 * MAX_DECODED_BYTES)}"}}`);
    expect(bomb.length).toBeLessThan(4000);
    expect(await refusal(bomb)).toBe('too-large');
  });
});

describe('making a link', () => {
  it('refuses what is not a design', async () => {
    await expect(encodeShare({ design: { nodes: [{ id: 'u', type: 'client', params: { rps: -1 } }] } })).rejects.toMatchObject({ code: 'invalid' });
    await expect(encodeShare({ design: theBill.reference, seed: -1 })).rejects.toMatchObject({ code: 'invalid' });
  });
});
