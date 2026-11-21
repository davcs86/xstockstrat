export type Cfg = { int?: Record<string, number>; float?: Record<string, number>; str?: Record<string, string> };

export function fakeConfig(cfg: Cfg = {}): any {
  return {
    getInt: (k: string, d: number) => cfg.int?.[k] ?? d,
    getFloat: (k: string, d: number) => cfg.float?.[k] ?? d,
    getString: (k: string, d = '') => cfg.str?.[k] ?? d,
  };
}
