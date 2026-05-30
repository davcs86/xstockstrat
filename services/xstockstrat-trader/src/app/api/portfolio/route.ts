import { NextRequest, NextResponse } from 'next/server';
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
    const code = (err as any)?.code;
    const message = (err as any)?.rawMessage ?? (err as Error)?.message ?? 'Internal error';
    return NextResponse.json(
      { error: message },
      { status: typeof code === 'number' ? connectCodeToHttp(code) : 500 },
    );
  }
}
