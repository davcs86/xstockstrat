import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

// GET /accounts/api/agent-health — server-side probe of the MCP agent's OAuth discovery
// endpoint. Returns only reachability/status — never the payload (FR-10). Degrades gracefully:
// on any fetch failure it returns { reachable: false } with HTTP 200 so the page still renders.
export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const base = process.env.AGENT_PUBLIC_URL;
  if (!base) return NextResponse.json({ reachable: false });

  try {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource`, { cache: 'no-store' });
    return NextResponse.json({ reachable: res.ok, status: res.status });
  } catch {
    return NextResponse.json({ reachable: false });
  }
}
