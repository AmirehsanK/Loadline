# How the engine works

This file explains each mechanism of `packages/engine` and how it was checked. It grows with the
engine: a mechanism is described here when it is built.

## 1. A discrete-event simulation

The engine does not step time forward in ticks. It keeps a queue of **events**, each with a
timestamp, and repeatedly takes the earliest one, jumps the clock to it, and runs it. Running an
event usually schedules more events. Between two events nothing happens, so nothing is computed.

This matters for realism. In a tick-based model a request that needs 3.2 ms of work finishes "this
tick" or "next tick", and queueing delay has to be approximated. Here a request is an object that
occupies a slot for exactly its sampled service time and waits in a real queue behind real
requests. Latency is whatever the clock says when its reply arrives.

`Simulation.advance(untilMs)` (`src/sim.ts`) is the whole loop:

| Event | Meaning |
|---|---|
| arrive | A call reaches a node, after the edge's network latency |
| service done | A node finishes its own work on a call |
| return | A reply reaches the caller |
| timeout | A caller's patience for one attempt runs out |
| retry | A backoff wait is over |
| timer | Node-specific; the client uses it for its next arrival |
| phase | The workload's traffic multiplier changes |
| sample | A sampling window closes |

## 2. Calls

The unit of work is a **call**: one invocation of a node on behalf of a request.

- A client request is a call at the client node.
- Each attempt the client makes is a child call, travelling over the client's edge.
- A service handling a call makes child calls to its own dependencies, one per outgoing edge, in
  order.

So one mechanism covers a user retrying a page and a service retrying its database.
`Simulation.issue` makes a child call; `Simulation.finish` hands a call back; `Simulation.settle`
applies the edge's retry policy to a finished attempt.

A call moves through these states (`src/codes.ts`):

```
traveling → queued → in-service → waiting ⇄ backoff → returning
              (no free slot)        (on a dependency)
```

### 2.1 The caller owns the policy

Timeout, retries, backoff and jitter belong to the **edge**, and are applied by the caller's side
of it. The wait before retry `n` is `backoffMs × backoffFactor^(n-1)`, scaled by a random factor
between `1 - jitter` and 1.

### 2.2 A synchronous call holds its slot

A service call takes one of the instance's `concurrency` slots when its work starts and gives it
back only when the whole call is finished, dependencies included. A slow dependency therefore fills
the caller's slots, the caller's own queue grows, and the slowness travels upstream. Nothing in the
engine names this "cascading failure"; it is a consequence of the slot rule.

### 2.3 A timeout does not cancel the work

When a timeout fires, the caller stops waiting and the engine does three things
(`Simulation.onTimeout`):

1. It follows the chain of calls each waiting on the next, down to the last one. That call is
   where the time was going, and its node and state (queued, in service, ...) become the
   **blame** for the timeout. A client timeout caused by a database two hops away is attributed to
   the database queue, not to the first hop.
2. It marks every call on that chain as an **orphan**. Orphans carry on: they keep their place in
   the queue and are served. Work a node completes for an orphan is counted as **wasted**.
3. It lets the caller retry or give up, per the edge's policy.

When an orphan's reply finally arrives, nobody is waiting for it and it is dropped.

Slots in the call pool are reused, so a late event could otherwise act on the wrong call. Every
slot has a generation counter, bumped on release, and events that can outlive their call carry the
generation and check it.

## 3. Determinism

The same design, workload and seed produce the same report, bit for bit, however the run is cut
into `advance` steps.

- **Seeded streams.** Every random draw comes from a `RandomStream` (sfc32) identified by the run's
  seed and a key such as `api/service` or `users/arrivals`. Each node and edge has its own streams,
  so adding a node to a design does not disturb the randomness of the others. Two designs can then
  be compared on identical traffic.
- **Tie-breaking.** Events at the same instant run in the order they were scheduled.
- **No wall clock.** `Date`, `performance`, timers and `Math.random` are lint errors inside
  `packages/engine/src`.
- **Own `ln` and `exp`.** ECMAScript leaves `Math.log`, `Math.exp` and `Math.pow`
  implementation-approximated, so two JS engines may differ in the last bit, and one bit in a
  sampled service time is enough to reorder two events. `src/kernel/detmath.ts` implements them from
  `+ - * /` and bit manipulation, which IEEE 754 defines exactly. They are accurate to about one
  unit in the last place rather than correctly rounded; a test pins their exact output bits.

## 4. Data layout

A run schedules millions of events a second, so the hot structures avoid allocating objects:

- `EventQueue` is a binary heap stored as parallel typed arrays (time, sequence, kind and three
  integer arguments). Events with long delays, such as timeouts, would otherwise survive into the
  garbage collector's old generation and cause pauses.
- `CallPool` stores every call in flight as parallel typed arrays indexed by slot, with a free
  list. It grows by doubling up to a limit (two million calls by default). Reaching the limit stops
  the run with `SimulationLimitError`: the design lets work pile up without bound.

## 5. Measurement

- **Latency** goes into a histogram with fixed relative precision (`src/metrics/histogram.ts`):
  values are whole microseconds, each power of two is split into 64 buckets, and a reported
  quantile is within 0.8% of the true one. The mean, minimum and maximum are tracked exactly.
- **Utilization** is busy slot-time divided by available slot-time. Each node integrates its busy
  slots, queued calls and capacity over time, updating the integral just before any of them
  changes.
- **Samples.** Every `sampleMs` of simulated time (one second by default) the engine closes a
  window and records what happened in it: requests created, succeeded and failed, latency
  percentiles, and per node the arrivals, utilization and queue length. Windows are cut in simulated
  time, so the series is part of the deterministic report and is the same at any playback speed.
- **Conservation.** Every request ends in exactly one outcome. At any moment,
  `created = ok + failed + in flight`, and for every node `arrivals = ok + failed + in a slot +
  queued`. A property test generates random chains and checks these after each run.

## 6. Validation against queueing theory

A service with one instance, `c` slots and exponentially distributed work, fed by a client, is the
M/M/c queue, whose behaviour has closed-form answers. The engine is checked against them in
`test/queueing.test.ts`. Service time is 1 ms throughout.

| Model | Quantity | Theory | Simulated (mean of 5 seeds) | Error per seed, % |
|---|---|---|---|---|
| M/M/1, 50% load | mean time in system (ms) | 2.0000 | 2.0048 | +0.47, +0.44, +0.37, +0.18, -0.25 |
| M/M/1, 50% load | p99 time in system (ms) | 9.2103 | 9.2544 | +0.76, +0.76, +0.76, +0.76, -0.63 |
| M/M/1, 80% load | mean time in system (ms) | 5.0000 | 5.0252 | +0.37, +0.99, +1.17, +0.21, -0.21 |
| M/M/1, 80% load | p99 time in system (ms) | 23.0259 | 23.4240 | +1.73, +3.95, +1.73, +0.62, +0.62 |
| M/M/1, 90% load | mean time in system (ms) | 10.0000 | 10.0639 | +0.74, +1.50, +1.18, -0.85, +0.62 |
| M/M/1, 90% load | utilization | 0.9000 | 0.9000 | -0.03, +0.06, +0.08, -0.07, -0.04 |
| M/M/4, 80% load | mean time in system (ms) | 1.7455 | 1.7508 | +0.14, +0.61, +0.77, +0.12, -0.14 |
| M/M/16, 90% load | mean time in system (ms) | 1.3696 | 1.3730 | +0.22, +0.58, +0.60, -0.33, +0.17 |
| M/M/1/5, 90% load | share of arrivals rejected | 0.1260 | 0.1263 | +0.16, -0.02, +0.04, +0.73, +0.18 |
| M/M/1/10, 150% load | share of arrivals rejected | 0.3372 | 0.3375 | -0.25, +0.01, +0.17, +0.60, -0.19 |
| M/D/1, 80% load | mean time in system (ms) | 3.0000 | 3.0076 | -0.19, +1.35, -0.26, +0.36, +0.01 |

Formulas: M/M/1 time in system is exponential with rate `μ - λ`; M/M/c uses Erlang C; M/M/1/K
rejects `(1-ρ)ρ^K / (1-ρ^(K+1))` of arrivals; M/D/1 uses the Pollaczek-Khinchine mean.

**On the size of the errors.** A queue's average converges slowly near saturation, because
successive waiting times are strongly correlated. The spread above is the expected sampling error,
not bias: over 48 seeds the mean error of the M/M/1 time in system is +0.02% (standard error 0.06%)
at 50% load and +0.2% (standard error 0.15%) at 80%. The test tolerances are about three standard
errors for each case's load and run length. The seeds share their sign across rows because the same
seed gives the same arrival pattern to every model.

Repeated p99 errors such as `+0.76` are the histogram's bucket width, not noise.

## 7. Behaviour that emerges

None of the following is programmed as a behaviour. Each falls out of the rules above, and each has
a test in `test/calls.test.ts` or `test/queueing.test.ts`.

- **The latency hockey stick.** M/M/1 time in system is 2 ms at 50% load, 5 ms at 80% and 10 ms at
  90%, for the same 1 ms of work.
- **Retries multiply load.** If every attempt times out and the client retries twice, the service
  receives three times the traffic and completes all of it for nobody.
- **A retry can tip a coping system into collapse.** Four slots and 30 ms of work give room for 133
  calls a second. At 100 a second (75% load) with a 60 ms timeout and no retries, about 28% of
  requests time out and the queue never passes 25. Allow one retry and the retried calls push the
  load past 100%: the queue grows past 4,000, every call waits longer than the timeout, and 99% of
  requests fail while the service runs at full utilization doing wasted work.
- **Slowness travels upstream.** A front service with spare slots, calling a back service at 80%
  load, holds each slot for the back service's whole time in system.

## 8. Performance

`npm run bench -w @loadline/engine`, Node 26.4 on an Intel Core i7-9700K, one thread:

| Scenario | Events | Wall time | Events per second | Speed vs real time |
|---|---|---|---|---|
| One service, 20k requests/s | 2,974,441 | 756 ms | 3.9 million | 40× |
| Three services in a chain, 10k requests/s | 3,862,128 | 961 ms | 4.0 million | 31× |
| Overloaded, with a retry storm, 5k requests/s | 2,868,494 | 666 ms | 4.3 million | 45× |

The budget in `SPEC.md` is one million events per second. A call through one node costs about five
events (arrive, service done, return, its timeout, and for a client the arrival itself). So 20k
requests a second through a five-hop design needs about 500k events a second, an eighth of what
one thread delivers here.
