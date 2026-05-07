import { NextRequest, NextResponse } from 'next/server';

const TRADING_BASE_URL =
  process.env.TRADING_HTTP_ENDPOINT ?? 'http://xstockstrat-trading:8051';

async function rpc(method: string, body: object): Promise<Response> {
  return fetch(`${TRADING_BASE_URL}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/connect+json' },
    body: JSON.stringify(body),
  });
}

// GET /api/accounts — calls ListBrokerAccounts
export async function GET() {
  try {
    const res = await rpc(
      'xstockstrat.trading.v1.TradingService/ListBrokerAccounts',
      {},
    );
    const data = await res.json();
    return NextResponse.json({ accounts: data.accounts ?? [] });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/accounts — calls RegisterBrokerAccount
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await rpc(
      'xstockstrat.trading.v1.TradingService/RegisterBrokerAccount',
      {
        display_name: body.display_name,
        broker_type: body.broker_type,
        is_paper: body.is_paper ?? true,
        credentials_json: body.credentials_json,
      },
    );
    const data = await res.json();
    return NextResponse.json({ account: data.account });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
