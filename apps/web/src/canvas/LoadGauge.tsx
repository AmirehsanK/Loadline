/** The share of a part's slots that may be busy before waiting time takes off. */
export const LOAD_LINE = 0.8;

/**
 * How deep a part sits in the water: its busy slots, as a level in a gauge with the load line
 * painted across it. The level is sea blue up to the line and hull red above it.
 */
export function LoadGauge({ level, label, lineLabel }: { level: number; label: string; lineLabel: string }) {
  const clamped = Math.max(0, Math.min(1, level));
  const below = Math.min(clamped, LOAD_LINE);
  const above = clamped - below;
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      aria-label={label}
      title={lineLabel}
      className="relative h-full w-3 shrink-0 overflow-hidden bg-sea-wash"
    >
      <div className="gauge-level absolute inset-x-0 bottom-0 bg-sea" style={{ height: `${below * 100}%` }} />
      <div
        className="gauge-level absolute inset-x-0 bg-oxide"
        style={{ bottom: `${LOAD_LINE * 100}%`, height: `${above * 100}%` }}
      />
      <div className="absolute inset-x-0 h-px bg-ink" style={{ bottom: `${LOAD_LINE * 100}%` }} />
    </div>
  );
}
