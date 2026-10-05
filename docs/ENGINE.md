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
| refuse | A call that was never made (breaker open, connection cut) is reported as failed |
| pool timeout | A caller gives up waiting for a connection |
| timer | Node-specific: a client's next arrival, a health check, an autoscaler's look |
| phase | The workload's traffic multiplier changes |
| command | A scheduled fault is injected |
| restore | A timed fault ends |
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

Two more states belong to a call that is trying to make a downstream call: `pool`, waiting for a
free connection, and `refused`, when the call was not made at all and the refusal is on its way
back.

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

### 2.4 Requests have a kind and a key

Every request is a **read** or a **write**, and is about one item, its **key**. Calls made on its
behalf inherit both.

- An edge can carry all requests, only reads, or only writes. That is how a design says "writes
  also go to the payments service".
- Keys are drawn from a Zipf distribution: key `i` is chosen in proportion to `1 / i^skew`. A few
  items get most of the traffic, as in real systems, which is what makes caches work.

### 2.5 Calls that are not waited for

An edge marked **async** hands the call over and carries on. The caller does not wait, is not held
up, and never hears the result. Publishing to a queue is the usual case.

### 2.6 Connection pools

An edge can have a pool: each instance of the caller may have at most `poolSize` calls open over
it. A call that finds the pool empty waits in line, holding its slot, and the edge's timeout covers
the wait too. A connection is given back when the call it carried really ends, so a call that
timed out keeps its connection busy until the callee has finished with it.

Two things follow that are easy to get wrong in production:

- A pool that is too small starves the caller while the dependency sits idle.
- A call that is handed a connection late may have too little patience left to use it. It times
  out mid-query, and the dependency's work is wasted.

### 2.7 Circuit breakers

An edge can have a breaker. It watches the outcomes of the last `window` calls. When the share that
failed reaches `failureRate` it **opens**: calls are refused at once, without being made, for
`openMs`. Then it lets one call through as a probe. If the probe succeeds it closes; if not, it
opens again.

A refused call is not retried and costs the caller no time, so the caller's slots stay free for
requests that do not need the failing dependency.

## 3. Components

Each is one file in `src/nodes`. What they share is in `base.ts`: counters, the occupancy
integrals, and the faults that can be injected into any node.

### 3.1 Service

A pool of identical instances. Each works on up to `concurrency` calls at once and holds up to
`queue` more; beyond that it rejects. After its own work, a call goes through the outgoing edges in
order.

**Without a load balancer in front, every call lands on the first instance.** More instances then
change nothing, and the lint says so.

**Autoscaling** looks every five seconds at the slots that were busy over the period just ended,
and sizes the service so that they would be `target` of the total. New instances take `bootMs` to
arrive. So it always reacts to load that has already happened, and a service that is flat out
cannot show more busy slots than it has: under a large surge it under-orders and has to look again.

It is quick to add and slow to give back. The service keeps as many instances as the busiest look
of the last `cooldownMs` wanted, so a lull in the middle of a surge does not cost it the instances
it is about to need again, and what it no longer needs all goes at once when the cooldown has
passed. A lower `target` buys time during a climb, because the order goes in earlier; the price is
a larger fleet at the peak, which `max` caps.

### 3.2 Load balancer

Spreads calls over the instances of the service behind it: by round-robin, at random, to the least
loaded, or to the less loaded of two picked at random.

It only knows which instances are alive as of its last health check. An instance that dies keeps
being sent calls, which fail, until the next check notices.

A retry on the balancer's edge does not wait for the check: it goes to a different instance from
the one that has just failed the call, if there is another. So one retry is enough to hide a dead
instance from every caller, at the cost of one wasted trip for each call that found it.

Counting connections has a trap. A dead instance refuses at once and so never has any, which makes
it look like the least busy of all: until the check notices, it is sent more than its share.

### 3.3 Cache

Holds real keys, each until it expires (`ttlMs`) or is pushed out as the least recently used
(`capacity`). Whether a lookup hits is a fact about its contents at that moment.

An edge from a service to a cache is **read-through**:

- A read looks the item up. A hit skips the next edge, which is the store the cache stands in
  front of. A miss reads the store and then puts the item in the cache.
- A write removes the item from the cache, without waiting.
- A cache that fails counts as a miss: the store still has the answer.

With **single flight** on, calls that miss the same item while it is being fetched wait for that
one fetch instead of each making their own.

### 3.4 Database

A primary takes every write. Replicas, if there are any, share the reads in turn.

A server has no queue of its own: every query it accepts runs at once. Up to `concurrency` queries
run at full speed. Beyond that they share the same cores, so each takes proportionally longer, and
a little more for getting in each other's way: with twice as many queries as cores each takes 2.5
times as long instead of 2. The loss stops growing at five times as many queries as cores, where
the server does half the work it could.

The sharing is exact: the cores are divided among whatever is running at each moment, so a query
that starts alone and is then joined by forty others slows down from that moment, and speeds up
again as they finish. This is what makes a stampede an outage and not a blip. Each new query slows
every query already there, so the ones that would have emptied the server stay, and more arrive.

Simulating that directly would mean rescheduling every running query whenever one starts or ends.
Instead each server keeps one running total, the work a query has received since the server
started (`progress`), which advances at the speed every query is currently getting. A query that
needs `w` of work and starts when the total is `p` is finished when the total reaches `p + w`.
The queries sit in a heap ordered by that number (`src/kernel/tagHeap.ts`), and the server has one
timer, for the first of them. A query starting or finishing only moves the timer.

On **failover** the primary goes away. Writes are refused for `failoverMs`. Then a replica becomes
the primary, or if there is none, the old primary comes back.

### 3.5 Queue and worker

A queue stores a message and answers the publisher at once. A worker instance with a free slot asks
for the next message; nothing is pushed at it, so a worker is never overloaded. What grows instead
is the backlog, and the time a message waits is the queue's latency.

A worker processes a message as a service processes a call, dependencies included. If that fails,
the message goes back to the queue, until it has failed `maxDeliveries` times and is set aside.

### 3.6 Rate limiter

A token bucket: tokens drip in at `rate` per second up to `burst`, and each call spends one. A call
that finds no token is refused at once. What is behind the limiter only ever sees load it can
carry.

## 4. Faults, and changing a run

`Simulation.command` injects a fault: a traffic spike, a node or some of its instances down, a node
slowed, a share of calls failed outright, a cache emptied, a database failover, a connection cut or
delayed. Most take a duration. A workload can schedule them, and then they are part of the run: the
same faults at the same times give the same report.

When an instance goes down, every call it had is failed at once, and whatever those calls were
waiting for downstream carries on for nobody.

`Simulation.reconfigure` takes a design with the same nodes and edges and different settings, and
applies them from that moment. A new structure is a new run.

## 5. Determinism

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

## 6. Data layout

A run schedules millions of events a second, so the hot structures avoid allocating objects:

- `EventQueue` is a binary heap stored as parallel typed arrays (time, sequence, kind and three
  integer arguments). Events with long delays, such as timeouts, would otherwise survive into the
  garbage collector's old generation and cause pauses.
- `CallPool` stores every call in flight as parallel typed arrays indexed by slot, with a free
  list. It grows by doubling up to a limit (two million calls by default). Reaching the limit stops
  the run with `SimulationLimitError`: the design lets work pile up without bound.

## 7. Measurement

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
- **Cost.** Each node has a price in made-up dollars a month (`src/cost.ts`), integrated over the
  run, so an autoscaled service costs what was actually running.
- **The scored period.** A run can be given a time from which it is scored (`scoreFromMs`). What
  clients saw before it is warm-up: it is in the report and the samples, and not in `score()`. A
  request belongs to the period it finished in. Levels are judged on this.
- **Conservation.** Every request ends in exactly one outcome. At any moment,
  `created = ok + failed + in flight`, and for every node `arrivals = ok + failed + in a slot +
  queued`. For every edge, `calls = ok + failed + abandoned`, where abandoned are the calls whose
  caller's instance went away first.

### 7.1 Following the time to the bottleneck

Every edge records how long its callers spent on calls over it, and how much of that was waiting
for a connection. `findBottleneck` (`src/metrics/bottleneck.ts`) starts at a client and asks what
the node spent its busy time on. If most of it went on waiting for one dependency, it moves there
and asks again. Where it stops is where the time is really going, however far upstream the symptoms
showed, and it says what is short there: slots (`saturated`), cores (`contended`), connections
(`pool`), instances (`down`), or nothing (`work`: it is simply slow).

Waiting for a connection needs a second look, because a pool is where waiting is supposed to happen.
If the node behind the pool is flat out, the pool is doing its job and that node is what is short
(`saturated`): more connections would only make it slower. Only when the node behind has room is
the pool itself too small (`pool`).

### 7.2 Random systems, random faults

`test/soak.test.ts` builds random systems out of every kind of part, with random policies on every
edge, and throws random faults at them. Whatever happens, once traffic has stopped and everything
has finished, the books must balance: every request ended once, every node's and edge's counts add
up, no call is still in flight, every pooled connection has been given back, every message is
accounted for, and running it again gives the same report.

It runs 150 systems in the normal suite and has been run on 3,000. It found one gap in the
accounting, which is the `abandoned` count above.

## 8. Validation against queueing theory

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

These numbers were measured when the engine had only clients and services. The checks still run on
every change, and the rewrite that added the other components reproduced the reference run of that
time exactly.

## 9. Behaviour that emerges

None of the following is programmed as a behaviour. Each falls out of the rules above, and each has
a test.

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
- **A balancer that knows more waits less.** Eight single-slot instances at 90% load. Sending at
  random gives eight separate queues and about ten times the work in waiting. Taking turns,
  comparing two instances, and comparing all of them each do markedly better than the one before.
- **A dead instance costs until it is noticed.** With three instances and a check every five
  seconds, a third of the calls fail from the moment one dies until the next check.
- **Counting connections makes it worse.** The dead instance has none, so it looks the least busy
  and is sent well over half of the calls instead of a third.
- **One retry hides it.** With a single retry on the balancer's edge, no request fails at all: each
  call that finds the dead instance is made again, to another.
- **A cache starts cold.** The store carries the whole load until the cache has filled.
- **A stampede.** Empty a warm cache and the store's load goes from about 10 calls a second to
  over 900 in the next second, far more than it can run at once. The queries share its cores
  hundreds of ways, and p99 goes from 2 ms to several seconds. It passes in about fifteen seconds,
  because the popular items are fetched first and are then answered by the cache again.
- **A stampede that does not pass.** With a few very popular items and a slow store, the cache
  never gets to fill: every request misses and adds one more query to cores already shared
  thousands of ways, almost nothing finishes, and nearly half of all requests fail.
- **Sharing a fetch prevents it.** In the same system with single flight, each of the 200 items is
  read once, one second is slow, and nothing fails.
- **Items stored together expire together.** With a fixed lifetime the stampede repeats by itself;
  randomising lifetimes spreads it out.
- **The right pool size is the database's, not the caller's.** A database with four cores is asked
  for 340 queries a second of 10 ms each. With a pool of four: no errors, p50 of 14 ms. With a pool
  of two: 40% of requests are turned away while the database is half idle. With no pool: a burst
  puts a few queries too many on the cores, each then takes longer, more pile up, and it never
  recovers. 40% are turned away again, with the database flat out doing half the work.
- **A queue absorbs a burst and pays it back.** Five times the traffic for ten seconds: 3,000
  messages pile up at 300 a second, then clear at 100 a second over the next thirty. Callers notice
  nothing. Without the queue, the same burst is thousands of rejections.
- **Shedding load beats drowning in it.** 400 a second into a service that can do 250. Behind a
  limiter at 200, the service is at 80% and answers in tens of milliseconds. Without it, the queue
  is always full and every answer takes most of a second.
- **A breaker contains a slow dependency.** Writes call a payments service that turns slow. Without
  a breaker, the writes hold every slot of the caller, and reads queue behind them. With one, only
  the writes fail, a fifth of the traffic, and payments gets under a twentieth of the calls while it
  struggles.
- **A breaker can also spread a failure.** In the reference system one breaker guards both reads
  and writes to the database. During a failover only writes fail, but they open the breaker, which
  then refuses the reads the replica could have served.
- **Autoscaling arrives late.** With instances that take 30 s to start, a sixfold surge is 35
  seconds of errors before the first new instance is ready. With 2 s it is a quarter of that.
- **And leaves late, on purpose.** When the surge ends the instances stay for a cooldown and then
  all go. A second surge twenty seconds after the first finds them still there.

## 10. Performance

`npm run bench -w @loadline/engine`, Node 26.4 on an Intel Core i7-9700K, one thread:

| Scenario | Events | Wall time | Events per second | Speed vs real time |
|---|---|---|---|---|
| One service, 20k requests/s | 2,974,441 | 1,052 ms | 2.8 million | 28× |
| Three services in a chain, 10k requests/s | 3,862,128 | 1,341 ms | 2.9 million | 22× |
| Overloaded, with a retry storm, 5k requests/s | 2,868,494 | 933 ms | 3.1 million | 32× |

The budget in `SPEC.md` is one million events per second. A call through one node costs about five
events (arrive, service done, return, its timeout, and for a client the arrival itself). So 20k
requests a second through a five-hop design needs about 500k events a second, a sixth of what one
thread delivers here.

With only clients and services the engine did about 4 million events a second. Pools, breakers,
routing and the bookkeeping for the bottleneck finder cost about a quarter of that.
