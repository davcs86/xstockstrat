/**
 * POST /api/analysis/backtest
 *
 * Runs a backtest via xstockstrat-analysis RunBacktest.
 * Body: { strategy_id, symbol, start, end, initial_capital? }
 * Returns: BacktestResult
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
    runBacktest: { name: 'RunBacktest', I: {} as any, O: {} as any, kind: MethodKind.Unary },
  },
} as const;

const client = createClient(AnalysisServiceDef as any, transport);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { strategy_id, symbol, start, end, initial_capital = 100000 } = body;

    const result = await (client as any).runBacktest({
      strategyId: strategy_id,
      symbols: symbol ? [symbol] : [],
      initialCapital: initial_capital,
      range: start && end ? { startTime: start, endTime: end } : undefined,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
