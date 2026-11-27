// A call-builder fixture (a stub ConfigWatcher), not domain data, so no INVENTORY.md row.
export function fakeConfig(
  overrides: { ints?: Record<string, number>; strings?: Record<string, string> } = {},
) {
  const ints = overrides.ints ?? {};
  const strings = overrides.strings ?? {};
  return {
    getInt: (key: string, def: number) => (key in ints ? ints[key] : def),
    getString: (key: string, def = '') => (key in strings ? strings[key] : def),
  } as any;
}
