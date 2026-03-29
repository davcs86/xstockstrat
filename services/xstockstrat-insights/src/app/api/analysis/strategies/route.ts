/**
 * GET /api/analysis/strategies
 *
 * Calls xstockstrat-analysis ListStrategies then ScoreStrategy for each
 * strategy and returns a combined list with scores. This is the data source
 * for the strategy list and dashboard score cards.
 */
import { NextResponse } from 'next/server';
import { MethodKind } from '@bufbuild/protobuf';
import { createClient } from '@connectrpc/connect';
import { createNodeHttpTransport } from '@connectrpc/connect-node';

const ANALYSIS_BASE_URL =
  process.env.ANALYSIS_HTTP_ENDPOINT ?? 'http://xstockstrat-analysis:8056';

const transport = createNodeHttpTransport({ baseUrl: ANALYSIS_BASE_URL, httpVersion: '1.1' });

const AnalysisServiceDef = {
  typeName: 'xstockstrat.analysis.v1.AnalysisService',
  methods: {
    listStrategies: { name: 'ListStrategies', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    scoreStrategy: { name: 'ScoreStrategy', I: {} as any, O: {} as any, kind: MethodKind.Unary },
  },
} as const;

const client = createClient(AnalysisServiceDef as any, transport);

export async function GET() {
  try {
    const result = await (client as any).listStrategies({ userId: '', page: { pageSize: 50 } });
    const strategies: any[] = result.strategies ?? [];

    // Enrich each strategy with a fresh score if not already present
    const enriched = await Promise.all(
      strategies.map(async (s: any) => {
        if (s.overallScore !== undefined) return s;
        try {
          const score = await (client as any).scoreStrategy({ strategyId: s.strategyId });
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
