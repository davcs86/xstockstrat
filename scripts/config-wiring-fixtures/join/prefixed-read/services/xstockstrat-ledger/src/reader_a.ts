export function windowDays(cfg: { getInt(key: string, def: number): number }): number {
  return cfg.getInt('export.max_window_days', 30);
}
