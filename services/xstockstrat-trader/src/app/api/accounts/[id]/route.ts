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
    if (ConnectError) {
      const ce = ConnectError.from(err);
      return NextResponse.json({ error: ce.rawMessage }, { status: connectCodeToHttp(ce.code) });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
