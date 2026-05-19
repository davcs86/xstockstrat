/**
 * GET /api/analysis/report/[id]
 *
 * Fetches a strategy report via xstockstrat-analysis GetStrategyReport.
 * Returns: StrategyReport (latest backtest + score + metadata)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

const ANALYSIS_BASE_URL =
  process.env.ANALYSIS_HTTP_ENDPOINT ?? 'http://xstockstrat-analysis:8056';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const accessScope = String(rolesToAccessScope(claims.roles));
  const traceId = req.headers.get('x-trace-id') ?? generateTraceId();
  try {
    const res = await fetch(
      `${ANALYSIS_BASE_URL}/xstockstrat.analysis.v1.AnalysisService/GetStrategyReport`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/connect+json',
          'x-user-id': claims.user_id,
          'x-access-scope': accessScope,
          'x-trace-id': traceId,
        },
        body: JSON.stringify({ strategyId: params.id }),
      },
    );
    const report = await res.json();
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
