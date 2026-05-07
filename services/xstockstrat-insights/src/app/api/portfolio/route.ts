import { NextRequest, NextResponse } from 'next/server';

const TRADING_BASE_URL =
  process.env.TRADING_HTTP_ENDPOINT ?? 'http://xstockstrat-trading:8051';
const PORTFOLIO_BASE_URL =
  process.env.PORTFOLIO_HTTP_ENDPOINT ?? 'http://xstockstrat-portfolio:8052';

// GET /api/portfolio?account_id=XXX
// Returns accounts list + per-account portfolios for the AccountPortfolioSelector.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('account_id') ?? '';

  try {
    const [accountsRes, portfoliosRes] = await Promise.all([
      fetch(
        `${TRADING_BASE_URL}/xstockstrat.trading.v1.TradingService/ListBrokerAccounts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/connect+json' },
          body: JSON.stringify({}),
        },
      ),
      fetch(
        `${PORTFOLIO_BASE_URL}/xstockstrat.portfolio.v1.PortfolioService/ListPortfolios`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/connect+json' },
          body: JSON.stringify({ account_id: accountId }),
        },
      ),
    ]);

    const [accountsData, portfoliosData] = await Promise.all([
      accountsRes.json(),
      portfoliosRes.json(),
    ]);

    return NextResponse.json({
      accounts: accountsData.accounts ?? [],
      portfolios: portfoliosData.portfolios ?? [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
