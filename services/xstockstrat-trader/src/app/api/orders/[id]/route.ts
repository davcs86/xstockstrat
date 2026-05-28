import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

const TRADING_BASE_URL =
  process.env.TRADING_HTTP_ENDPOINT ?? 'http://xstockstrat-trading:8051';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!params.id) {
    return NextResponse.json({ error: 'order id is required' }, { status: 400 });
  }
  const accessScope = String(rolesToAccessScope(claims.roles));
  const traceId = req.headers.get('x-trace-id') ?? generateTraceId();
  try {
    const res = await fetch(
      `${TRADING_BASE_URL}/xstockstrat.trading.v1.TradingService/GetOrder`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/connect+json',
          'x-user-id': claims.user_id,
          'x-access-scope': accessScope,
          'x-trace-id': traceId,
        },
        body: JSON.stringify({ orderId: params.id }),
      },
    );
    const order = await res.json();
    if (!res.ok) {
      return NextResponse.json(order, { status: res.status });
    }
    return NextResponse.json(order);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
