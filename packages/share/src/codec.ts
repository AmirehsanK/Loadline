import { designSchema, edgeSchema, lintDesign, nodeSchema, workloadSchema } from '@loadline/engine';
import type { Design } from '@loadline/engine';
import { z } from 'zod';

// A design as text short enough to carry in the fragment of a link: the document as JSON, with
// everything that is at its default left out, compressed, in base64 that is safe in a URL.
//
// A link is untrusted input. Whoever made it controls every byte, so reading one checks, in order,
// that the text is short, that it is base64, that what it expands to is small, and that the result
// is a design the schema accepts. Nothing is shown or run before all of that has passed.

/** What every link of this version starts with. A change to the format gets a new one. */
export const SHARE_PREFIX = 'v1.';
/** The longest link text read. Longer than this does not survive being pasted into most places. */
export const MAX_ENCODED_CHARS = 60_000;
/** The largest document a link may expand to. Two hundred parts with every setting given fit. */
export const MAX_DECODED_BYTES = 512 * 1024;

/** What a link carries. */
export const shareSchema = z.object({
  design: designSchema,
  /** The seed the sender ran it with, so the numbers are the same. */
  seed: z.number().int().min(0).max(0xffff_ffff).optional(),
  /** The id of the level the design is an answer to. */
  level: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/)
    .optional(),
  /** Traffic and faults that go with the design, when it is not a level's. */
  workload: workloadSchema.optional(),
});
export type Share = z.infer<typeof shareSchema>;
export type ShareInput = z.input<typeof shareSchema>;

/**
 * Why a link could not be read.
 * - `format`: it is not a link of this kind, or of a version this build does not know.
 * - `too-large`: the text, or what it expands to, is over the limit.
 * - `corrupt`: it is damaged: not base64, not compressed data, or not JSON.
 * - `invalid`: it is a document, and not a design that can be opened.
 */
export type ShareErrorCode = 'format' | 'too-large' | 'corrupt' | 'invalid';

export class ShareError extends Error {
  readonly code: ShareErrorCode;

  constructor(code: ShareErrorCode, message: string) {
    super(message);
    this.name = 'ShareError';
    this.code = code;
  }
}

// Problems the editor shows and lives with are fine in a shared design. These three it cannot
// even draw: two things with one id, or a connection to nothing.
const UNOPENABLE = new Set(['duplicate-node', 'duplicate-edge', 'dangling-edge']);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * `value` without whatever is equal to `defaults`, looking `depth` levels into objects;
 * undefined when nothing is left.
 */
function prune(value: unknown, defaults: unknown, depth: number): unknown {
  if (same(value, defaults)) return undefined;
  if (depth === 0 || typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) return value;
  const kept: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    const left = prune(inner, (defaults as Record<string, unknown>)[key], depth - 1);
    if (left !== undefined) kept[key] = left;
  }
  return kept;
}

/**
 * A part with every setting that is at its default taken out, as long as reading that back
 * through the schema gives the part again. Not every group of settings can lose some of its
 * fields (a duration needs its mean even when the mean is the usual one), so it tries leaving out
 * single settings wherever they are, then only whole ones, and otherwise leaves the part as it is.
 */
function compact<T extends object>(part: T, blank: T, identity: Partial<T>, reads: (candidate: unknown) => T | undefined): unknown {
  // Two levels down from a part are its settings; any deeper is inside a group of them.
  for (const depth of [Infinity, 2]) {
    const candidate = { ...(prune(part, blank, depth) as object), ...identity };
    if (same(reads(candidate), part)) return candidate;
  }
  return part;
}

/** A design with every setting that is at its default taken out. */
function sparse(design: Design): unknown {
  return {
    ...(design.name === '' ? {} : { name: design.name }),
    nodes: design.nodes.map((node) => {
      const identity = { id: node.id, type: node.type };
      return compact(node, nodeSchema.parse(identity), identity, (candidate) => nodeSchema.safeParse(candidate).data);
    }),
    edges: design.edges.map((edge) => {
      const identity = { id: edge.id, from: edge.from, to: edge.to };
      return compact(edge, edgeSchema.parse(identity), identity, (candidate) => edgeSchema.safeParse(candidate).data);
    }),
  };
}

/** Passes bytes through a compression stream, giving up if more than `limit` come out. */
async function pump(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // A failure to write shows up as a failure to read, which is where it is handled.
  writer
    .write(bytes)
    .then(() => writer.close())
    .catch(() => undefined);

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new ShareError('too-large', 'The link expands to more than a design can be.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new ShareError('corrupt', 'The link has characters a link of this kind never has.');
  let binary: string;
  try {
    binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  } catch {
    throw new ShareError('corrupt', 'The link is cut short or damaged.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The text of a link for a design: `v1.` and the document, compressed. Throws `ShareError` if the
 * document is not valid, or too large to be read back.
 */
export async function encodeShare(input: ShareInput): Promise<string> {
  const parsed = shareSchema.safeParse(input);
  if (!parsed.success) throw new ShareError('invalid', `This is not a design that can be shared: ${z.prettifyError(parsed.error)}`);
  const share = parsed.data;

  // Leaving the defaults out makes a link about half the length. It is only done when putting
  // them back gives exactly the design that was passed in.
  const compact = { ...share, design: sparse(share.design) };
  const restored = shareSchema.safeParse(compact);
  const document = restored.success && same(restored.data, share) ? compact : share;

  const json = new TextEncoder().encode(JSON.stringify(document));
  if (json.length > MAX_DECODED_BYTES) throw new ShareError('too-large', 'The design is too large to share as a link.');
  const packed = await pump(json, new CompressionStream('deflate-raw'), MAX_DECODED_BYTES);
  const text = SHARE_PREFIX + toBase64Url(packed);
  if (text.length > MAX_ENCODED_CHARS) throw new ShareError('too-large', 'The design is too large to share as a link.');
  return text;
}

/** Reads the text of a link back into a design. Throws `ShareError` saying what was wrong with it. */
export async function decodeShare(text: string): Promise<Share> {
  if (text.length > MAX_ENCODED_CHARS) throw new ShareError('too-large', 'The link is longer than a design can be.');
  if (!text.startsWith(SHARE_PREFIX)) {
    throw new ShareError('format', 'This is not a Loadline link, or it was made by a newer version.');
  }
  const packed = fromBase64Url(text.slice(SHARE_PREFIX.length));

  let json: string;
  try {
    const bytes = await pump(packed, new DecompressionStream('deflate-raw'), MAX_DECODED_BYTES);
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof ShareError) throw error;
    throw new ShareError('corrupt', 'The link is cut short or damaged.');
  }

  let document: unknown;
  try {
    document = JSON.parse(json);
  } catch {
    throw new ShareError('corrupt', 'The link is cut short or damaged.');
  }

  const parsed = shareSchema.safeParse(document);
  if (!parsed.success) throw new ShareError('invalid', `The link does not hold a design: ${z.prettifyError(parsed.error)}`);
  const broken = lintDesign(parsed.data.design).find((issue) => UNOPENABLE.has(issue.code));
  if (broken) throw new ShareError('invalid', `The link does not hold a design: ${broken.message}`);
  return parsed.data;
}
