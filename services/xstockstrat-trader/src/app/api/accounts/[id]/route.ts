import { NextResponse } from 'next/server';

const TRADING_BASE_URL =
  process.env.TRADING_HTTP_ENDPOINT ?? 'http://xstockstrat-trading:8051';

// DELETE /api/accounts/[id] — calls DeregisterBrokerAccount
export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await fetch(
      `${TRADING_BASE_URL}/xstockstrat.trading.v1.TradingService/DeregisterBrokerAccount`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/connect+json' },
        body: JSON.stringify({ account_id: id }),
      },
    );
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
