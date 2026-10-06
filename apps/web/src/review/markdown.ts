// A reply from a language model is text from outside, and is shown as text. This reads the small
// part of Markdown a review uses (headings, paragraphs, lists, bold, italic, code) into a tree the
// interface draws with its own elements. Anything else, HTML included, stays the characters it is:
// nothing in a reply is ever handed to the browser as markup.

export interface Span {
  text: string;
  bold?: true;
  italic?: true;
  code?: true;
}

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'list'; ordered: boolean; items: Span[][] };

/** The bold, italic and code inside a line. Markers that do not close are ordinary characters. */
export function parseSpans(text: string): Span[] {
  const spans: Span[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|(?<![A-Za-z0-9])_([^_\s][^_]*)_(?![A-Za-z0-9])/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > at) spans.push({ text: text.slice(at, match.index) });
    if (match[1] !== undefined) spans.push({ text: match[1], code: true });
    else if (match[2] !== undefined || match[3] !== undefined) spans.push({ text: (match[2] ?? match[3])!, bold: true });
    else spans.push({ text: (match[4] ?? match[5])!, italic: true });
    at = match.index + match[0].length;
  }
  if (at < text.length) spans.push({ text: text.slice(at) });
  return spans;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', spans: parseSpans(paragraph.join(' ')) });
    paragraph = [];
  };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: Math.min(heading[1]!.length, 3) as 1 | 2 | 3, spans: parseSpans(heading[2]!) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      flush();
      const ordered = numbered !== null;
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(parseSpans(item[1]!));
      else blocks.push({ kind: 'list', ordered, items: [parseSpans(item[1]!)] });
      continue;
    }
    // A line indented under a list item carries that item on.
    const last = blocks[blocks.length - 1];
    if (paragraph.length === 0 && last?.kind === 'list' && /^\s+\S/.test(raw)) {
      last.items[last.items.length - 1]!.push(...parseSpans(` ${line.trim()}`));
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
