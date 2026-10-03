// Config namespaces selectable in /config-ui. Lives in src/lib (not app/) because the shared shell
// nav (navGroups.tsx) also derives the Settings › Config highlight from it.
export const KNOWN_NAMESPACES = [
  'platform',
  'trading',
  'portfolio',
  'marketdata',
  'indicators',
  'ingest',
  'analysis',
  'ledger',
  'identity',
  'notify',
];

/** Every config-ui link that keeps the env + per-user scope query is built here. */
export function configUiHref(basePath: string, env: string, user: string): string {
  const params = new URLSearchParams({ env });
  if (user) params.set('user', user);
  return `${basePath}?${params.toString()}`;
}
