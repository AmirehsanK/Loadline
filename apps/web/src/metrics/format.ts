// Numbers in the interface keep Latin digits and English units in every language, so these
// formatters do not take a locale.

const trim = (value: number, digits: number) => String(Number(value.toFixed(digits)));

/** A duration: "0.8 ms", "24 ms", "1.24 s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '–';
  if (ms < 10) return `${trim(ms, 1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${trim(ms / 1000, 2)} s`;
  return `${trim(ms / 1000, 1)} s`;
}

/** A count or a rate, shortened once it passes ten thousand: "812", "1,284", "12.9k", "4.2M". */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '–';
  const size = Math.abs(value);
  if (size < 10) return trim(value, 1);
  if (size < 10_000) return Math.round(value).toLocaleString('en-US');
  if (size < 1_000_000) return `${trim(value / 1000, 1)}k`;
  return `${trim(value / 1_000_000, 1)}M`;
}

/** A share of a whole: "0%", "0.4%", "12%". */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '–';
  const percent = fraction * 100;
  if (percent === 0) return '0%';
  if (percent < 0.1) return '<0.1%';
  if (percent < 10) return `${trim(percent, 1)}%`;
  return `${Math.round(percent)}%`;
}

/** Elapsed time: "0:42", "12:05", "1:02:03". */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}
