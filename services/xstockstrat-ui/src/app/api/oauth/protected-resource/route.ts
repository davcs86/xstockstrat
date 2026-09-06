import { NextResponse } from 'next/server';

// AGENT_PUBLIC_URL is read at request time — never bake it in at build time (it's a runtime env).
export const dynamic = 'force-dynamic';

// RFC 9728 Protected Resource Metadata: the well-known path-insertion form hits this UI's `/`
// catch-all (next.config rewrite) — keep in sync with the agent's app/oauth_metadata.py.
export async function GET() {
  const agent = process.env.AGENT_PUBLIC_URL ?? '';
  return NextResponse.json({
    resource: agent,
    authorization_servers: [agent],
  });
}
