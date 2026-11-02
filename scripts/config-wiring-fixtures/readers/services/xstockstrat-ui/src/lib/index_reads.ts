type Values = Record<string, { value?: string } | undefined>;

export function riskFreeRate(values: Values): string | undefined {
  return values['performance.risk_free_rate_annual']?.value;
}

export function windowDays(cfg: { getInt(key: string, def: number): number }): number {
  return cfg.getInt('performance.window_days', 30);
}

export class SnapshotReader {
  private snapshot: { values: Values } | null = null;

  getString(key: string, def = ''): string {
    const v = this.snapshot?.values[key];
    return v?.value ?? def;
  }

  async secret(client: { getSecret(key: string): Promise<string> }): Promise<string> {
    return client.getSecret('ui.vendor.api_key');
  }
}
