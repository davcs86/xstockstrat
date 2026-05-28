import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { connectCodeToHttp, tradingClient } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

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
  if (err instanceof ConnectError) {
    return NextResponse.json({ error: err.rawMessage }, { status: connectCodeToHttp(err.code) });
  }
  return NextResponse.json({ error: (err as Error).message }, { status: 500 });
}

// GET /api/accounts — calls ListBrokerAccounts
export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const data = await tradingClient.listBrokerAccounts(
      {},
      { headers: propagationHeaders(req, claims) },
    );
    return NextResponse.json({ accounts: (data as any).accounts ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/accounts — calls RegisterBrokerAccount
export async function POST(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const data = await tradingClient.registerBrokerAccount(
      {
        displayName: body.display_name,
        brokerType: body.broker_type,
        isPaper: body.is_paper ?? true,
        credentialsJson: body.credentials_json,
      },
      { headers: propagationHeaders(req, claims) },
    );
    return NextResponse.json({ account: (data as any).account });
  } catch (err) {
    return errorResponse(err);
  }
}
