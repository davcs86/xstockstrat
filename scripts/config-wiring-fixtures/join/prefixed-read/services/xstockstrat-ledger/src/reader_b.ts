export function prefixedReads(cfg: { getInt(key: string, def: number): number }): number[] {
  return [
    cfg.getInt('ledger.export.max_window_days', 30),
    cfg.getInt('ledger.export.prod_only', 1),
    cfg.getInt('ledger.export.secret_token', 0),
    cfg.getInt('ledger.export.tmpl.alpha', 5),
  ];
}
