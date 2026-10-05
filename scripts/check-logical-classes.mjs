// Fails when the web app uses a physical-direction style (left/right) where a logical one
// (start/end) exists. The interface has to mirror for Persian, and one `ml-2` is enough to leave a
// gap on the wrong side.
//
// Things that are always drawn left to right — the canvas and the charts — set `dir="ltr"` and
// position with inline styles, which this check does not look at. For a genuine exception, put
// `physical-ok` in a comment on the same line.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const source = join(root, 'apps', 'web', 'src');

const value = String.raw`[\w.\[\]/%-]+`;
const physicalClass = new RegExp(
  String.raw`(?<![\w-])(?:[\w\[\]&>.-]+:)*-?(?:` +
    String.raw`(?:ml|mr|pl|pr|left|right|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-${value}` +
    String.raw`|border-[lr](?:-${value})?` +
    String.raw`|rounded-(?:l|r|tl|tr|bl|br)(?:-${value})?` +
    String.raw`|(?:text|float|clear)-(?:left|right)` +
    String.raw`)(?![\w-])`,
  'g',
);
const physicalCss =
  /\b(?:margin|padding|border)-(?:left|right)\b|(?<![\w-])(?:left|right)\s*:|\b(?:text-align|float|clear)\s*:\s*(?:left|right)\b/g;

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(?:tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

const problems = [];
for (const file of files(source)) {
  const pattern = file.endsWith('.css') ? physicalCss : physicalClass;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (line.includes('physical-ok')) return;
      // Comments talk about left and right freely; only code is checked.
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      if (/^\s*\*/.test(code)) return;
      for (const match of code.matchAll(pattern)) {
        problems.push(`${relative(root, file)}:${index + 1}  ${match[0].trim()}`);
      }
    });
}

if (problems.length > 0) {
  console.error('Physical-direction styles found; use the logical form (ms-, pe-, start-, text-end, ...):\n');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
