// Every word the interface shows comes from a catalog like this one. A message that takes values
// is a function, so each language can order and inflect it as it needs.
//
// Technical proper nouns and units stay English in every language: p50, p99, ms, req/s.

/** The words for one setting: its label, an optional line of help, and the names of its choices. */
export interface FieldText {
  label: string;
  hint?: string;
  options?: Record<string, string>;
}

const work = (label: string): FieldText => ({ label });

export const en = {
  app: {
    name: 'Loadline',
    skipToCanvas: 'Skip to the canvas',
  },
  run: {
    controls: 'Run controls',
    play: 'Run',
    pause: 'Pause',
    restart: 'Restart',
    speed: 'Speed',
    speedOption: (factor: number) => `${factor}×`,
    traffic: 'Traffic',
    trafficValue: (factor: string, rate: string) => `${factor}× · ${rate} req/s`,
    spike: 'Spike ×3 for 10 s',
    clock: 'Simulated time',
    behind: (speed: string) => `Running at ${speed}×. The simulation cannot keep up with the speed you chose.`,
    blocked: 'Fix the problems in the design to run it.',
    failed: 'The run stopped',
  },
  parts: {
    title: 'Parts',
    hint: 'Drag a part onto the canvas, or press it to add one.',
    types: {
      client: { name: 'Client', hint: 'Sends requests at a steady rate' },
      'load-balancer': { name: 'Load balancer', hint: 'Spreads calls over the instances of a service' },
      'rate-limiter': { name: 'Rate limiter', hint: 'Refuses calls beyond a set rate' },
      service: { name: 'Service', hint: 'Does work, and calls the parts it points to' },
      cache: { name: 'Cache', hint: 'Answers repeat reads so the store does not have to' },
      database: { name: 'Database', hint: 'Stores data; every query runs on its cores' },
      queue: { name: 'Queue', hint: 'Holds work until a worker is free' },
      worker: { name: 'Worker', hint: 'Takes work from a queue at its own pace' },
    },
  },
  canvas: {
    label: 'System design',
  },
  node: {
    perSecond: (rate: string) => `${rate}/s`,
    tail: (duration: string) => `p99 ${duration}`,
    waiting: (count: string) => `${count} waiting`,
    over: (count: string) => `${count} too many at once`,
    backlog: (count: string) => `${count} waiting`,
    oldest: (duration: string) => `wait ${duration}`,
    hits: (percent: string) => `${percent} hits`,
    failing: (rate: string) => `${rate}/s failing`,
    instances: (count: number) => `×${count}`,
    down: 'down',
    load: (percent: string) => `${percent} of its slots busy`,
    loadLine: 'Load line: above 80% busy, waiting time grows quickly',
    idle: 'No traffic yet',
  },
  edge: {
    failing: (percent: string) => `${percent} failing`,
  },
  inspector: {
    title: 'Settings',
    nothing: 'Select a part or a connection to change its settings.',
    name: 'Name',
    remove: 'Remove',
    connection: (from: string, to: string) => `${from} to ${to}`,
    room: (rate: string) => `Room for about ${rate} requests a second, before any time spent waiting on other parts.`,
    cost: (dollars: string) => `Costs $${dollars} a month as it stands.`,
    problems: 'Problems',
    notes: 'Worth knowing',
    faults: {
      title: 'Break it',
      hint: 'Each lasts ten seconds of simulated time.',
      kill: 'Take it down',
      killOne: 'Kill one instance',
      slow: 'Make it 5× slower',
      errors: 'Fail 30% of calls',
      flush: 'Empty it',
      failover: 'Fail the primary',
      sever: 'Cut the connection',
      delay: 'Add 100 ms each way',
    },
  },
  fields: {
    work: {
      variation: 'How much it varies',
      options: { const: 'Not at all', exp: 'A lot (exponential)', lognormal: 'Custom (log-normal)' },
      cv: 'Spread (standard deviation ÷ mean)',
    },
    node: {
      client: {
        rps: { label: 'Requests per second', hint: 'Before the traffic control above is applied.' },
        readRatio: { label: 'Share that only read', hint: '0 is all writes, 1 is all reads.' },
        keys: { label: 'Different items asked about' },
        skew: { label: 'How uneven the demand is', hint: '0 spreads requests evenly. 1 is typical: a few items get most of them.' },
      },
      service: {
        instances: { label: 'Instances', hint: 'More than one needs a load balancer in front.' },
        concurrency: { label: 'Requests handled at once, per instance' },
        serviceTime: work('Work per request'),
        queue: { label: 'Waiting room, per instance', hint: 'Requests that can wait for a free slot. Beyond this they are rejected.' },
        'autoscale.enabled': { label: 'Add and remove instances by itself' },
        'autoscale.min': { label: 'Fewest instances' },
        'autoscale.max': { label: 'Most instances' },
        'autoscale.target': { label: 'Share of slots to keep busy', hint: 'It adds instances above this and removes them well below it.' },
        'autoscale.bootMs': { label: 'Time to start an instance' },
        'autoscale.cooldownMs': { label: 'Wait before removing one' },
      },
      worker: {
        instances: { label: 'Instances' },
        concurrency: { label: 'Messages handled at once, per instance' },
        serviceTime: work('Work per message'),
        failureRate: { label: 'Share that fail by themselves', hint: 'A failed message goes back to the queue.' },
        maxDeliveries: { label: 'Tries before giving up on a message' },
      },
      'load-balancer': {
        algorithm: {
          label: 'How it picks an instance',
          options: {
            'round-robin': 'Each in turn',
            random: 'At random',
            'least-connections': 'The least busy',
            'two-choices': 'The less busy of two picked at random',
          },
        },
        healthCheckMs: { label: 'Check for dead instances every', hint: 'A dead instance keeps getting calls until the next check.' },
      },
      cache: {
        capacity: { label: 'Items it can hold', hint: 'The least recently used is dropped to make room.' },
        ttlMs: { label: 'Keep each item for', hint: '0 keeps it until it is dropped for room.' },
        ttlJitter: { label: 'Randomise lifetimes', hint: '0 to 1. Stops items stored together from expiring together.' },
        singleFlight: { label: 'Fetch a missing item once, for everyone waiting on it' },
      },
      database: {
        concurrency: { label: 'Queries at full speed at once', hint: 'More than this share the same cores, and all slow down.' },
        maxConnections: { label: 'Connections it accepts' },
        readTime: work('Work per read'),
        writeTime: work('Work per write'),
        replicas: { label: 'Read replicas', hint: 'Reads are spread over them. Writes always go to the primary.' },
        failoverMs: { label: 'Time to recover from a failed primary' },
      },
      queue: {
        maxDepth: { label: 'Messages it can hold' },
        overflow: { label: 'When it is full', options: { reject: 'Refuse new messages', 'drop-oldest': 'Discard the oldest' } },
      },
      'rate-limiter': {
        rate: { label: 'Calls let through per second' },
        burst: { label: 'Calls let through at once after a quiet spell' },
      },
    },
    edge: {
      appliesTo: { label: 'Used by', options: { all: 'Every request', read: 'Reads only', write: 'Writes only' } },
      mode: { label: 'The caller', options: { sync: 'Waits for the answer', async: 'Hands it over and moves on' } },
      timeoutMs: { label: 'Give up after', hint: '0 waits forever.' },
      retries: { label: 'Retries' },
      backoffMs: { label: 'Wait before the first retry' },
      backoffFactor: { label: 'Each further wait is longer by' },
      jitter: { label: 'Randomise the wait', hint: '0 retries on the dot. 1 picks any moment up to the full wait.' },
      poolSize: { label: 'Connections per instance', hint: '0 is no limit. Calls beyond this wait for a free one.' },
      'breaker.enabled': { label: 'Stop calling when it keeps failing' },
      'breaker.failureRate': { label: 'Share of recent calls that must fail' },
      'breaker.window': { label: 'How many recent calls to judge by' },
      'breaker.openMs': { label: 'Stop for' },
      latencyMs: { label: 'Network delay, each way' },
    },
  },
  // Keyed by the engine's issue codes. An issue without an entry here shows the engine's own text.
  issues: {
    'client-unconnected': (name: string) => `${name} is not connected to anything, so it sends no traffic.`,
    'no-client': () => 'There is no client, so nothing sends traffic.',
    unreachable: (name: string) => `Nothing calls ${name}.`,
    'pass-through-unconnected': (name: string) => `${name} has nothing behind it, so every call to it fails.`,
    'balancer-target': (name: string) => `${name} only spreads load over the instances of a service.`,
    'needs-balancer': (name: string) => `${name} has more than one instance, but calls reach it directly, so they all land on the first. Put a load balancer in front.`,
    'cache-fronts-nothing': (name: string) => `${name} checks a cache but has no store to read after it.`,
    'queue-unread': (name: string) => `Nothing takes messages from ${name}, so it only fills up.`,
  },
  metrics: {
    title: 'What clients see',
    requests: 'Requests',
    succeeded: 'Succeeded',
    errors: 'Failed',
    inFlight: 'In flight',
    cost: 'Cost',
    costNote: 'a month',
    dollars: (amount: string) => `$${amount}`,
    median: 'half are faster',
    tail: '1 in 100 is slower',
    latencyTitle: 'Response time',
    series: { p50: 'p50', p99: 'p99' },
    perSecond: 'per second',
    lastSecond: 'last second',
    showChart: 'Chart',
    showTable: 'Table',
    view: 'Show response time as',
    time: 'Time',
    empty: 'Press Run to send traffic through the design.',
    chartLabel: 'Response time over simulated time. Use the left and right arrow keys to read values.',
  },
  why: {
    title: 'Where the time goes',
    quiet: 'Nothing is flowing yet.',
    // What the part the time is going on is short of.
    saturated: (name: string) => `${name} is full. Every slot is busy and calls are waiting for one.`,
    contended: (name: string) => `${name} is running more queries than it has cores for, so every one of them is slow.`,
    pool: (name: string, target: string) => `${name} is waiting for a free connection to ${target}. The pool is too small.`,
    down: (name: string) => `${name} is down.`,
    work: (name: string) => `Most of the time is ${name}'s own work. It has room to spare.`,
    via: (names: string[]) => `Reached through ${names.join(', then ')}.`,
    failuresTitle: 'Why requests failed',
    none: 'No request has failed.',
    // One line per group of failures: how many, and what happened to them.
    timeout: {
      queued: (name: string) => `timed out waiting in line at ${name}`,
      'in-service': (name: string) => `timed out while ${name} was working on them`,
      pool: (name: string) => `timed out while ${name} waited for a connection`,
      traveling: (name: string) => `timed out on the way to ${name}`,
      returning: (name: string) => `timed out as ${name}'s answer was on its way back`,
      backoff: (name: string) => `timed out while ${name} waited to retry`,
      waiting: (name: string) => `timed out while ${name} waited on another part`,
      refused: (name: string) => `timed out at ${name}`,
      free: (name: string) => `timed out at ${name}`,
    },
    'queue-full': (name: string) => `turned away by ${name}, which was full`,
    'rate-limited': (name: string) => `refused by ${name}, over its rate`,
    'node-down': (name: string) => `failed because ${name} was down`,
    'circuit-open': (name: string) => `not sent to ${name}, to give it a rest`,
    'injected-error': (name: string) => `failed by ${name}`,
    'network-drop': (name: string) => `could not reach ${name}`,
  },
  units: {
    ms: 'ms',
    times: '×',
  },
};

export type Messages = typeof en;
