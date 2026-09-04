// Pure client-side order-ticket helpers (risk/reward + a suggested share count). PRESENTATION ONLY —
// the numbers are never sent to execution.

/** Fraction of buying power to risk on a single trade when suggesting a size (a conventional 1%). */
const DEFAULT_RISK_FRACTION = 0.01;

export interface RiskReward {
  rewardPerShare: number;
  riskPerShare: number;
  ratio: number;
  /** Display form, e.g. `"2.0:1"`. */
  ratioLabel: string;
}

/**
 * Reward-to-risk for a long entry: reward = target − entry, risk = entry − stop. Returns `null`
 * when any input is missing/non-positive or the geometry is invalid (stop ≥ entry, target ≤ entry),
 * so the caller renders nothing rather than a misleading ratio.
 */
export function riskReward(
  entry: number | undefined,
  stop: number | undefined,
  target: number | undefined,
): RiskReward | null {
  if (!(Number(entry) > 0) || !(Number(stop) > 0) || !(Number(target) > 0)) return null;
  const rewardPerShare = Number(target) - Number(entry);
  const riskPerShare = Number(entry) - Number(stop);
  if (riskPerShare <= 0 || rewardPerShare <= 0) return null;
  const ratio = rewardPerShare / riskPerShare;
  return { rewardPerShare, riskPerShare, ratio, ratioLabel: `${ratio.toFixed(1)}:1` };
}

/**
 * A suggested share count: the smaller of a risk-based size (riskFraction of buying power ÷ the
 * per-share stop distance) and what buying power can actually afford at the entry price. Returns 0
 * when any input is missing/non-positive or the stop distance is zero (never a negative size).
 */
export function suggestedShares(
  buyingPower: number | undefined,
  entry: number | undefined,
  stop: number | undefined,
  riskFraction: number = DEFAULT_RISK_FRACTION,
): number {
  const bp = Number(buyingPower);
  const e = Number(entry);
  const s = Number(stop);
  if (!(bp > 0) || !(e > 0) || !(s > 0)) return 0;
  const perShareRisk = Math.abs(e - s);
  if (perShareRisk <= 0) return 0;
  const byRisk = Math.floor((bp * riskFraction) / perShareRisk);
  const affordable = Math.floor(bp / e);
  return Math.max(0, Math.min(byRisk, affordable));
}
