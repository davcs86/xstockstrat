import { NextRequest, NextResponse } from 'next/server';
import { portfolioClient } from '@/lib/grpcClients';

// Maps UI trading mode string to proto TradingMode enum value.
// TRADING_MODE_UNSPECIFIED=0, TRADING_MODE_PAPER=1, TRADING_MODE_LIVE=2
function toTradingModeEnum(mode?: string | null): number {
  if (mode === 'live') return 2;
  if (mode === 'paper') return 1;
  return 0;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('user_id') ?? 'default';
  const tradingMode = toTradingModeEnum(searchParams.get('trading_mode'));
  try {
    const portfolio = await new Promise<any>((resolve, reject) => {
      portfolioClient.getPortfolio(
        {
          user_id: userId,
          ...(tradingMode !== 0 && { trading_mode: tradingMode }),
        },
        (err: any, res: any) => (err ? reject(err) : resolve(res)),
      );
    });
    return NextResponse.json(portfolio);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
