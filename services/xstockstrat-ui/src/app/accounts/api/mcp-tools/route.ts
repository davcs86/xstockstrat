import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

interface AgentTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

// GET /accounts/api/mcp-tools — proxies the agent's public GET /api/tools catalog so the
// "MCP Tools" page can render it. Mirrors agent-health's degrade-gracefully pattern: on any
// fetch failure it returns { tools: [], reachable: false } with HTTP 200 so the page still
// renders. The agent route itself is unauthenticated (capability metadata, never user data),
// but this BFF route still requires a session like every other /accounts page.
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
