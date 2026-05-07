import { NextRequest, NextResponse } from 'next/server';

const PORTFOLIO_BASE_URL =
  process.env.PORTFOLIO_HTTP_ENDPOINT ?? 'http://xstockstrat-portfolio:8052';

// GET /api/portfolio/accounts?account_id=XXX — calls ListPortfolios
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('account_id') ?? '';
  try {
    const res = await fetch(
      `${PORTFOLIO_BASE_URL}/xstockstrat.portfolio.v1.PortfolioService/ListPortfolios`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/connect+json' },
        body: JSON.stringify({ account_id: accountId }),
      },
    );
    const data = await res.json();
    return NextResponse.json({ portfolios: data.portfolios ?? [] });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
