export function exportEnabled(cfg: { getInt(key: string, def: number): number }): number {
  return cfg.getInt('export.enabled', 1);
}
