/**
 * GET /api/analysis/report/[id]
 *
 * Fetches a strategy report via xstockstrat-analysis GetStrategyReport.
 * Returns: StrategyReport (latest backtest + score + metadata)
 */
import { NextRequest, NextResponse } from 'next/server';

const ANALYSIS_BASE_URL =
  process.env.ANALYSIS_HTTP_ENDPOINT ?? 'http://xstockstrat-analysis:8056';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const res = await fetch(
      `${ANALYSIS_BASE_URL}/xstockstrat.analysis.v1.AnalysisService/GetStrategyReport`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/connect+json' },
        body: JSON.stringify({ strategyId: params.id }),
      },
    );
    const report = await res.json();
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
