// Screener "last run" relative-time formatter (feature 098).
//
// Pure and tick-free by design (R3): the screener passes `now = Date.now()` at render, so the label
// freshens on any interaction without a `setInterval`. A perfectly idle post-scan page keeping a
// slightly stale "2m ago" is an accepted, cosmetic tradeoff (How-to-Act #2 — no speculative timer).

/** Relative-time label for the last screener scan, e.g. `"last run 2m ago"` / `"last run just now"`. */
export function formatLastRun(then: Date, now: number): string {
  const deltaMs = Math.max(0, now - then.getTime());
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'last run just now';
  if (minutes < 60) return `last run ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `last run ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `last run ${days}d ago`;
}
