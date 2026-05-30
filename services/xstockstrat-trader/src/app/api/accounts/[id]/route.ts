import { NextResponse } from 'next/server';
import { connectCodeToHttp, tradingClient } from '@/lib/connectClients';

// DELETE /api/accounts/[id] — calls DeregisterBrokerAccount
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await tradingClient.deregisterBrokerAccount({ accountId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const code = (err as any)?.code;
    const message = (err as any)?.rawMessage ?? (err as Error)?.message ?? 'Internal error';
    return NextResponse.json(
      { error: message },
      { status: typeof code === 'number' ? connectCodeToHttp(code) : 500 },
    );
  }
}
