import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

interface AgentTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

// GET /accounts/api/mcp-tools — proxies the agent's public GET /api/tools catalog; any fetch failure
// returns { tools: [], reachable: false } (HTTP 200). Requires a session like every /accounts page.
export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const base = process.env.AGENT_PUBLIC_URL;
  if (!base) return NextResponse.json({ tools: [], reachable: false });

  try {
    const res = await fetch(`${base}/api/tools`, { cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ tools: [], reachable: false });
    const data = (await res.json()) as { tools: AgentTool[] };
    return NextResponse.json({ tools: data.tools ?? [], reachable: true });
  } catch {
    return NextResponse.json({ tools: [], reachable: false });
  }
}
