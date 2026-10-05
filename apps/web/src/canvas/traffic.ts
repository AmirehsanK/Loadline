// How the calls on a connection are drawn as a stream of dots.

/** How fast the dots travel, in pixels a second. It is the same on every connection. */
export const DOT_SPEED = 90;
/** The distance from one dot to the next: far apart for a trickle, close for a flood. */
const SPARSE = 44;
const DENSE = 7;

/** How far apart the dots are for a number of calls a second. Ten times the calls is 11 px closer. */
export function dotSpacing(calls: number): number {
  return Math.max(DENSE, Math.round(SPARSE - 11 * Math.log10(1 + calls)));
}

/** Which dots are failures: every `n`-th one, for the share of calls that failed. None is Infinity. */
export function failureEvery(failing: number): number {
  return failing <= 0 ? Infinity : Math.max(1, Math.round(1 / failing));
}
