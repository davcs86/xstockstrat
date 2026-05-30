import { NextRequest, NextResponse } from 'next/server';
import { connectCodeToHttp, tradingClient } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'order id is required' }, { status: 400 });
  }
  const headers = new Headers({
    'x-user-id': claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
  });
  try {
    const order = await tradingClient.getOrder({ orderId: id }, { headers });
    return NextResponse.json(order);
  } catch (err) {
    const code = (err as any)?.code;
    const message = (err as any)?.rawMessage ?? (err as Error)?.message ?? 'Internal error';
    return NextResponse.json(
      { error: message },
      { status: typeof code === 'number' ? connectCodeToHttp(code) : 500 },
    );
  }
}
