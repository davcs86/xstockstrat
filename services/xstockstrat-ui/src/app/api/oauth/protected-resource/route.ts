import { NextResponse } from 'next/server';
import { MCP_SCOPES_SUPPORTED } from '@/lib/mcpScopes';
import { loadAgentIssuer, loadAuthMode } from '@/lib/oidcConfig';

// AGENT_PUBLIC_URL is read at request time — never bake it in at build time (it's a runtime env).
export const dynamic = 'force-dynamic';

// RFC 9728 Protected Resource Metadata: the well-known path-insertion form hits this UI's `/`
// catch-all (next.config rewrite) — keep in sync with the agent's app/oauth_metadata.py.
// An unreadable mode keeps today's document (D-133); in oidc a bad agent issuer is retryable (D-136).
export async function GET() {
  const agent = process.env.AGENT_PUBLIC_URL ?? '';
  if ((await loadAuthMode()) === 'oidc') {
    const agentIssuer = await loadAgentIssuer();
    if (agentIssuer === 'error' || !agentIssuer.valid) {
      return new NextResponse(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({
      resource: agent,
      authorization_servers: [agentIssuer.issuer],
      scopes_supported: [...MCP_SCOPES_SUPPORTED],
    });
  }
  return NextResponse.json({
    resource: agent,
    authorization_servers: [agent],
  });
}
