# Loadline — specification

A ship's load line is the mark on its hull that shows how much it can safely carry.

## 1. Purpose

A system design playground for the browser: draw an architecture, run traffic through it, inject
failures, and beat scored challenge levels.

The genre is crowded. As of October 2026 there are about a dozen drag-and-simulate sandboxes
(Paperdraw, SystemDraw, Breakscale and others), several of them built on proper discrete-event
simulation, plus AI interview coaches and at least one popular game. This project is a portfolio
and learning piece, so its value is in execution:

- an engine whose numbers are checked against queueing theory;
- reproducible runs (same link, same numbers, in any browser);
- one engine usable from the browser, a CLI and an MCP server.

Hence the project is **engine-first**: one tested core, with levels, sharing, the CLI, the MCP
server and AI review as thin layers over it.

Not goals: accounts, a backend, monetization, real cloud pricing.

## 2. Decisions

| Topic | Choice | Reason |
|---|---|---|
| Repository | npm workspaces | Node and npm are the only tools installed |
| Language | TypeScript 6.0.x, strict, erasable syntax only | `typescript-eslint` does not support 7 yet; Node runs the source directly |
| Engine | Discrete-event simulation: each request is an object, and timestamped events are processed in time order from a priority queue | Queueing, tail latency and overload emerge instead of being scripted |
| Where it runs | A Web Worker in the browser; plain Node for the CLI and MCP server | One engine, three front ends |
| Web | Vite, React, Tailwind 4, React Flow (`@xyflow/react`), Zustand, uPlot | React Flow is the standard canvas |
| Routing | Hash routes: `#/`, `#/level/:id`, `#/guide`, `#/guide/:id`, `#/sandbox`, `#/d/:payload` | GitHub Pages needs no rewrite rules; the payload never reaches a server |
| Storage | localStorage (versioned keys) plus JSON import and export | No backend |
| Hosting | GitHub Pages, built by GitHub Actions | Free and static |
| Units | Milliseconds for every time value | One unit, no conversions |

## 3. Repository layout

```
CLAUDE.md                 conventions and load-bearing decisions
docs/SPEC.md              this file
docs/ENGINE.md            how each mechanism works and how it was validated
packages/
  engine/                 pure TS, no DOM or Node APIs; only dependency is zod
    src/kernel/           event heap, seeded RNG streams, distributions, detmath, call pool
    src/model/            design-document schema (zod), types, lint rules
    src/nodes/            one behaviour per component type
    src/metrics/          histogram, samples, failure causes, bottleneck detection
    src/sim.ts            createSimulation → advance / command / samples / report
  scenarios/              level data, scoring (runScenario), review-prompt builder
  share/                  a design as the text of a link, and back; uses the platform's
                          compression streams, which is why it is not part of the engine
  cli/                    loadline validate | simulate | test | share | review | levels
  mcp/                    stdio MCP server over the same reading, running and scoring as the CLI
examples/                 designs to try the command line on
apps/web/
  index.html, embed.html
  src/worker/             the engine in a Web Worker
  src/canvas/  src/inspector/  src/metrics/  src/level/  src/guide/  src/share/
  src/embed/  src/review/  src/i18n/
scripts/                  the check for physical-direction classes; the README's screenshots;
                          the same runs in each installed browser as in Node
.github/workflows/        ci.yml, pages.yml
```

## 4. Engine

### 4.1 Rules that make failures emerge

1. **Arrivals are open-loop.** Clients send on a rate schedule regardless of responses, so
   overload is possible.
2. **A synchronous call holds the caller's slot** while it waits. This produces thread starvation
   and cascading failure.
3. **A timeout does not cancel downstream work.** The orphaned call keeps consuming capacity. This
   produces retry storms.
4. **Cache hits come from real keys.** Requests carry keys drawn from a Zipf distribution; caches
   hold keys with LRU and TTL. Hit ratio, cold start and stampede are never a typed-in percentage.
5. **Latency is measured, never computed.** Percentiles come from histograms of simulated requests.
6. **Every request ends in exactly one outcome**, attributed to a cause and a node: ok, timeout,
   queue full, rate limited, node down, circuit open, injected error or network drop.
7. **The engine is deterministic.** All randomness comes from seeded per-node streams, ties break
   by sequence number, and `Math.random`, `Date` and the clock APIs are lint-banned in
   `packages/engine/src`. `ln`, `exp` and `pow` are implemented in `kernel/detmath.ts` from basic
   arithmetic, because the built-in versions are not guaranteed to agree between JS engines.
8. **Live metrics never pass through React Flow's `nodes` state.** Node components subscribe to
   the sim store by id, so a 10 Hz update re-renders text, not the graph.

### 4.2 Calls

The unit of work is a **call**: one invocation of a node on behalf of a request. A client request
is a call at the client node; each attempt it makes is a child call into the system; a service
handling a call makes child calls to its own dependencies. One mechanism therefore covers both a
user retrying and a service retrying its database.

- The caller owns the policy of an edge: timeout, retries, backoff and jitter.
- When a timeout fires the caller stops waiting, but the child carries on as an orphan (rule 3).
  The engine walks down to the deepest call still in progress and records where it was stuck
  (which node, queued or in service). That is the evidence behind "timed out waiting in the
  database queue".
- Work done for an orphan is counted per node as wasted work.

### 4.3 Components (v1)

| Type | Main parameters | What emerges |
|---|---|---|
| Client | rate, share of reads, number of items and how unevenly they are asked for | overload, retry storms |
| Load balancer | algorithm (round-robin, random, least-connections, two-choices), health-check interval | uneven load, failover delay |
| Service | instances, concurrency, queue, service-time distribution, autoscaling (target, min/max, boot time, cooldown) | thread starvation, scaling lag |
| Cache | capacity, TTL and jitter, single-flight toggle | hit ratio, cold start, stampede |
| Database | queries at full speed, connection limit, read and write times, replicas, failover time | contention, write outage |
| Queue | max depth, overflow policy | backlog, drain time |
| Worker | instances, concurrency, processing time, failure rate, tries before giving up | consumer lag |
| Rate limiter | token-bucket rate and burst | load shedding |

- **Edges** carry network latency, a filter (all, read, write), a mode (sync, async), and the
  caller's policy: timeout, retries, backoff, jitter, circuit breaker, and pool size for database
  edges.
- **A multi-instance service needs a load balancer in front.** Without one, only the first
  instance gets traffic and the lint says so.
- **Faults:** traffic spike, node or instances down, node slowed, a share of calls failed, cache
  emptied, database failover, connection cut, connection delayed. They can be triggered by hand or
  scheduled in a workload, and a scheduled fault is part of the run.
- **Cost** is a made-up monthly price per part (`src/cost.ts`): a fixed amount per instance or
  server plus an amount per slot, core or thousand cached items, accrued over the run.
- **Live edits:** setting changes and faults apply mid-run; adding or removing nodes or edges
  restarts the run.
- **Where the time goes:** `findBottleneck` follows the waiting from a client to the part the time
  is really spent in, and says what is short there.

### 4.4 Performance budget

At least 1 million events per second in Node on the development machine, measured by
`npm run bench -w @loadline/engine`. Level sizes are set from the measured number. If the worker
falls behind, the UI shows the real speed; fidelity is never dropped silently.

## 5. Web app

- **Pages:** `#/` is the front page, with the list of levels and how many stars each has earned;
  `#/level/<id>` plays a level; `#/sandbox` is the playground with every part and no objectives;
  `#/guide` and `#/guide/<id>` are the guide and its lesson on a level.
- **Layout of the workbench:** a left panel, the canvas, an inspector for the selected node or
  edge, and a metrics dock (KPIs, charts, failure causes, bottleneck callout). In the sandbox the
  left panel is the palette of parts. In a level it is the brief, the objectives with how the run
  stands against each, hints, and the parts that level allows.
- **Playing a level:** the run uses the level's traffic, faults and seed, and ends at the level's
  duration; the top bar shows that as a timeline, with the warm-up and each scripted fault marked.
  The run can go at full speed, which is as fast as the engine will. Any change to the design
  starts the run over, stopped, because a level is scored on one design from start to finish.
  When a run ends its result opens: what was met, the stars, and on a pass the debrief.
- **Rules in the editor:** settings a level has fixed are shown and cannot be changed, parts it
  needs cannot be removed, and only the parts it offers can be added. The scoring enforces the
  same rules; the editor only makes sure nobody finds out at the end of a run.
- **Storage:** the sandbox design, the design in progress for each level, and the stars earned are
  each kept in localStorage under a versioned key. Saved data is validated like any other input.
- **Worker protocol:** typed messages (load, reconfigure, play, pause, speed, multiplier, command →
  frame, failed). A frame is posted about ten times a second and carries the level's result so far.
- **Traffic display:** the calls on a connection travel along it as dots. The more calls, the
  closer the dots; for the share that failed, every so many dots one is red.
- **Editing:** undo and redo on the design store, where a run of changes to one part is one step.
  Desktop-first; the embed and shared views work on phones.

## 6. Levels

Each level is data (`packages/scenarios`): a starter design, the parts the player may add, a
workload timeline with scripted faults, objectives, two bonus tiers, hints and a debrief. The same
`runScenario` scores it in the web app, the CLI and the MCP server.

- **Objectives** are a p99 limit, an error-rate limit, a monthly budget, a limit on what is left in
  the queues at the end, a limit on messages lost, and a limit on how long any message waited in a
  queue before a worker took it. All must be met to pass. They are judged over
  the **scored period**, which starts after a warm-up; a request belongs to the period it finished
  in.
- **Stars.** A pass is one star. Meeting the first bonus tier as well is two, and the second on top
  of that is three. The tiers reward a better answer to the same lesson, not a different trick.
  They have to tell answers apart: on every level the table of attempts has an
  answer that passes with one or two stars, and a test checks that it stays so. Where a level had
  only a pass mark, the fix was a real cost on the other side of the right answer, not a tighter
  number: a timeout far past the slow answers waits for them, randomising lifetimes completely
  doubles the fetches, a retry by the user repeats work a retry inside does not, and a worker
  whose waits keep doubling sleeps through the recovery.
- **Rules.** A level locks the settings that would make its problem go away (the traffic, how fast
  a part works) and the parts that must stay. A design that changes one cannot pass, however well
  it does. A part the player adds can be given settings it must keep. Rules that settings cannot
  express are a function of the design.
- **Seeds.** A level is played on its own seed, so the same design always scores the same.

- **The guide.** For someone who wants to learn and does not know how to solve a level, the
  hints are not enough: they nudge, and stop short of explaining. The guide explains. Its front
  page says how to read the screen and what the words mean. Each lesson takes one level: what is
  going wrong and why, the idea that fixes it and the name it goes by elsewhere, what to change
  step by step, why that is the best answer, and what else a player might try and what comes of
  it. It gives the answer away and says so; the hints stay the gentle way in. A button opens the
  level with the answer on the canvas, as an edit that undo takes back.
  - Nothing measured is written into a lesson. What the answer scores is run on the page by
    `runScenario`, so those figures cannot fall behind the engine.
  - What is written is tied down where it can be: each line about another attempt is a row of
    `attempts.ts`; every setting a step names is checked against the inspector's labels in both
    languages; and the Persian gives no figure the English does not.
  - A lesson is reachable from its level's panel and from the front page. Unlike the workbench it
    is a page to read, and fits a phone.

Every level ships with a reference solution. CI proves that on five seeds the starter fails and the
reference earns three stars, and checks a table of what a player might try against the stars each
attempt should get (`packages/scenarios/test/attempts.ts`). That table is the lessons, written as
tests: an engine change that moves a row has changed what a level teaches.

| # | Level | Lesson |
|---|---|---|
| 1 | First traffic | Horizontal scaling, and why waiting explodes near full utilization |
| 2 | Read-heavy | A cache in front of a store that cannot grow; a few items get most of the traffic |
| 3 | Pool party | Connection pools: too many queries at once make a database slower, not busier |
| 4 | Slow dependency | Timeouts and circuit breakers; a breaker counts failures, not slowness |
| 5 | Retry storm | Retries multiply load; what ends a storm is less work |
| 6 | Write burst | Queues and workers: store now, do later, and size for the catch-up |
| 7 | Stampede | Surviving a cache flush at peak: fetch each item once |
| 8 | Black Friday | Autoscaling is late; headroom buys time, under a budget |
| 9 | Node down | One more instance than the load needs, health checks, and a retry |
| 10 | The bill | Sizing every part to its load line, at the peak, while holding the objectives |
| 11 | Luck of the draw | How a balancer picks an instance: looking at two beats picking one blind |
| 12 | Patience | A timeout shorter than a healthy answer; set it from the slow end, not the average |
| 13 | Full house | Rate limiting: turn the excess away at the door, a little under what you can serve |
| 14 | Never twice | Read replicas, for reads that never repeat and a cache cannot help |
| 15 | Clockwork | Items stored together expire together; randomise their lifetimes |
| 16 | Nine times | Retries multiply down a chain of calls; retry in one layer |
| 17 | Wrong suspect | Finding the bottleneck: the part that hurts is not always the part that is short |
| 18 | Failover | A replica for reads, a queue for writes, and a worker that waits between tries |

The first ten came with the plan. The other eight were added afterwards, one for each thing the
engine could already do and no level asked for: the ways a balancer picks an instance, a timeout
that is too short, the rate limiter (the one part no level used), read replicas, lifetimes in a
cache, retries at more than one layer, the panel that finds the bottleneck, and a database failover
with redelivery. None needed a change to the engine, which is the rule of section 11 kept: a new
behaviour needs a level, and a level should not need a new behaviour made up for it.

Sandbox mode has every component, manual faults and no objectives.

## 7. Extras

### 7.1 Share links and embeds

- The payload is `v1.` followed by the base64url of the deflated JSON (built-in
  `CompressionStream`), carried in the URL fragment as `#/d/<payload>`. Nothing is uploaded.
- It holds the design and what goes with it: the seed, and either the id of the level it answers
  or traffic and faults of its own. So the recipient sees the same numbers.
- Settings at their defaults are left out, part by part, and only when reading the part back gives
  exactly what went in. A level's answer comes to a few hundred characters.
- A link is untrusted input: decoding checks the length of the text, caps the decompressed size,
  then validates with the schema (bounded node counts and numeric ranges), and refuses a design
  the editor could not draw, before anything renders. A refused link says why.
- A design from a link is looked at, not adopted: it is not saved, running it earns no stars, and
  a banner offers to make it the visitor's own design, which replaces the one they had.
- `embed.html#v1.<payload>` is a read-only canvas with run and restart, the numbers that matter
  and an "Open in Loadline" link. The share dialog offers the link and an `<iframe>` snippet.
- The same document can be exported as a JSON file and imported again. A file is checked like a
  link; in a level only its design is taken, and only if it keeps the level's rules.
- The built pages carry a content security policy that allows their own files and nothing else.

### 7.2 Persian / RTL

- Typed message catalogs: `fa` must satisfy the shape of `en`, so a missing key is a compile
  error. No i18n framework for two locales.
- Tailwind logical utilities only (`ms-`, `pe-`, `start-`); a CI check rejects physical-direction
  classes. **This discipline starts in milestone 2**, so the Persian milestone is translation, not
  a refactor.
- The canvas and charts stay left-to-right in both locales; panels, menus and text flip.
- Technical proper nouns stay English in the Persian UI (component names, p99, RPS, ms). Metric
  readouts use Latin digits; prose uses Persian digits.
- Fonts follow League Meta: Estedad (SIL OFL) for Persian, a Latin face for figures. Estedad comes
  after the Latin face in every stack, so the browser takes Persian letters from it one character
  at a time and an English name inside a Persian sentence keeps its own face. Headings lose their
  letter-spacing in Persian, which would break the joins, and the page is set a little larger.
- The language is the one chosen before, or Persian for a browser that asks for Persian first.
  The switch is the name of the other language, in that language.
- The words of each level are in `apps/web/src/i18n/levels.fa.ts`, by level id. A test checks that
  no figure appears in the Persian that is not in the English, which is tuned against the engine.
- Every `fa` string is checked in CI with `persian-text-guard`: it must be unchanged by the tidying
  steps of the `standard` preset, and must hold no look-alike letter (Arabic yeh or kaf, and the
  like). The preset is not used whole, because it also folds «آ» and «أ» into «ا», which is right
  for comparing text and wrong for showing it.
- Claude drafts the Persian copy; Amirehsan reviews it. **The copy has not been reviewed yet.**

### 7.3 CLI

- `loadline validate <file>` — exit code 1 if the design cannot run
- `loadline simulate <file> [--level <id>] [--duration 90s] [--seed n] [--json]`
- `loadline test <file> --assert "p99<200ms" ...` — exit code 1 if a condition fails, for CI. A
  condition is a metric, a comparison and a number: `errors<=1%`, `cost<300`, `stars>=2`. With a
  level and no condition, the condition is that the level is passed.
- `loadline share <file> [--base <url>]` — prints a playground link
- `loadline review <file> [--language en|fa]` — runs the design and prints the review prompt
- `loadline levels` — lists the levels
- A file is JSON or YAML: a design, or the same document the web app exports (a design with its
  seed, and the level it answers or traffic of its own). It is checked like a link.
- Exit code 2 means the command itself made no sense; 1 is always a check that failed.
- It runs from source under Node (`npm run loadline -- <command>`). Not published to npm.

### 7.4 MCP server

- Tools: `list_components`, `validate_design`, `simulate`, `list_scenarios`, `score_scenario`,
  `share_link`. All read-only.
- `list_components` gives every kind of part with its defaults, taken from the schema, so a
  design written from it alone is one the engine accepts. `list_scenarios` with an id gives a
  level in full: brief, objectives, fixed settings, and the design it starts from.
- `score_scenario` is the same scoring as the web app and the tests, so an agent that says a
  design passes is right in the browser too.
- Hard caps per call on simulated duration (10 minutes), request rate (20,000 a second) and total
  events, so a call returns in seconds. A design is not validated by the tool's schema but by the
  tool itself, so that what is wrong comes back in words the agent can act on.
- It runs over stdio (`npm run mcp`), and `.mcp.json` at the root registers it for an agent
  working in the repository.

### 7.5 AI reviewer (no backend)

- One prompt builder (`buildReviewPrompt` in `packages/scenarios`), used by every path: the
  design in words, what was asked of it (the level's brief, objectives and fixed settings, or the
  traffic it followed), and what the run measured (totals, each part, the connections where
  something went wrong, why requests failed, where the time went, and a dozen moments over time).
  Everything in it is a setting or a measurement, and the model is told to add nothing to it. The
  reply is asked for in the language of the interface.
- Three paths. Copy the prompt into any assistant (`loadline review <file>` prints the same
  prompt at the command line). Or bring an Anthropic API key: it is typed into the visitor's own
  browser, kept there only if they ask, sent only to `api.anthropic.com`, and is never part of a
  link, an export or an embed. Or connect an agent to the MCP server and let it run designs itself.
- The call is made with the official SDK from the browser, to `claude-opus-5-5`, streamed, with
  the API's default fallback switched on so that a declined request is retried on the model
  Anthropic recommends instead of coming back empty. A refusal, a refused key, a full rate limit
  and a dropped connection are each reported in their own words.
- A reply is text from outside and is shown as text: the small part of Markdown a review uses is
  read into a tree and drawn with the app's own elements. Nothing in it reaches the page as markup.
- The content security policy lets the built pages call `api.anthropic.com` and nowhere else.
- It is tested end to end against a provider that is not there: the real SDK makes the request and
  a stand-in for the network answers as the API does. **A review with a real key has not been run
  yet; that check is Amirehsan's.**

## 8. Milestones

| # | Milestone | Done when |
|---|---|---|
| 0 | Scaffold: workspaces, strict TS, ESLint, Vitest, CI skeleton, `CLAUDE.md`, this spec | typecheck, lint, test and build pass |
| 1 | Engine kernel: event heap, RNG, distributions, call mechanics, queueing station, Client and Service, histogram, report | Results match M/M/1, M/M/c (Erlang C), M/M/1/K and M/D/1 within sampling error; determinism and conservation tests pass; benchmark recorded in `docs/ENGINE.md` |
| 2 | Walking skeleton: canvas, inspector, worker, run controls, live KPIs, one chart | In the browser: drag, connect, play, and watch latency climb as the rate passes capacity |
| 3 | Full component set, circuit breakers, autoscaling, chaos, failure causes, cost | A test per emergent behaviour (retry storm, stampede, pool exhaustion, scaling lag, balancer algorithms); golden reports committed |
| 4 | Levels, scoring, results and debrief, progress, undo and redo, particles, visual pass | CI proves each starter fails and each reference solution passes on 5 seeds; a level plays through in the browser |
| 5 | Share links, embed, import and export, Pages workflow | A link round-trip reproduces identical KPIs; the embed renders in an iframe |
| 6 | Persian / RTL | Screenshots in both locales; no physical-direction classes; the copy has been reviewed |
| 7 | CLI and MCP server | `loadline test` passes and fails correctly in CI; an agent solves a level through the MCP tools and returns a share link |
| 8 | AI reviewer | End-to-end test against a mocked provider; one live review run by the owner with their own key |
| 9 | README with screenshots, `docs/ENGINE.md` finished, architecture diagram | A stranger can understand and run the project from the README |

Milestones 6, 7 and 8 are independent of each other and can be reordered. Milestones 0–5 already
make a complete, deployed piece.

**State on 6 October 2026.** All ten are built, and what each was to be checked by passes, with
these exceptions:

- 6: the Persian copy has not been reviewed, the guide's included.
- 7: the tests solve a level through the MCP tools and get a share link back, in memory and over
  standard input and output. No agent has been pointed at the server through `.mcp.json` yet.
- 8: no review has been run with a real key.

All three are the owner's to do.

The site is at <https://amirehsank.github.io/Loadline/>. The Pages workflow publishes every push
to `main` that passes the checks, so what is live is `main`. It was checked there on the day it
went up: the first level fails on its starting design and passes on the reference with the
figures Node gives; the link to that answer, opened in a fresh profile, shows the same figures and
earns that visitor no stars; the embed loads; a link made by the command line opens; Persian
mirrors; and no console reports an error or a request the policy refused.

## 9. Verification

What is automated, and runs in CI on every push:

- **Engine:** `npm test` runs the queueing-theory checks, determinism (same seed gives the same
  report hash), conservation properties with fast-check, behaviour tests, golden reports, level
  solvability, and the codec round-trip including malformed and oversized input.
- **Web:** the stores, the worker's runner, level rules, sharing, both catalogs and the review
  request are unit-tested without a browser.
- **CLI:** `loadline test` against an example file with a passing and a failing assertion.
- **MCP:** every tool is called through the protocol, in memory and from a separate process.
- **Between JavaScript engines:** `npm run browsers` makes nineteen runs (the engine's reference
  system, and the reference answer to each level) in Node and in each installed browser, and the
  hash of every report must be the same. CI runs it in Firefox and Chrome. On the development
  machine Edge is checked as well. Safari's engine is not: it cannot be started from a script.
  This replaces the Playwright run in three engines that was planned, which would have needed
  browsers downloaded; this one uses the browsers that are there.

What is run on demand, in a real browser:

- **Every lesson, followed by hand.** `npm run lessons` opens each level in the built app and
  carries out the steps of its lesson as a person would: adds parts, draws and deletes connections,
  selects things and types into settings by the names the inspector shows. Each level then has to
  be passed with three stars. It is the nearest thing here to an end-to-end test of the editor, and
  it is how a lesson that told the reader to draw a connection the editor refuses was found.
- **The rest of the app.** `npm run screenshots` plays the first level in both languages (the
  starting design failing, then the reference passing), and each milestone was looked at in the
  browser: a link opened and kept, the embed in a frame, both languages. That part is a smoke
  test, not coverage.

## 10. Deferred

Data-correctness accounting (stale reads, lost writes, duplicates), export to docker-compose plus a
load script, multi-region, sharding and hot partitions, accounts and leaderboards, real cloud
pricing, mobile editing, multiplayer.

## 11. Risks

- **Realism has no natural end.** The eight rules and eight component types are the v1 boundary; a
  new behaviour needs a level that teaches it.
- **Engine slower than budget.** Level sizes follow the measured benchmark; the fallback is smaller
  request rates, not sampling.
- **UI polish eats the schedule.** The skeleton lands in milestone 2 and the visual pass is
  confined to milestone 4.
