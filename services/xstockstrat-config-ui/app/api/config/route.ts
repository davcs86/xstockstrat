/**
 * Config API route — proxies to xstockstrat-config via Connect-RPC.
 *
 * GET  /api/config?namespace=<ns>&env=<env>&mode=<mode>  → ListKeys
 * POST /api/config                                        → SetConfig
 */
import { NextRequest, NextResponse } from 'next/server';

const CONFIG_HTTP_ENDPOINT =
  process.env.CONFIG_HTTP_ENDPOINT ?? 'http://xstockstrat-config:8060';

async function rpc(method: string, body: object): Promise<Response> {
  return fetch(`${CONFIG_HTTP_ENDPOINT}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/connect+json' },
    body: JSON.stringify(body),
  });
}

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
    const res = await rpc('xstockstrat.config.v1.ConfigService/ListKeys', {
      namespace,
      environment: envToProto(env),
      tradingMode: modeToProto(mode),
    });
    const response = await res.json();
    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { namespace, key, value, env, mode, author, reason } = body;

  try {
    const res = await rpc('xstockstrat.config.v1.ConfigService/SetConfig', {
      namespace,
      key,
      value: { stringVal: String(value) },
      author: author ?? 'config-ui',
      reason: reason ?? 'Updated via config-ui',
      environment: envToProto(env ?? 'dev'),
      tradingMode: modeToProto(mode ?? 'paper'),
    });
    const response = await res.json();
    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
