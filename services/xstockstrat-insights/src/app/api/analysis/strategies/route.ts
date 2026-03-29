/**
 * GET /api/analysis/strategies
 *
 * Calls xstockstrat-analysis ListStrategies then ScoreStrategy for each
 * strategy and returns a combined list with scores. This is the data source
 * for the strategy list and dashboard score cards.
 */
import { NextResponse } from 'next/server';

const ANALYSIS_BASE_URL =
  process.env.ANALYSIS_HTTP_ENDPOINT ?? 'http://xstockstrat-analysis:8056';

async function rpc(method: string, body: object): Promise<Response> {
  return fetch(`${ANALYSIS_BASE_URL}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/connect+json' },
    body: JSON.stringify(body),
  });
}

export async function GET() {
  try {
    const res = await rpc('xstockstrat.analysis.v1.AnalysisService/ListStrategies', {
      userId: '',
      page: { pageSize: 50 },
    });
    const result = await res.json();
    const strategies: any[] = result.strategies ?? [];

    // Enrich each strategy with a fresh score if not already present
    const enriched = await Promise.all(
      strategies.map(async (s: any) => {
        if (s.overallScore !== undefined) return s;
        try {
          const scoreRes = await rpc('xstockstrat.analysis.v1.AnalysisService/ScoreStrategy', {
            strategyId: s.strategyId,
          });
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
