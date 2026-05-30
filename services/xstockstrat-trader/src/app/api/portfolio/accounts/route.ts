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
    if (ConnectError) {
      const ce = ConnectError.from(err);
      return NextResponse.json({ error: ce.rawMessage }, { status: connectCodeToHttp(ce.code) });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
