/**
 * Config API route — proxies to xstockstrat-config via Connect-RPC.
 *
 * GET  /api/config?namespace=<ns>&env=<env>&mode=<mode>  → ListKeys
 * POST /api/config                                        → SetConfig
 */
import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { configClient, connectCodeToHttp } from '@/app/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/app/lib/auth';

function envToProto(env: string): number {
  return env === 'production' ? 2 : 1;
}
function modeToProto(mode: string): number {
  return mode === 'live' ? 2 : mode === 'paper' ? 1 : 0;
}

function propagationHeaders(
  req: NextRequest,
  claims: { user_id: string; roles: string[] },
): Headers {
  return new Headers({
    'x-user-id': claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
  });
}

function errorResponse(err: unknown): NextResponse {
  if (ConnectError) {
    const ce = ConnectError.from(err);
    return NextResponse.json({ error: ce.rawMessage }, { status: connectCodeToHttp(ce.code) });
  }
  return NextResponse.json({ error: (err as Error).message }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const namespace = searchParams.get('namespace') ?? 'platform';
  const env = searchParams.get('env') ?? 'dev';
  const mode = searchParams.get('mode') ?? 'paper';

  try {
    const response = await configClient.listKeys(
      {
        namespace,
        environment: envToProto(env),
        tradingMode: modeToProto(mode),
      },
      { headers: propagationHeaders(req, claims) },
    );
    return NextResponse.json(response);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json();
  const { namespace, key, value, env, mode, reason } = body;

  try {
    const response = await configClient.setConfig(
      {
        namespace,
        key,
        value: { value: { case: 'stringVal', value: String(value) } },
        author: claims.user_id,
        reason: reason ?? 'Updated via config-ui',
        environment: envToProto(env ?? 'dev'),
        tradingMode: modeToProto(mode ?? 'paper'),
      },
      { headers: propagationHeaders(req, claims) },
    );
    return NextResponse.json(response);
  } catch (err) {
    return errorResponse(err);
  }
}
