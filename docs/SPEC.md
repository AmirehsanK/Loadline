# Loadline — specification

`Loadline` is a working name (a ship's load line marks how much it can safely carry).

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
| Routing | Hash routes: `#/`, `#/level/:id`, `#/sandbox`, `#/d/:payload` | GitHub Pages needs no rewrite rules; the payload never reaches a server |
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
    src/codec.ts          share-link encode and decode
  scenarios/              level data, scoring (runScenario), review-prompt builder
  cli/                    loadline validate | simulate | test | share
  mcp/                    stdio MCP server over engine + scenarios
apps/web/
  index.html, embed.html
  src/worker/             the engine in a Web Worker
  src/canvas/  src/inspector/  src/metrics/  src/levels/  src/review/  src/i18n/
  e2e/                    Playwright
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

- **Layout:** component palette, canvas, inspector for the selected node or edge, a metrics dock
  (KPIs, charts, failure causes, bottleneck callout), and a top bar with the level brief, run
  controls, speed, seed, share, language and theme.
- **Worker protocol:** typed messages (init, start, pause, speed, command, reset → samples, report,
  error), posted at 10 Hz.
- **Traffic display:** edge width, colour and dash speed follow throughput and error rate; a canvas
  particle overlay comes in the polish milestone.
- **Editing:** undo and redo on the design store. Desktop-first; the embed and shared views work on
  phones.

## 6. Levels

Each level is data (`packages/scenarios`): a starter design, the parts the player may add, a
workload timeline with scripted faults, objectives, two bonus tiers, hints and a debrief. The same
`runScenario` scores it in the web app, the CLI and the MCP server.

- **Objectives** are a p99 limit, an error-rate limit, a monthly budget, a limit on what is left in
  the queues at the end, and a limit on messages lost. All must be met to pass. They are judged over
  the **scored period**, which starts after a warm-up; a request belongs to the period it finished
  in.
- **Stars.** A pass is one star. Meeting the first bonus tier as well is two, and the second on top
  of that is three. The tiers reward a better answer to the same lesson, not a different trick.
- **Rules.** A level locks the settings that would make its problem go away (the traffic, how fast
  a part works) and the parts that must stay. A design that changes one cannot pass, however well
  it does. A part the player adds can be given settings it must keep. Rules that settings cannot
  express are a function of the design.
- **Seeds.** A level is played on its own seed, so the same design always scores the same.

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

Sandbox mode has every component, manual faults and no objectives.

## 7. Extras

### 7.1 Share links and embeds

- The payload is `v1.` followed by the base64url of the deflated JSON (built-in
  `CompressionStream`), carried in the URL fragment.
- It holds the design, workload and seed, so the recipient sees the same numbers.
- A link is untrusted input: decoding caps the decompressed size, then validates with the schema
  (bounded node counts and numeric ranges) before anything renders.
- `embed.html#v1.<payload>` is a read-only canvas with play and pause, a KPI strip and an "Open in
  playground" link. The share dialog offers the link and an `<iframe>` snippet.

### 7.2 Persian / RTL

- Typed message catalogs: `fa` must satisfy the shape of `en`, so a missing key is a compile
  error. No i18n framework for two locales.
- Tailwind logical utilities only (`ms-`, `pe-`, `start-`); a CI check rejects physical-direction
  classes. **This discipline starts in milestone 2**, so the Persian milestone is translation, not
  a refactor.
- The canvas and charts stay left-to-right in both locales; panels, menus and text flip.
- Technical proper nouns stay English in the Persian UI (component names, p99, RPS, ms). Metric
  readouts use Latin digits; prose uses Persian digits.
- Fonts follow League Meta: Estedad (SIL OFL) for Persian, a Latin face for figures.
- Every `fa` string must equal `normalize(s, 'standard')` from `persian-text-guard`, checked in CI.
- Claude drafts the Persian copy; Amirehsan reviews it.

### 7.3 CLI

- `loadline validate <file>`
- `loadline simulate <file> [--scenario] [--duration] [--seed] [--json]`
- `loadline test <file> --assert "p99<200ms"` — exit code 1 on failure, for CI
- `loadline share <file>` — prints a playground link
- Accepts JSON and YAML. Not published to npm.

### 7.4 MCP server

- Tools: `list_components`, `validate_design`, `simulate`, `list_scenarios`, `score_scenario`,
  `share_link`.
- Hard caps per call on simulated duration, request rate and total events, so a call returns in
  seconds.

### 7.5 AI reviewer (no backend)

- One shared prompt builder: design, level brief, run report (KPIs, per-node utilization, failure
  causes, bottleneck, a few sampled traces). The reply follows the UI language.
- Three paths: copy the prompt into any assistant; bring your own Anthropic key (kept in that
  browser's localStorage, sent only to `api.anthropic.com`, never in share links or exports); or
  the MCP server with the user's own agent.
- Responses render as plain markdown, no raw HTML. A CSP meta tag limits `connect-src`.

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

## 9. Verification

- **Engine:** `npm test` runs the queueing-theory checks, determinism (same seed gives the same
  report hash), conservation properties with fast-check, behaviour tests, golden reports, level
  solvability, and the codec round-trip including malformed and oversized input.
- **Cross-browser determinism:** Playwright runs one reference scenario in Chromium, Firefox and
  WebKit and compares each report hash with Node's.
- **Web:** Playwright covers build-and-run, level pass and fail, share round-trip, embed, and both
  locales.
- **CLI:** `loadline test` against an example file with a passing and a failing assertion.
- **MCP:** every tool called from an agent through the repo's `.mcp.json`.

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
