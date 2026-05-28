import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { connectCodeToHttp, portfolioClient } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

// GET /api/portfolio/accounts?account_id=XXX — calls ListPortfolios
export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('account_id') ?? '';
  const headers = new Headers({
    'x-user-id': claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
  });
  try {
    const data = await portfolioClient.listPortfolios(
      { ...(accountId && { accountId }) },
      { headers },
    );
    return NextResponse.json({ portfolios: (data as any).portfolios ?? [] });
  } catch (err) {
    if (err instanceof ConnectError) {
      return NextResponse.json({ error: err.rawMessage }, { status: connectCodeToHttp(err.code) });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
