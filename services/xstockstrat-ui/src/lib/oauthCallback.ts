/**
 * The only post-authorize redirect target the OAuth login page may follow: the agent's own callback,
 * derived server-side from the runtime AGENT_PUBLIC_URL. Returns null (never follow) when the
 * agent URL is unset or the client-supplied `agent_cb` differs in any way.
 */
export function resolveAgentCallback(
  agentCb: string | null,
  agentPublicUrl: string | undefined,
): string | null {
  const base = (agentPublicUrl ?? '').replace(/\/+$/, '');
  if (!base || !/^https?:\/\//i.test(base)) return null;
  const expected = `${base}/oauth/callback`;
  return agentCb === expected ? expected : null;
}
