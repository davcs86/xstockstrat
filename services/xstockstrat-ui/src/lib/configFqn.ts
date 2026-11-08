// Display-only config key FQN: the stored key is namespace-relative (feature 296); tolerant of the
// prefixed spelling so an old audit row or an un-migrated database renders once, never as ns.ns.key.
export function configFqn(namespace: string, key: string): string {
  return key.startsWith(`${namespace}.`) ? key : `${namespace}.${key}`;
}
