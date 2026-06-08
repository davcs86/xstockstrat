import { NextResponse } from 'next/server';

// AGENT_PUBLIC_URL is read at request time — never bake it in at build time (it's a runtime env).
export const dynamic = 'force-dynamic';

// Canonical RFC 9728 OAuth 2.0 Protected Resource Metadata for the MCP agent.
//
// Claude.ai already learns the protected-resource metadata URL from the agent's WWW-Authenticate
// header (the path-appended `…/agent/.well-known/oauth-protected-resource`, which the agent serves
// directly). This handler additionally covers the RFC 9728 path-insertion form
//   https://<host>/.well-known/oauth-protected-resource/agent
// (mapped here by a next.config rewrite) so issuer-based discovery is robust regardless of which
// form the client constructs. Keep in sync with the agent's app/oauth_metadata.py (feature 049).
export async function GET() {
  const agent = process.env.AGENT_PUBLIC_URL ?? '';
  return NextResponse.json({
    resource: agent,
    authorization_servers: [agent],
  });
}
