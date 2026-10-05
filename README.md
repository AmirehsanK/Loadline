# Loadline

A system design playground: draw an architecture, run traffic through it, break it, and see why it
broke.

Loadline simulates every request as it moves through load balancers, services, caches, databases
and queues. Latency, saturation, retry storms and cache stampedes are not scripted; they emerge
from queueing, timeouts and retries, the same way they do in production. A run is deterministic:
the same design and seed give the same numbers.

> Work in progress. `Loadline` is a working name.

## Status

| Milestone | State |
|---|---|
| 0 — Scaffold | done |
| 1 — Engine kernel | done |
| 2 — Walking skeleton | done |
| 3 — Full component set | |
| 4 — Levels | |
| 5 — Share links, embed, deploy | |
| 6 — Persian / RTL | |
| 7 — CLI and MCP server | |
| 8 — AI reviewer | |
| 9 — Documentation | |

The full design is in [`docs/SPEC.md`](docs/SPEC.md).

## Working on it

Requires Node 22.18 or newer.

```bash
npm install
npm run check                    # typecheck, lint, tests, build
npm run dev -w @loadline/web     # the playground, on http://localhost:5183
```

## License

MIT
