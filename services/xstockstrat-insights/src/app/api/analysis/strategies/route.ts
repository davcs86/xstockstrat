/**
 * GET /api/analysis/strategies
 *
 * Calls xstockstrat-analysis ListStrategies then ScoreStrategy for each
 * strategy and returns a combined list with scores. This is the data source
 * for the strategy list and dashboard score cards.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

const ANALYSIS_BASE_URL =
  process.env.ANALYSIS_HTTP_ENDPOINT ?? 'http://xstockstrat-analysis:8056';

async function rpc(method: string, body: object, propagationHeaders: Record<string, string>): Promise<Response> {
  return fetch(`${ANALYSIS_BASE_URL}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/connect+json', ...propagationHeaders },
    body: JSON.stringify(body),
  });
}

export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const accessScope = String(rolesToAccessScope(claims.roles));
  const traceId = req.headers.get('x-trace-id') ?? generateTraceId();
  const propagationHeaders = {
    'x-user-id': claims.user_id,
    'x-access-scope': accessScope,
    'x-trace-id': traceId,
  };
  try {
    const res = await rpc('xstockstrat.analysis.v1.AnalysisService/ListStrategies', {
      userId: claims.user_id,
      page: { pageSize: 50 },
    }, propagationHeaders);
    const result = await res.json();
    const strategies: any[] = result.strategies ?? [];

    // Enrich each strategy with a fresh score if not already present
    const enriched = await Promise.all(
      strategies.map(async (s: any) => {
        if (s.overallScore !== undefined) return s;
        try {
          const scoreRes = await rpc('xstockstrat.analysis.v1.AnalysisService/ScoreStrategy', {
            strategyId: s.strategyId,
          }, propagationHeaders);
          const score = await scoreRes.json();
          return { ...s, ...score };
        } catch {
          return s;
        }
      }),
    );

    return NextResponse.json({ strategies: enriched });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
