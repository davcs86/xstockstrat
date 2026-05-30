import { NextRequest, NextResponse } from 'next/server';
import { connectCodeToHttp, portfolioClient, tradingClient } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

// GET /api/portfolio?account_id=XXX
// Returns accounts list + per-account portfolios for the AccountPortfolioSelector.
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
  const accountId = searchParams.get('account_id') ?? '';

  try {
    const [accountsData, portfoliosData] = await Promise.all([
      tradingClient.listBrokerAccounts({}, { headers }),
      portfolioClient.listPortfolios(
        { ...(accountId && { accountId }) },
        { headers },
      ),
    ]);

    return NextResponse.json({
      accounts: (accountsData as any).accounts ?? [],
      portfolios: (portfoliosData as any).portfolios ?? [],
    });
  } catch (err) {
    const code = (err as any)?.code;
    const message = (err as any)?.rawMessage ?? (err as Error)?.message ?? 'Internal error';
    return NextResponse.json(
      { error: message },
      { status: typeof code === 'number' ? connectCodeToHttp(code) : 500 },
    );
  }
}
