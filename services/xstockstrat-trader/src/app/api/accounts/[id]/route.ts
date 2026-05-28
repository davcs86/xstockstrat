import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { connectCodeToHttp, tradingClient } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

// DELETE /api/accounts/[id] — calls DeregisterBrokerAccount
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const headers = new Headers({
      'x-user-id': claims.user_id,
      'x-access-scope': String(rolesToAccessScope(claims.roles)),
      'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
    });
    await tradingClient.deregisterBrokerAccount({ accountId: id }, { headers });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ConnectError) {
      return NextResponse.json({ error: err.rawMessage }, { status: connectCodeToHttp(err.code) });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
