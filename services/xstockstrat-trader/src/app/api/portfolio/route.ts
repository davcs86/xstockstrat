import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { connectCodeToHttp, portfolioClient } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

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
  const headers = new Headers({
    'x-user-id': claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
  });
  const { searchParams } = new URL(req.url);
  const tradingMode = toTradingModeEnum(searchParams.get('trading_mode'));
  const accountId = searchParams.get('account_id') ?? '';
  try {
    const portfolio = await portfolioClient.getPortfolio(
      {
        userId: claims.user_id,
        ...(tradingMode !== 0 && { tradingMode }),
        ...(accountId && { accountId }),
      },
      { headers },
    );
    return NextResponse.json(portfolio);
  } catch (err) {
    if (ConnectError) {
      const ce = ConnectError.from(err);
      return NextResponse.json({ error: ce.rawMessage }, { status: connectCodeToHttp(ce.code) });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
