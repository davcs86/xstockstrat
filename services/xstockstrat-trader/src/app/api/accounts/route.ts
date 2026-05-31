import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import type { BrokerAccount } from '@xstockstrat/proto/trading/v1/trading_pb';
import { connectCodeToHttp, tradingClient } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

function propagationHeaders(req: NextRequest, claims: { user_id: string; roles: string[] }): Headers {
  return new Headers({
    'x-user-id': claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
  });
}

// The trading client (gRPC transport) returns protobuf-es messages with
// camelCase fields and an `id` field. The frontend (AccountContext /
// AccountManagementPanel) expects snake_case with `account_id`, so map here.
function toApiAccount(a: BrokerAccount) {
  return {
    account_id: a.id,
    display_name: a.displayName,
    broker_type: a.brokerType,
    is_paper: a.isPaper,
    is_active: a.isActive,
  };
}

function errorResponse(err: unknown): NextResponse {
  if (ConnectError) {
    const ce = ConnectError.from(err);
    return NextResponse.json({ error: ce.rawMessage }, { status: connectCodeToHttp(ce.code) });
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
    return NextResponse.json({ accounts: (data.accounts ?? []).map(toApiAccount) });
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
    return NextResponse.json({ account: data.account ? toApiAccount(data.account) : null });
  } catch (err) {
    return errorResponse(err);
  }
}
