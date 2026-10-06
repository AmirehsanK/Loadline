import { encodeShare } from '@loadline/share';
import type { ShareInput } from '@loadline/share';
import type { Document } from '../design/store.ts';
import { hrefOf } from '../route.ts';
import { DEFAULT_SEED } from '../sim/protocol.ts';

// What is handed out when a design is shared: a link to it, a snippet that embeds it, and a file.

/** What a design is shared as. In a level that is the design and the level; the rest is the level's. */
export function shareOf(document: Document, levelId: string | null): ShareInput {
  if (levelId !== null) return { design: document.design, level: levelId };
  return { ...document, seed: document.seed ?? DEFAULT_SEED };
}

/** The address of the folder the app is served from, with a slash at the end. */
function appBase(location: Pick<Location, 'origin' | 'pathname'>): string {
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}

export interface Shared {
  /** Opens the design in the app. */
  link: string;
  /** The HTML that puts a read-only view of it on another page. */
  embed: string;
}

/** The link and the embed snippet for a design. Throws `ShareError` if it is too large for a link. */
export async function shareLinks(share: ShareInput, location: Pick<Location, 'origin' | 'pathname'>, title: string): Promise<Shared> {
  const payload = await encodeShare(share);
  const base = appBase(location);
  const escaped = title.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  return {
    link: base + hrefOf({ page: 'shared', payload }),
    embed: `<iframe src="${base}embed.html#${payload}" title="${escaped}" width="800" height="480" style="border:0" loading="lazy"></iframe>`,
  };
}

/** The text of the file a design is exported as. It is what a link holds, laid out for reading. */
export function exportText(share: ShareInput): string {
  return `${JSON.stringify(share, null, 2)}\n`;
}

/** A name for an exported file, from the design's name. */
export function exportName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${slug || 'design'}.loadline.json`;
}
