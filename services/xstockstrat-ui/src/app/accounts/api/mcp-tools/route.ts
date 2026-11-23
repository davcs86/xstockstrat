import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { withBffMetrics } from '@/lib/bffMetrics';
import { agentClient } from '@/lib/connectClients';
import { restBackendHeaders } from '@/lib/restBackendHeaders';

// GET /accounts/api/mcp-tools — the catalog comes from the agent's internal RPC (AGENT_ENDPOINT);
// unset or any failure answers { tools: [], reachable: false } (HTTP 200); never AGENT_PUBLIC_URL.
async function getHandler(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!agentClient) return NextResponse.json({ tools: [], reachable: false });

  try {
    const data = await agentClient.listTools(
      {},
      { headers: restBackendHeaders(req, claims.user_id, claims.roles) },
    );
    const tools = data.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? {},
    }));
    return NextResponse.json({ tools, reachable: true });
  } catch {
    return NextResponse.json({ tools: [], reachable: false });
  }
}

export const GET = withBffMetrics('accounts', '/accounts/api/mcp-tools', getHandler);
