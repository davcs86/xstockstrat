import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

const PORTFOLIO_BASE_URL =
  process.env.PORTFOLIO_HTTP_ENDPOINT ?? 'http://xstockstrat-portfolio:8052';

function toTradingModeEnum(mode?: string | null): number {
  if (mode === 'live') return 2;
  if (mode === 'paper') return 1;
  return 0;
}

export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const accessScope = String(rolesToAccessScope(claims.roles));
  const traceId = req.headers.get('x-trace-id') ?? generateTraceId();
  const { searchParams } = new URL(req.url);
  const tradingMode = toTradingModeEnum(searchParams.get('trading_mode'));
  const accountId = searchParams.get('account_id') ?? '';
  try {
    const res = await fetch(
      `${PORTFOLIO_BASE_URL}/xstockstrat.portfolio.v1.PortfolioService/GetPortfolio`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/connect+json',
          'x-user-id': claims.user_id,
          'x-access-scope': accessScope,
          'x-trace-id': traceId,
        },
        body: JSON.stringify({
          userId: claims.user_id,
          ...(tradingMode !== 0 && { tradingMode }),
          ...(accountId && { accountId }),
        }),
      },
    );
    const portfolio = await res.json();
    return NextResponse.json(portfolio);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
