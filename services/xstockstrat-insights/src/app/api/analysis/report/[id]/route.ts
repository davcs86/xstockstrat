/**
 * GET /api/analysis/report/[id]
 *
 * Fetches a strategy report via xstockstrat-analysis GetStrategyReport.
 * Returns: StrategyReport (latest backtest + score + metadata)
 */
import { NextRequest, NextResponse } from 'next/server';
import { MethodKind } from '@bufbuild/protobuf';
import { createClient } from '@connectrpc/connect';
import { createNodeHttpTransport } from '@connectrpc/connect-node';

const ANALYSIS_BASE_URL =
  process.env.ANALYSIS_HTTP_ENDPOINT ?? 'http://xstockstrat-analysis:8056';

const transport = createNodeHttpTransport({ baseUrl: ANALYSIS_BASE_URL, httpVersion: '2' });

const AnalysisServiceDef = {
  typeName: 'xstockstrat.analysis.v1.AnalysisService',
  methods: {
    getStrategyReport: {
      name: 'GetStrategyReport',
      I: {} as any,
      O: {} as any,
      kind: MethodKind.Unary,
    },
  },
} as const;

const client = createClient(AnalysisServiceDef as any, transport);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const report = await (client as any).getStrategyReport({ strategyId: params.id });
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
