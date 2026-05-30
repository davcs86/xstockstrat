import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { connectCodeToHttp, tradingClient } from '@/lib/connectClients';

function errorResponse(err: unknown): NextResponse {
  if (ConnectError) {
    const ce = ConnectError.from(err);
    return NextResponse.json({ error: ce.rawMessage }, { status: connectCodeToHttp(ce.code) });
  }
  return NextResponse.json({ error: (err as Error).message }, { status: 500 });
}

// GET /api/accounts — calls ListBrokerAccounts
export async function GET() {
  try {
    const data = await tradingClient.listBrokerAccounts({});
    return NextResponse.json({ accounts: (data as any).accounts ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/accounts — calls RegisterBrokerAccount
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = await tradingClient.registerBrokerAccount({
      displayName: body.display_name,
      brokerType: body.broker_type,
      isPaper: body.is_paper ?? true,
      credentialsJson: body.credentials_json,
    });
    return NextResponse.json({ account: (data as any).account });
  } catch (err) {
    return errorResponse(err);
  }
}
