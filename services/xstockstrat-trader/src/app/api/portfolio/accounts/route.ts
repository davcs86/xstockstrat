import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { connectCodeToHttp, portfolioClient } from '@/lib/connectClients';

// GET /api/portfolio/accounts?account_id=XXX — calls ListPortfolios
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('account_id') ?? '';
  try {
    const data = await portfolioClient.listPortfolios({
      ...(accountId && { accountId }),
    });
    return NextResponse.json({ portfolios: (data as any).portfolios ?? [] });
  } catch (err) {
    if (ConnectError && err instanceof ConnectError) {
      return NextResponse.json({ error: err.rawMessage }, { status: connectCodeToHttp(err.code) });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
