/**
 * GET /api/analysis/report/[id]
 *
 * Fetches a strategy report via xstockstrat-analysis GetStrategyReport.
 * Returns: StrategyReport (latest backtest + score + metadata)
 */
import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { analysisClient, connectCodeToHttp } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const headers = new Headers({
    'x-user-id': claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
  });
  try {
    const report = await analysisClient.getStrategyReport(
      { strategyId: params.id },
      { headers },
    );
    return NextResponse.json(report);
  } catch (err) {
    if (ConnectError && err instanceof ConnectError) {
      return NextResponse.json({ error: err.rawMessage }, { status: connectCodeToHttp(err.code) });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
