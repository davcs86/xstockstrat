import { NextRequest, NextResponse } from 'next/server';
import { portfolioClient } from '@/lib/connectClients';

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
    const portfolio = await (portfolioClient as any).getPortfolio({
      userId,
      ...(tradingMode !== 0 && { tradingMode }),
    });
    return NextResponse.json(portfolio);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
