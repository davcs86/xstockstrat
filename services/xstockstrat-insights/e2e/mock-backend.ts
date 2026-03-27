/**
 * Lightweight mock Connect-RPC HTTP server for xstockstrat-insights tests.
 *
 * Port 9092 — pointed at by ANALYSIS_HTTP_ENDPOINT in playwright.config.ts.
 *
 * The /api/analysis/strategies route calls both ListStrategies and then
 * ScoreStrategy for each strategy without an overallScore.  The mock returns
 * strategies with overallScore already set so ScoreStrategy is skipped,
 * keeping test behaviour predictable.
 */
import * as http from 'http';

export const MOCK_PORT = 9092;

const RESPONSES: Record<string, object> = {
  '/xstockstrat.analysis.v1.AnalysisService/ListStrategies': {
    strategies: [
      {
        strategyId: 'strat-high-001',
        name: 'Momentum Alpha',
        description: 'High-conviction momentum strategy',
        rating: 'A',
        overallScore: 0.87,   // 87% — rendered as green (≥80%)
      },
      {
        strategyId: 'strat-mid-002',
        name: 'Mean Reversion',
        description: 'Statistical arbitrage mean reversion',
        rating: 'B',
        overallScore: 0.68,   // 68% — rendered as yellow (60–79%)
      },
      {
        strategyId: 'strat-low-003',
        name: 'Trend Follow',
        description: 'Simple trend following strategy',
        rating: 'D',
        overallScore: 0.42,   // 42% — rendered as red (<60%)
      },
    ],
  },
  // ScoreStrategy is called as fallback when overallScore is missing —
  // return a minimal score so the enrichment branch doesn't error
  '/xstockstrat.analysis.v1.AnalysisService/ScoreStrategy': {
    overallScore: 0.5,
    rating: 'C',
  },
};

let server: http.Server | null = null;

export function startMockBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      const body = RESPONSES[path] ?? {};
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(body));
    });

    server.on('error', reject);
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve());
  });
}

export function stopMockBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => (err ? reject(err) : resolve()));
    server = null;
  });
}
