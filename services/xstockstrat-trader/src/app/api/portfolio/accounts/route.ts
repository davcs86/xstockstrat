import { NextRequest, NextResponse } from 'next/server';
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
    const code = (err as any)?.code;
    const message = (err as any)?.rawMessage ?? (err as Error)?.message ?? 'Internal error';
    return NextResponse.json(
      { error: message },
      { status: typeof code === 'number' ? connectCodeToHttp(code) : 500 },
    );
  }
}
