import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  FUNDAMENTALS_TIMEOUT_MS,
  LONG_RPC_TIMEOUT_MS,
  ORDER_MUTATION_TIMEOUT_MS,
} from '@/lib/deadlines';
import { TEST_JWT_SECRET, signTestJwt } from '../../e2e/helpers/auth';

const analysisClient = {
  scoreStrategy: vi.fn(),
  runBacktest: vi.fn(),
  screenSymbols: vi.fn(),
  listOpportunities: vi.fn(),
  runFundamentalsScan: vi.fn(),
};
const ingestClient = { triggerBackfill: vi.fn() };
const marketDataClient = {
  deleteBackfilledData: vi.fn(),
  getBars: vi.fn(),
  getFundamentals: vi.fn(),
};
const tradingClient = {
  placeOrder: vi.fn(),
  cancelOrder: vi.fn(),
  replaceOrder: vi.fn(),
  confirmOrder: vi.fn(),
};
const spies: Mock[] = [analysisClient, ingestClient, marketDataClient, tradingClient].flatMap((c) =>
  Object.values(c),
);

vi.mock('@/lib/connectClients', () => ({
  analysisClient,
  ingestClient,
  marketDataClient,
  tradingClient,
  indicatorsClient: {},
  portfolioClient: {},
  notifyClient: {},
  ledgerClient: {},
  configClient: {},
  identityClient: {},
}));

const dispatchers = {
  insights: (await import('@/lib/insightsBff')).dispatchConnect,
  'config-ui': (await import('@/lib/configUiBff')).dispatchConnect,
  trader: (await import('@/lib/traderBff')).dispatchConnect,
};
type Segment = keyof typeof dispatchers;

let cookie = '';

beforeAll(async () => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  cookie = `access_token=${await signTestJwt(['admin'])}`;
});

beforeEach(() => {
  for (const spy of spies) spy.mockReset().mockResolvedValue({});
});

async function timeoutFor(segment: Segment, path: string, spy: Mock): Promise<unknown> {
  const res = await dispatchers[segment](
    new Request(`http://localhost/${segment}/api/xstockstrat.${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: '{}',
    }),
  );
  expect(res.status).toBe(200);
  expect(spy).toHaveBeenCalledOnce();
  return (spy.mock.calls[0][1] as { timeoutMs?: number }).timeoutMs;
}

describe('BFF deadline classes (feature 271 @AC-6)', () => {
  it.each<[Segment, string, Mock]>([
    ['insights', 'analysis.v1.AnalysisService/ScoreStrategy', analysisClient.scoreStrategy],
    ['insights', 'analysis.v1.AnalysisService/RunBacktest', analysisClient.runBacktest],
    ['insights', 'analysis.v1.AnalysisService/ScreenSymbols', analysisClient.screenSymbols],
    ['insights', 'ingest.v1.IngestService/TriggerBackfill', ingestClient.triggerBackfill],
    [
      'insights',
      'marketdata.v1.MarketDataService/DeleteBackfilledData',
      marketDataClient.deleteBackfilledData,
    ],
    [
      'config-ui',
      'analysis.v1.AnalysisService/RunFundamentalsScan',
      analysisClient.runFundamentalsScan,
    ],
  ])('%s %s runs at LONG_RPC_TIMEOUT_MS', async (segment, path, spy) => {
    expect(await timeoutFor(segment, path, spy)).toBe(LONG_RPC_TIMEOUT_MS);
  });

  it.each<[string, Mock]>([
    ['PlaceOrder', tradingClient.placeOrder],
    ['CancelOrder', tradingClient.cancelOrder],
    ['ReplaceOrder', tradingClient.replaceOrder],
    ['ConfirmOrder', tradingClient.confirmOrder],
  ])('trader TradingService/%s runs at ORDER_MUTATION_TIMEOUT_MS', async (method, spy) => {
    const path = `trading.v1.TradingService/${method}`;
    expect(await timeoutFor('trader', path, spy)).toBe(ORDER_MUTATION_TIMEOUT_MS);
  });

  it.each<[string, Mock, number | undefined]>([
    ['analysis.v1.AnalysisService/ListOpportunities', analysisClient.listOpportunities, 30_000],
    [
      'marketdata.v1.MarketDataService/GetFundamentals',
      marketDataClient.getFundamentals,
      FUNDAMENTALS_TIMEOUT_MS,
    ],
    ['marketdata.v1.MarketDataService/GetBars', marketDataClient.getBars, undefined],
  ])('insights %s keeps its pre-existing deadline (%#)', async (path, spy, expected) => {
    expect(await timeoutFor('insights', path, spy)).toBe(expected);
  });
});
