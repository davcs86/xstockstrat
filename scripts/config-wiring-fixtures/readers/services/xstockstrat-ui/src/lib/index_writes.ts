type Values = Record<string, unknown>;

export function writes(values: Values, obj: { values: Values }, row: { key: string }, k: string, x: unknown, y: unknown, z: unknown): unknown {
  values[k] = x;
  obj.values[row.key] = y;
  values['performance.window_days'] = z;
  values[k] ??= x;
  if (values['analysis.breakout.enabled'] == y) return null;
  const v = values['performance.risk_free_rate_annual'];
  return v;
}
