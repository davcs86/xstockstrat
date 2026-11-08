type Values = Record<string, { value?: string } | undefined>;

export function riskFreeRate(values: Values): string | undefined {
  return values['performance.risk_free_rate_annual']?.value;
}
