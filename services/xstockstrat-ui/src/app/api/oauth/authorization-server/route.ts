import { NextResponse } from 'next/server';
import { loadAuthMode } from '@/lib/oidcConfig';

// AGENT_PUBLIC_URL is read at request time — never bake it in at build time (it's a runtime env).
export const dynamic = 'force-dynamic';

// RFC 8414 Authorization Server Metadata: the well-known path-insertion form hits this UI's `/`
// catch-all (next.config rewrite), not the agent — keep in sync with the agent's app/oauth_metadata.py.
// In oidc the issuer is the authorization server, so this document must not exist.
export async function GET() {
  if ((await loadAuthMode()) === 'oidc') return new NextResponse(null, { status: 404 });
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
