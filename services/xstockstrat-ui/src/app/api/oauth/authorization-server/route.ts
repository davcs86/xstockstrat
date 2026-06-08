import { NextResponse } from 'next/server';

// AGENT_PUBLIC_URL is read at request time — never bake it in at build time (it's a runtime env).
export const dynamic = 'force-dynamic';

// Canonical RFC 8414 OAuth 2.0 Authorization Server Metadata for the MCP agent.
//
// The agent is the authorization server, but it is mounted under the `/agent` path prefix of this
// same origin (DO ingress: `/agent` → xstockstrat-agent). Its issuer therefore has a path
// (`https://<host>/agent`). Per RFC 8414 §3.1, a spec-compliant client (e.g. Claude.ai) fetches
// the metadata with the well-known segment inserted BEFORE the path:
//   https://<host>/.well-known/oauth-authorization-server/agent
// That URL lands on this UI (the `/` catch-all), not the agent, so the UI must serve it. A
// next.config rewrite maps that canonical path to this handler. Keep this in sync with the agent's
// app/oauth_metadata.py (feature 049 Part B).
export async function GET() {
  const agent = process.env.AGENT_PUBLIC_URL ?? '';
  return NextResponse.json({
    issuer: agent,
    authorization_endpoint: `${agent}/oauth/authorize`,
    token_endpoint: `${agent}/oauth/token`,
    registration_endpoint: `${agent}/oauth/register`,
    code_challenge_methods_supported: ['S256'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
  });
}
