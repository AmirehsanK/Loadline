# Working notes for Claude

## The controlling document

`docs/SPEC.md` is the specification: scope, engine rules, components, levels and milestones. Follow
it. Where the code and the spec disagree, that is a bug in one of them — resolve it explicitly, do
not silently diverge. `docs/ENGINE.md` explains each engine mechanism and how it was validated; it
is written alongside the engine, one mechanism at a time.

The repository is public at <https://github.com/AmirehsanK/Loadline>. The name also appears in
package names (`@loadline/*`), so a rename would be a find-and-replace and a repository rename.

## Environment facts

- Windows 11, Node 26, npm 12. pnpm, yarn and bun are not installed; this is an npm-workspaces repo.
- **TypeScript is pinned to 6.0.x, not 7.** `typescript-eslint` declares `typescript <6.1.0`, so
  moving to 7 breaks the type-aware lint until that range widens.
- TypeScript runs directly under Node (`node bench/engine.bench.ts`), which strips types and does
  nothing else. That is why `erasableSyntaxOnly` is on (no enums, namespaces or parameter
  properties) and why relative imports carry the `.ts` extension.
- Packages are consumed from source: each `package.json` exports `./src/index.ts`. There is no
  build step between packages; only the web app, CLI and MCP server produce build output.
- Dependency versions are exact, no ranges. Check the current stable with `npm view <pkg> version`
  rather than trusting memory; several of these tools have had major releases recently.
- There is no formatter. Match the surrounding code: 2 spaces, single quotes, semicolons, about 120
  columns.
- The connection is slow and its DNS is intermittent. An `npm install` that hangs is usually the
  network, not the lockfile.
- The web app's dev server is the `loadline-web` entry in `D:\Git\.claude\launch.json`, on port
  5183. `loadline-built` serves the production build on 5184 (run `npm run build -w @loadline/web`
  first); only that one has the content security policy, which the dev server would trip over.
- **Vite's file watcher misses the second of two saves made within a few milliseconds**, which is
  what two edits to one file in the same tool batch are. The server then keeps serving the first
  save, and the browser reports an error that is no longer in the file. `touch` the file (or every
  file under `apps/web/src`) and reload before believing such an error.
- The preview pane can be narrower than the app's minimum width. Emulate a viewport of about
  1040×700 to see the layout: the page is scaled down to fit the pane, and a screenshot may show
  the frame before the last change, so take it again after a pause. A click by element reference
  misses under that scaling; click from JavaScript, or by the screenshot's own coordinates. To read
  part of the page at full size, give the root element `transform: scale(2)` with a
  `transform-origin` at that part, and reload to undo it.

## Commands

```bash
npm run typecheck   # every workspace
npm run lint        # eslint, type-aware, from the root
npm test            # vitest, every workspace
npm run check       # all of the above plus build
npm run bench -w @loadline/engine
```

## Conventions

- Times are milliseconds everywhere: parameters, the clock, reports.
- Comments explain *why*, especially where the design departs from the obvious approach.
- A new engine behaviour needs a test that shows it emerging, and a level that teaches it. Realism
  has no natural end; that pairing is the boundary.
- A level's numbers are tuned, not derived. `packages/scenarios/test/attempts.ts` lists what a
  player might try on each level and the stars it should earn. If an engine change moves a row,
  the lesson has changed: retune the level and re-read its brief, hints and debrief against the
  new numbers before touching the table.
- Technical proper nouns stay English in the Persian UI: component names, p99, RPS, ms.
- Every word the interface shows comes from `apps/web/src/i18n`. A message that takes values is a
  function in the catalog, never a string glued together in a component.
- Styles use logical directions (`ms-`, `pe-`, `start-`, `text-end`), so the interface can mirror
  for Persian. `npm run lint` fails on a physical one (`ml-`, `text-left`, ...). The canvas and the
  charts are the exception: they set `dir="ltr"` and are always drawn left to right.
- The look is a painted hull (see the comment at the top of `apps/web/src/styles.css`). Sea blue
  and violet are chart series colours and were validated for colour-blind separation; hull red and
  signal amber mean failing and at risk, and are never used for a series.

## Load-bearing decisions that look optional but are not

These are the rules that make failures emerge instead of being scripted. Each has a test.

- **Arrivals are open-loop.** Clients send on a rate schedule regardless of responses. A closed
  loop (N users waiting for replies) slows down when the system does, so it can never show overload.
- **A synchronous call holds the caller's slot while it waits.** Releasing the slot early would make
  thread starvation and cascading failure impossible to reproduce.
- **A timeout does not cancel downstream work.** The orphaned call keeps its place in the queue and
  is served. Cancelling it would remove retry storms, which are made of exactly that wasted work.
- **Cache hits come from real keys.** Requests carry keys drawn from a Zipf distribution and caches
  hold keys with LRU and TTL. A hit-ratio parameter would make cold starts and stampedes scripted.
- **Latency is measured, never computed.** Percentiles come from histograms of simulated requests.
- **Every request ends in exactly one outcome**, attributed to a cause and a node. Conservation is
  a tested invariant: requests created = requests finished + requests still in flight.
- **The engine is deterministic.** Same design, workload and seed give the same report on any JS
  engine. So: all randomness comes from seeded per-node streams (`kernel/rng.ts`); events at the
  same instant break ties by sequence number; `Math.random`, `Date` and the clock APIs are
  lint-banned in `packages/engine/src`; and `ln`, `exp` and `pow` come from `kernel/detmath.ts`,
  because ECMAScript leaves the built-in versions implementation-approximated. The ban is in
  `eslint.config.js`; do not work around it with an eslint-disable.
- **Each node draws from its own random streams, keyed by its id.** Adding or editing one node
  must not reshuffle the randomness of the others, or two designs cannot be compared fairly.
- **Live metrics never pass through React Flow's `nodes` state.** Node components subscribe to the
  sim store by id, so a 10 Hz update re-renders text, not the graph.
- **A share link is untrusted input.** Decoding caps the decompressed size, then validates with the
  schema, before anything renders or runs. The same goes for an imported file and for anything
  read back from localStorage.
- **Every web entry point imports `src/strict.ts` first** (`main.tsx`, `embed/main.tsx`, the
  worker). It tells the schema library not to compile parsers from text, which the content
  security policy forbids; imported any later, a schema has already tried.

## Commit and publish

Commit at each milestone and push `main` to `origin`; the owner created the repository and asked
for the commits to be pushed there (5 October 2026). Enabling GitHub Pages, changing the
repository's settings and publishing a package are still outward-facing: ask first.
