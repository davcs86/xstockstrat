/**
 * Feature 360 — the MCP tool catalog BFF route reads the agent's internal catalog RPC and never
 * the agent's public URL (@AC-1, @AC-2, @AC-3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import { NextRequest } from 'next/server';
import { SAMPLE_TOOLS } from '../../../../../e2e/fixtures/mcpTools';
import { TEST_USER_ID } from '../../../../../e2e/fixtures/users';
import { HEADER_USER_ID } from '@/lib/headers';
import { GET } from './route';

type ListTools = (...args: unknown[]) => Promise<unknown>;

const { session, listTools, holder } = vi.hoisted(() => {
  const listTools = vi.fn<ListTools>();
  return {
    session: vi.fn(),
    listTools,
    holder: { client: { listTools } as { listTools: typeof listTools } | null },
  };
});

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getSessionFromRequest: (...a: unknown[]) => session(...a),
}));
// A getter, so each case reads its own client (object or null) at request time.
vi.mock('@/lib/connectClients', () => ({
  get agentClient() {
    return holder.client;
  },
}));

const fetchStub = vi.fn(async () => {
  throw new Error('fetch must not be called');
});

function request(): NextRequest {
  return new NextRequest('http://localhost/accounts/api/mcp-tools');
}

beforeEach(() => {
  session.mockReset().mockResolvedValue({ user_id: TEST_USER_ID, roles: ['viewer'] });
  listTools.mockReset();
  holder.client = { listTools };
  fetchStub.mockClear();
  vi.stubGlobal('fetch', fetchStub);
  vi.stubEnv('AGENT_PUBLIC_URL', 'https://public.example/agent');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('GET /accounts/api/mcp-tools (feature 360)', () => {
  it('@AC-1: returns the catalog read from the internal catalog RPC', async () => {
    listTools.mockResolvedValue({
      tools: SAMPLE_TOOLS.map((t) => ({ $typeName: 'xstockstrat.agent.v1.McpTool', ...t })),
    });

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tools: SAMPLE_TOOLS, reachable: true });
    expect(listTools).toHaveBeenCalledTimes(1);
    const [input, options] = listTools.mock.calls[0] as [unknown, { headers: Headers }];
    expect(input).toEqual({});
    expect(options.headers.get(HEADER_USER_ID)).toBe(TEST_USER_ID);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('@AC-2: an unavailable internal RPC never falls back to the public URL', async () => {
    listTools.mockRejectedValue(new ConnectError('down', Code.Unavailable));

    const res = await GET(request());

    expect(fetchStub).not.toHaveBeenCalled();
    expect(listTools).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tools: [], reachable: false });
  });

  it('@AC-2: no internal endpoint configured never falls back to the public URL', async () => {
    holder.client = null;

    const res = await GET(request());

    expect(fetchStub).not.toHaveBeenCalled();
    expect(listTools).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tools: [], reachable: false });
  });

  it('@AC-3: without a session the route answers 401 and calls nothing', async () => {
    session.mockResolvedValue(null);

    const res = await GET(request());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(listTools).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
