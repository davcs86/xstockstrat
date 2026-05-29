/**
 * GET /api/analysis/strategies
 *
 * Calls xstockstrat-analysis ListStrategies then ScoreStrategy for each
 * strategy and returns a combined list with scores. This is the data source
 * for the strategy list and dashboard score cards.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { analysisClient, connectCodeToHttp } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

export async function GET(req: NextRequest) {
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
    const result = (await analysisClient.listStrategies(
      { userId: claims.user_id, page: { pageSize: 50 } },
      { headers },
    )) as any;
    const strategies: any[] = result.strategies ?? [];

    // Enrich each strategy with a fresh score if not already present
    const enriched = await Promise.all(
      strategies.map(async (s: any) => {
        if (s.overallScore !== undefined) return s;
        try {
          const score = await analysisClient.scoreStrategy(
            { strategyId: s.strategyId },
            { headers },
          );
          return { ...s, ...(score as any) };
        } catch {
          return s;
        }
      }),
    );

    return NextResponse.json({ strategies: enriched });
  } catch (err) {
    if (ConnectError && err instanceof ConnectError) {
      return NextResponse.json({ error: err.rawMessage }, { status: connectCodeToHttp(err.code) });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
