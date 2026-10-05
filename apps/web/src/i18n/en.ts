// Every word the interface shows comes from a catalog like this one. A message that takes values
// is a function, so each language can order and inflect it as it needs.
//
// Technical proper nouns and units stay English in every language: p50, p99, ms, req/s.

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
    clock: 'Simulated time',
    behind: (speed: string) => `Running at ${speed}×. The simulation cannot keep up with the speed you chose.`,
    blocked: 'Fix the problems in the design to run it.',
    failed: 'The run stopped',
  },
  parts: {
    title: 'Parts',
    hint: 'Drag a part onto the canvas, or press it to add one.',
    client: { name: 'Client', hint: 'Sends requests at a steady rate' },
    service: { name: 'Service', hint: 'Does work, and calls the parts it points to' },
  },
  canvas: {
    label: 'System design',
    connectHint: 'Drag from the dot on a part to another part to connect them.',
  },
  node: {
    perSecond: (rate: string) => `${rate}/s`,
    tail: (duration: string) => `p99 ${duration}`,
    waiting: (count: string) => `${count} waiting`,
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
    client: {
      rps: 'Requests per second',
      rpsHint: 'Before the traffic control above is applied.',
    },
    service: {
      concurrency: 'Requests handled at once',
      queue: 'Waiting room',
      queueHint: 'Requests that can wait for a free slot. Beyond this they are rejected.',
      work: 'Work per request',
      variation: 'How much the work varies',
      variationOption: { const: 'Not at all', exp: 'A lot (exponential)', lognormal: 'Custom (log-normal)' },
      cv: 'Spread (standard deviation ÷ mean)',
      room: (rate: string) => `Room for about ${rate} requests a second, before any time spent waiting on other parts.`,
    },
    edge: {
      title: (from: string, to: string) => `${from} to ${to}`,
      latency: 'Network delay, each way',
      timeout: 'Give up after',
      timeoutHint: '0 waits forever.',
      retries: 'Retries',
      backoff: 'Wait before the first retry',
      backoffFactor: 'Each further wait is longer by',
      jitter: 'Randomise the wait',
      jitterHint: '0 retries on the dot. 1 picks any moment up to the full wait.',
    },
    problems: 'Problems',
    notes: 'Worth knowing',
  },
  // Keyed by the engine's issue codes. An issue without an entry here shows the engine's own text.
  issues: {
    'client-unconnected': (name: string) => `${name} is not connected to anything, so it sends no traffic.`,
    'no-client': () => 'There is no client, so nothing sends traffic.',
    unreachable: (name: string) => `Nothing calls ${name}.`,
  },
  metrics: {
    title: 'What clients see',
    requests: 'Requests',
    succeeded: 'Succeeded',
    errors: 'Failed',
    inFlight: 'In flight',
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
  units: {
    ms: 'ms',
    s: 's',
  },
};

export type Messages = typeof en;
