/**
 * Connect-RPC clients for xstockstrat-insights.
 * Used server-side in Next.js Route Handlers — NOT in browser components.
 *
 * Service descriptors use untyped I/O (`{} as any`) so we get a working
 * client without depending on generated proto stubs. JSON encoding is
 * used over Connect-RPC HTTP (ports 8053, 8056, 8054, ...).
 */
import { MethodKind } from '@bufbuild/protobuf';
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';

function makeTransport(baseUrl: string) {
  return createConnectTransport({ baseUrl, httpVersion: '1.1' });
}

// ── Base URLs ──────────────────────────────────────────────────────────────
const MARKETDATA_BASE_URL =
  process.env.MARKETDATA_HTTP_ENDPOINT ?? 'http://xstockstrat-marketdata:8053';

// ── Service descriptors ────────────────────────────────────────────────────

const MarketDataServiceDef = {
  typeName: 'xstockstrat.marketdata.v1.MarketDataService',
  methods: {
    getBars: { name: 'GetBars', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    getLatestQuote: { name: 'GetLatestQuote', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    listAssets: { name: 'ListAssets', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    backfillBars: { name: 'BackfillBars', I: {} as any, O: {} as any, kind: MethodKind.Unary },
  },
} as const;

// ── Exported clients ───────────────────────────────────────────────────────
export const marketDataClient = createClient(
  MarketDataServiceDef as any,
  makeTransport(MARKETDATA_BASE_URL),
);
