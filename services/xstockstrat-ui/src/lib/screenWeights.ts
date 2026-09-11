// Screener criterion weight display helpers. The wire weights (`ScreenCriterion.weight`) are RAW —
// the analysis scorer normalizes them server-side; this helper is DISPLAY-ONLY.

/**
 * Normalized display shares for a set of criterion weights, summing to 1.0.
 *
 * Guards the degenerate inputs the weight control makes reachable:
 * - empty input → `[]` (no rows, no shares).
 * - all-zero (or any non-positive sum) → equal shares `1/n` each, never `NaN`/`Infinity`
 *   (the `<input type="range" min=0>` lets the trader zero every criterion).
 */
export function normalizeWeights(weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (sum <= 0) {
    const equal = 1 / weights.length;
    return weights.map(() => equal);
  }
  return weights.map((w) => w / sum);
}
