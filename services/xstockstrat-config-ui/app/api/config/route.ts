/**
 * Config API route — proxies to xstockstrat-config via Connect-RPC.
 *
 * GET  /api/config?namespace=<ns>&env=<env>&mode=<mode>  → ListKeys
 * POST /api/config                                        → SetConfig
 */
import { NextRequest, NextResponse } from 'next/server';
import { createNodeHttpTransport } from '@connectrpc/connect-node';
import { createClient } from '@connectrpc/connect';

const CONFIG_ENDPOINT =
  process.env.CONFIG_ENDPOINT ?? 'http://xstockstrat-config:8060';

const transport = createNodeHttpTransport({ baseUrl: CONFIG_ENDPOINT, httpVersion: '2' });

// Minimal service descriptor for connect client (replace with buf-generated once stubs exist)
const ConfigServiceDef = {
  typeName: 'xstockstrat.config.v1.ConfigService',
  methods: {
    listKeys: {
      name: 'ListKeys',
      I: {} as any,
      O: {} as any,
      kind: 'unary' as const,
    },
    setConfig: {
      name: 'SetConfig',
      I: {} as any,
      O: {} as any,
      kind: 'unary' as const,
    },
  },
} as const;

const client = createClient(ConfigServiceDef as any, transport);

function envToProto(env: string): number {
  return env === 'production' ? 2 : 1;
}
function modeToProto(mode: string): number {
  return mode === 'live' ? 2 : mode === 'paper' ? 1 : 0;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const namespace = searchParams.get('namespace') ?? 'platform';
  const env = searchParams.get('env') ?? 'dev';
  const mode = searchParams.get('mode') ?? 'paper';

  try {
    const response = await (client as any).listKeys({
      namespace,
      environment: envToProto(env),
      tradingMode: modeToProto(mode),
    });
    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { namespace, key, value, env, mode, author, reason } = body;

  try {
    const response = await (client as any).setConfig({
      namespace,
      key,
      value: { stringVal: String(value) },
      author: author ?? 'config-ui',
      reason: reason ?? 'Updated via config-ui',
      environment: envToProto(env ?? 'dev'),
      tradingMode: modeToProto(mode ?? 'paper'),
    });
    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
