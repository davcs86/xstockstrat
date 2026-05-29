import { NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { connectCodeToHttp, tradingClient } from '@/lib/connectClients';

// DELETE /api/accounts/[id] — calls DeregisterBrokerAccount
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await tradingClient.deregisterBrokerAccount({ accountId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (ConnectError && err instanceof ConnectError) {
      return NextResponse.json({ error: err.rawMessage }, { status: connectCodeToHttp(err.code) });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
