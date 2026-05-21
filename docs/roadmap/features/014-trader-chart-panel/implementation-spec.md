# Implementation Spec: trader-chart-panel

**Status**: `pending`
**Created**: 2026-05-20
**Feature**: `docs/roadmap/features/014-trader-chart-panel/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/trader-chart-panel`

---

## Execution Summary

This feature is entirely frontend — no proto changes, no migrations, no backend service changes.
The execution order is: (1) add the `lightweight-charts` dependency and wire the env var for
`xstockstrat-marketdata` into `connectTransport.ts`; (2) add the `/api/chart` Next.js route
handler that proxies `GetBars` and `ListAssets`; (3) add the `ChartPanel` React client
component; (4) integrate the chart panel into the trading dashboard page; (5) add E2E tests
covering the new API route and component rendering.

## Step Dependencies

- Step 2 (service: `/api/chart` route) requires Step 1 (service: dependency + transport wiring): the route imports `MARKETDATA_BASE_URL` from `connectTransport.ts` which is added in Step 1.
- Step 3 (service: `ChartPanel` component) requires Step 2: the component calls `/api/chart`.
- Step 4 (service: `page.tsx` integration) requires Step 3: the page imports `ChartPanel`.
- Step 5 (test) requires Steps 2–4: tests exercise the route and the rendered component.

---

### Step 1 — service: Add `lightweight-charts` dependency and `MARKETDATA_BASE_URL` transport wiring

**Status**: `pending`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/package.json` — modify
- `services/xstockstrat-trader/src/lib/connectTransport.ts` — modify
- `docker-compose.yml` — modify (add `MARKETDATA_HTTP_ENDPOINT` to `xstockstrat-trader` environment block — confirmed absent: `grep -n "MARKETDATA_HTTP_ENDPOINT" docker-compose.yml` → line 429 is inside `xstockstrat-insights` block, not `xstockstrat-trader` block at lines 391–414)
- `.do/app.dev.yaml` — modify (add `MARKETDATA_HTTP_ENDPOINT` to `xstockstrat-trader` envs block — confirmed absent: the trader envs block at lines 311–324 has no `MARKETDATA_HTTP_ENDPOINT` entry)
- `.do/app.yaml` — modify (add `MARKETDATA_HTTP_ENDPOINT` to `xstockstrat-trader` envs block — confirmed absent: the trader envs block at lines 307–320 has no `MARKETDATA_HTTP_ENDPOINT` entry)

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- Confirmed via: `cat services/xstockstrat-trader/package.json` → L18 `"dependencies"` block; `lightweight-charts` is absent
- Existing charting dep: `"recharts": "^2.12.7"` at L34 — but `lightweight-charts` (TradingView, MIT) was chosen per product spec open questions (decided 2026-05-20)
- Existing transport file: `services/xstockstrat-trader/src/lib/connectTransport.ts` defines `TRADING_BASE_URL` at L19, `PORTFOLIO_BASE_URL` at L22, `NOTIFY_BASE_URL` at L25, `IDENTITY_BASE_URL` at L28 — all follow the same `process.env.XXX_HTTP_ENDPOINT ?? 'http://...'` pattern
- `docker-compose.yml` L391–414: `xstockstrat-trader` environment block lists `TRADING_HTTP_ENDPOINT`, `PORTFOLIO_HTTP_ENDPOINT`, `NOTIFY_HTTP_ENDPOINT`, `IDENTITY_HTTP_ENDPOINT` — `MARKETDATA_HTTP_ENDPOINT` absent
- `docker-compose.yml` L429: `MARKETDATA_HTTP_ENDPOINT: http://xstockstrat-marketdata:8053` appears in the `xstockstrat-insights` block (L417–442), confirming the correct value for the trader block
- `.do/app.dev.yaml` L311–324: trader `envs` block has `TRADING_HTTP_ENDPOINT`, `PORTFOLIO_HTTP_ENDPOINT`, `NOTIFY_HTTP_ENDPOINT`, `IDENTITY_HTTP_ENDPOINT` — no `MARKETDATA_HTTP_ENDPOINT`
- `.do/app.dev.yaml` L340–341: `MARKETDATA_HTTP_ENDPOINT: ${xstockstrat-marketdata.PRIVATE_URL}` is in the `xstockstrat-insights` envs block — confirms the correct DO value for trader
- `.do/app.yaml` L307–320: trader `envs` block has same four endpoints — no `MARKETDATA_HTTP_ENDPOINT`
- `.do/app.yaml` L336–337: `MARKETDATA_HTTP_ENDPOINT: ${xstockstrat-marketdata.PRIVATE_URL}` is in the `xstockstrat-insights` envs block

**Instructions**:

1. In `services/xstockstrat-trader/package.json`, add `"lightweight-charts": "^4.2.0"` to `"dependencies"` after the `"lucide-react"` entry (L29). The version `^4.2.0` is the current stable release of the TradingView MIT library.

2. In `services/xstockstrat-trader/src/lib/connectTransport.ts`, add after `IDENTITY_BASE_URL` (L28):

   ```ts
   export const MARKETDATA_BASE_URL =
     process.env.MARKETDATA_HTTP_ENDPOINT ?? 'http://xstockstrat-marketdata:8053';
   ```

3. In `docker-compose.yml`, add `MARKETDATA_HTTP_ENDPOINT: http://xstockstrat-marketdata:8053` to the `xstockstrat-trader` `environment:` block (after `IDENTITY_HTTP_ENDPOINT` line ~L404). Also add `- xstockstrat-marketdata` to the `depends_on:` list for `xstockstrat-trader` (after `- xstockstrat-identity`).

4. In `.do/app.dev.yaml`, add to the `xstockstrat-trader` `envs:` block (after the `IDENTITY_HTTP_ENDPOINT` entry at ~L319):
   ```yaml
   - key: MARKETDATA_HTTP_ENDPOINT
     value: ${xstockstrat-marketdata.PRIVATE_URL}
   ```

5. In `.do/app.yaml`, add to the `xstockstrat-trader` `envs:` block (after the `IDENTITY_HTTP_ENDPOINT` entry at ~L315):
   ```yaml
   - key: MARKETDATA_HTTP_ENDPOINT
     value: ${xstockstrat-marketdata.PRIVATE_URL}
   ```

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm install && grep -n "lightweight-charts" package.json
grep -n "MARKETDATA_BASE_URL" src/lib/connectTransport.ts
grep -n "MARKETDATA_HTTP_ENDPOINT" ../../docker-compose.yml ../../.do/app.dev.yaml ../../.do/app.yaml
```
Expected: `lightweight-charts` appears in `package.json`, `MARKETDATA_BASE_URL` appears in `connectTransport.ts`, and `MARKETDATA_HTTP_ENDPOINT` appears in all three deployment files under the trader section.

---

### Step 2 — service: Add `/api/chart` Next.js route handler

**Status**: `pending`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/src/app/api/chart/route.ts` — create (not found: `find services/xstockstrat-trader/src/app/api -type f | sort` shows no `chart/` directory)

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- No `/api/chart` route exists: confirmed by `find services/xstockstrat-trader/src/app/api -type f | sort` — existing routes are `accounts/`, `alerts/stream/`, `auth/`, `health/`, `orders/`, `portfolio/`
- Pattern for Connect-RPC fetch with auth: `services/xstockstrat-trader/src/app/api/orders/route.ts` — uses `getSessionFromRequest`, `rolesToAccessScope`, `generateTraceId` from `@/lib/auth` at L2, constructs `propagationHeaders` at L30–34, calls `fetch(URL/package.Service/Method, { method: 'POST', headers: { 'Content-Type': 'application/connect+json', ...propagationHeaders }, body: JSON.stringify({...}) })`
- `GetBars` RPC path: `xstockstrat.marketdata.v1.MarketDataService/GetBars` — confirmed in `packages/proto/marketdata/v1/marketdata.proto` L20
- `ListAssets` RPC path: `xstockstrat.marketdata.v1.MarketDataService/ListAssets` — confirmed in `packages/proto/marketdata/v1/marketdata.proto` L29
- `GetBarsRequest` fields (proto L67–72): `symbol` (string), `timeframe` (string), `range` (TimeRange with `start`/`end` timestamps), `page` (PageRequest with `page_size`)
- `Bar` fields (proto L32–44): `symbol`, `time` (Timestamp), `open`, `high`, `low`, `close`, `volume`, `vwap`, `trade_count`, `timeframe`, `source`
- `ListAssetsRequest` fields (proto L95–98): `asset_class` (string), `tradable_only` (bool)
- `ListAssetsResponse` (proto L100–102): `assets` repeated `Asset` where `Asset` has `symbol`, `exchange`, `asset_class` (common.proto L35–39)
- `MARKETDATA_BASE_URL` will be imported from `src/lib/connectTransport.ts` (added in Step 1)
- Route handler pattern in `services/xstockstrat-trader/src/app/api/portfolio/route.ts` uses `searchParams` from `new URL(req.url)` to read query params for GET requests

**Instructions**:

Create `services/xstockstrat-trader/src/app/api/chart/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';
import { MARKETDATA_BASE_URL } from '@/lib/connectTransport';

function makePropagationHeaders(claims: { user_id: string; roles: string[] }, traceId: string) {
  return {
    'x-user-id': claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id': traceId,
  };
}

async function rpc(method: string, body: object, propagationHeaders: Record<string, string>): Promise<Response> {
  return fetch(`${MARKETDATA_BASE_URL}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/connect+json', ...propagationHeaders },
    body: JSON.stringify(body),
  });
}

/**
 * GET /api/chart?symbol=AAPL&timeframe=1d&limit=100
 *
 * Proxies GetBars to xstockstrat-marketdata. Returns bars array + metadata.
 * If no time range is specified, defaults to enough history for the requested bar count:
 *   1m/5m → last 3 days, 15m → last 7 days, 1h → last 30 days, 1d → last 365 days.
 *
 * Query params:
 *   symbol    — required, e.g. "AAPL"
 *   timeframe — required, one of "1m"|"5m"|"15m"|"1h"|"1d"
 *   limit     — optional, number of bars (50|100|200), default 100
 */
export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const traceId = req.headers.get('x-trace-id') ?? generateTraceId();
  const headers = makePropagationHeaders(claims, traceId);
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');
  const timeframe = searchParams.get('timeframe') ?? '1d';
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '100', 10)));

  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }

  // Derive lookback window to cover at least `limit` bars for the given timeframe
  const now = Date.now();
  const tfMs: Record<string, number> = {
    '1m':  limit * 60 * 1000,
    '5m':  limit * 5 * 60 * 1000,
    '15m': limit * 15 * 60 * 1000,
    '1h':  limit * 60 * 60 * 1000,
    '1d':  limit * 24 * 60 * 60 * 1000,
  };
  const lookbackMs = tfMs[timeframe] ?? (limit * 24 * 60 * 60 * 1000);
  const start = new Date(now - lookbackMs).toISOString();
  const end   = new Date(now).toISOString();

  try {
    const res = await rpc('xstockstrat.marketdata.v1.MarketDataService/GetBars', {
      symbol,
      timeframe,
      range: { start, end },
      page: { page_size: limit },
    }, headers);
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `GetBars failed: ${text}` }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json({ bars: data.bars ?? [], symbol, timeframe });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET /api/chart/assets — proxies ListAssets (tradable_only=true, asset_class=us_equity)
 * Used by the symbol selector to populate the dropdown.
 */
export async function POST(req: NextRequest) {
  // POST /api/chart is the ListAssets endpoint called with JSON body { action: "list_assets" }
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const traceId = req.headers.get('x-trace-id') ?? generateTraceId();
  const headers = makePropagationHeaders(claims, traceId);

  try {
    const res = await rpc('xstockstrat.marketdata.v1.MarketDataService/ListAssets', {
      asset_class: 'us_equity',
      tradable_only: true,
    }, headers);
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `ListAssets failed: ${text}` }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json({ assets: data.assets ?? [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

Note: `rolesToAccessScope` accepts `claims.roles` — confirmed by pattern in `services/xstockstrat-trader/src/app/api/orders/route.ts` L29 where `claims.roles` is passed directly. Read `src/lib/auth.ts` to confirm the exact type before implementing — if `rolesToAccessScope` does not accept `string[]`, match the existing signature from `orders/route.ts` exactly.

**Verification**:
```bash
# With trader running locally (pnpm dev in services/xstockstrat-trader), after mock server started:
curl -s "http://localhost:3000/api/chart?symbol=AAPL&timeframe=1d&limit=100" \
  -H "Cookie: access_token=<test-jwt>" | jq '.bars | length'
# Expect: numeric (≥0); no "error" key in response
curl -s -X POST "http://localhost:3000/api/chart" \
  -H "Cookie: access_token=<test-jwt>" | jq '.assets | length'
# Expect: numeric (≥0)
```

---

### Step 3 — service: Add `ChartPanel` React client component

**Status**: `pending`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/src/components/ChartPanel.tsx` — create (not found: `find services/xstockstrat-trader/src/components -type f` shows no `ChartPanel.tsx`)

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- No `ChartPanel.tsx` exists: confirmed by `find services/xstockstrat-trader/src/components -type f | sort` — existing components are `AccountManagementPanel.tsx`, `AccountSelector.tsx`, `AlertStream.tsx`, `AppShell.tsx`, `OrderBook.tsx`, `OrderForm.tsx`, `PortfolioPanel.tsx`, `ui/`
- Client component pattern: `services/xstockstrat-trader/src/components/OrderBook.tsx` L1 `'use client'` directive; imports `useSWR` at L2 for data fetching with `refreshInterval`; imports `Card`, `CardHeader`, `CardTitle`, `CardContent` from `./ui/card` at L5; uses inline loading/error states (L28–38)
- SWR fetcher pattern: `services/xstockstrat-trader/src/components/OrderBook.tsx` L9 `const fetcher = (url: string) => fetch(url).then((r) => r.json())` — reuse identical pattern
- Select component: `services/xstockstrat-trader/src/components/ui/select.tsx` exports `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectValue` — use for timeframe and bar-count dropdowns
- The component must NOT call `xstockstrat-marketdata` directly (AC-7 from product spec): all data flows through `/api/chart`
- `lightweight-charts` (added in Step 1) is used via `useEffect` with `createChart` — DOM mounting via `useRef`; the chart container div must have a fixed height for the canvas
- Auto-refresh: `refreshInterval: 30000` for intraday timeframes (1m, 5m, 15m, 1h) via SWR; `refreshInterval: 0` (disable) for 1d — per FR-5
- FR-8: bar-count selector with values 50, 100, 200; default 100; changing immediately re-fetches via SWR key update
- Tailwind colors available from `tailwind.config.js`: `buy` (hsl 163 100% 40%), `sell` (hsl 0 84% 55%), `paper`, `secondary`, `muted`, `card`, `border` — use `card-foreground` for candle bodies

**Instructions**:

Create `services/xstockstrat-trader/src/components/ChartPanel.tsx`:

```tsx
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import useSWR from 'swr';
import { createChart, ColorType, type IChartApi, type ISeriesApi, type CandlestickData } from 'lightweight-charts';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from './ui/select';

type Timeframe = '1m' | '5m' | '15m' | '1h' | '1d';
type BarCount = 50 | 100 | 200;

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '1d'];
const BAR_COUNTS: BarCount[] = [50, 100, 200];
const INTRADAY: Timeframe[] = ['1m', '5m', '15m', '1h'];

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Asset {
  symbol: string;
  exchange: string;
}

export function ChartPanel() {
  const [symbol, setSymbol] = useState<string>('');
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');
  const [barCount, setBarCount] = useState<BarCount>(100);
  const [assets, setAssets] = useState<Asset[]>([]);

  // Load symbol list on mount — POST /api/chart proxies ListAssets
  useEffect(() => {
    fetch('/api/chart', { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        const list: Asset[] = data.assets ?? [];
        setAssets(list);
        if (list.length > 0 && !symbol) {
          setSymbol(list[0].symbol);
        }
      })
      .catch(() => {});
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const isIntraday = (INTRADAY as string[]).includes(timeframe);
  const swrKey = symbol
    ? `/api/chart?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${barCount}`
    : null;

  const { data, error, isLoading } = useSWR(swrKey, fetcher, {
    refreshInterval: isIntraday ? 30000 : 0,
  });

  // Chart DOM
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  // Create chart once container is mounted
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 320,
      layout: {
        background: { type: ColorType.Solid, color: 'hsl(222 47% 9%)' },
        textColor: 'hsl(215 20% 65%)',
      },
      grid: {
        vertLines: { color: 'hsl(215 20% 18%)' },
        horzLines: { color: 'hsl(215 20% 18%)' },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: 'hsl(215 20% 18%)' },
      timeScale: { borderColor: 'hsl(215 20% 18%)' },
    });
    const candleSeries = chart.addCandlestickSeries({
      upColor: 'hsl(163 100% 40%)',
      downColor: 'hsl(0 84% 55%)',
      borderUpColor: 'hsl(163 100% 40%)',
      borderDownColor: 'hsl(0 84% 55%)',
      wickUpColor: 'hsl(163 100% 40%)',
      wickDownColor: 'hsl(0 84% 55%)',
    });
    chartRef.current = chart;
    seriesRef.current = candleSeries;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Update series data when bars change
  useEffect(() => {
    if (!seriesRef.current || !data?.bars) return;
    const bars: CandlestickData[] = (data.bars as any[])
      .map((b: any) => {
        // proto Timestamp is { seconds: number, nanos: number } or ISO string
        const ts = b.time?.seconds
          ? b.time.seconds
          : Math.floor(new Date(b.time).getTime() / 1000);
        return {
          time: ts as any,
          open: Number(b.open),
          high: Number(b.high),
          low: Number(b.low),
          close: Number(b.close),
        };
      })
      .filter((b) => !isNaN(b.open))
      .sort((a, b) => (a.time as number) - (b.time as number));
    seriesRef.current.setData(bars);
    if (bars.length > 0) {
      chartRef.current?.timeScale().fitContent();
    }
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Chart</CardTitle>
          <div className="flex items-center gap-2">
            {/* Symbol selector */}
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="h-8 w-28 text-xs">
                <SelectValue placeholder="Symbol" />
              </SelectTrigger>
              <SelectContent>
                {assets.map((a) => (
                  <SelectItem key={a.symbol} value={a.symbol} className="text-xs">
                    {a.symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Timeframe switcher */}
            <Select value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}>
              <SelectTrigger className="h-8 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf} value={tf} className="text-xs">{tf}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Bar-count selector (FR-8) */}
            <Select
              value={String(barCount)}
              onValueChange={(v) => setBarCount(Number(v) as BarCount)}
            >
              <SelectTrigger className="h-8 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BAR_COUNTS.map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-xs">{n} bars</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {isLoading && (
          <div className="flex items-center justify-center h-[320px] text-sm text-muted-foreground">
            Loading…
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-[320px] text-sm text-destructive">
            {error?.message ?? 'Failed to load chart data'}
          </div>
        )}
        {data?.error && (
          <div className="flex items-center justify-center h-[320px] text-sm text-destructive">
            {data.error}
          </div>
        )}
        {/* Chart canvas container — always rendered so the useEffect can mount the chart */}
        <div
          ref={containerRef}
          className="w-full"
          style={{ height: 320, display: isLoading || error || data?.error ? 'none' : 'block' }}
          aria-label={`Candlestick chart for ${symbol} (${timeframe})`}
        />
      </CardContent>
    </Card>
  );
}
```

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm run lint
# Expect: no lint errors in src/components/ChartPanel.tsx
```

---

### Step 4 — service: Integrate `ChartPanel` into the trading dashboard page

**Status**: `pending`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/src/app/page.tsx` — modify

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- Existing dashboard grid: `services/xstockstrat-trader/src/app/page.tsx` L27–41 — `<div className="grid grid-cols-1 md:grid-cols-12 gap-4">` containing three columns: `md:col-span-3` (PortfolioPanel), `md:col-span-4` (OrderForm), `md:col-span-5` (OrderBook)
- The chart panel should occupy full width above the existing 3-column grid, matching the roadmap §5C intent
- Existing imports at L2–9: `AppShell`, `OrderForm`, `OrderBook`, `PortfolioPanel`, `AlertStream`, `AccountSelector`, `Button`
- `TradingDashboard` is a `'use client'` component (L1)
- `ChartPanel` created in Step 3 is at `@/components/ChartPanel`

**Instructions**:

In `services/xstockstrat-trader/src/app/page.tsx`:

1. Add the import at L8 (after the `AccountSelector` import):
   ```ts
   import { ChartPanel } from '@/components/ChartPanel';
   ```

2. In the `TradingDashboard` return JSX, add a full-width `ChartPanel` row above the existing 3-column grid. The existing content (L27–41) should become:
   ```tsx
   <div className="p-4 sm:p-6 space-y-4">
     {/* Chart panel — full width above the trading panels */}
     <ChartPanel />

     {/* Mobile: stacked; md: 3-column grid */}
     <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
       <div className="md:col-span-3">
         <PortfolioPanel mode={mode} />
       </div>
       <div className="md:col-span-4 order-3 md:order-none">
         <OrderForm mode={mode} />
       </div>
       <div className="md:col-span-5 order-2 md:order-none">
         <OrderBook mode={mode} />
       </div>
     </div>
   </div>
   ```
   The `ChartPanel` does not need a `mode` prop — it reads bars from marketdata which is mode-agnostic.

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm run build 2>&1 | tail -20
# Expect: build completes with no TypeScript errors; Next.js outputs "Route (app)" table with /api/chart listed
```

---

### Step 5 — test: Add E2E tests for the chart route and ChartPanel component

**Status**: `pending`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/e2e/chart-panel.spec.ts` — create (not found: `find services/xstockstrat-trader/e2e -type f | sort` shows no chart spec)
- `services/xstockstrat-trader/e2e/mock-backend.ts` — modify (add mock responses for `GetBars` and `ListAssets`)
- `services/xstockstrat-trader/playwright.config.ts` — modify (add `MARKETDATA_HTTP_ENDPOINT` to `webServer.env`)

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- Existing test file pattern: `services/xstockstrat-trader/e2e/order-form.spec.ts` — uses `page.goto('/')`, `page.route()` for API mocking, `expect(page.getByText(...)).toBeVisible()`
- Existing API smoke test pattern: `services/xstockstrat-trader/e2e/api-smoke.spec.ts` — uses `addAuthCookie(page)`, `page.request.get('/api/...')`, `expect(res.status()).toBe(200)`, `expect(body).toHaveProperty('...')`
- Mock backend: `services/xstockstrat-trader/e2e/mock-backend.ts` — `RESPONSES` map at L21 keyed by Connect-RPC path; currently has no `xstockstrat.marketdata.v1.MarketDataService/GetBars` or `.../ListAssets` entries
- Playwright config `webServer.env` at L45–52: has `TRADING_HTTP_ENDPOINT`, `PORTFOLIO_HTTP_ENDPOINT`, `NOTIFY_HTTP_ENDPOINT`, `IDENTITY_HTTP_ENDPOINT`, `JWT_SECRET` — no `MARKETDATA_HTTP_ENDPOINT`
- `MOCK_PORT` is `9091` (mock-backend.ts L15)
- Coverage threshold for Next.js frontends: no coverage threshold (table note: `xstockstrat-trader` → n/a); E2E coverage applies per the threshold table

**Instructions**:

1. In `services/xstockstrat-trader/e2e/mock-backend.ts`, add to the `RESPONSES` map at the end of the block (after the `DeregisterBrokerAccount` entry at L109):
   ```ts
   '/xstockstrat.marketdata.v1.MarketDataService/GetBars': {
     bars: [
       {
         symbol: 'AAPL',
         time: { seconds: 1716854400, nanos: 0 },
         open: '180.00', high: '182.50', low: '179.50', close: '181.75',
         volume: 1200000, vwap: '181.00', trade_count: 5000,
         timeframe: '1d', source: 'alpaca',
       },
       {
         symbol: 'AAPL',
         time: { seconds: 1716940800, nanos: 0 },
         open: '181.75', high: '184.00', low: '181.00', close: '183.20',
         volume: 980000, vwap: '182.50', trade_count: 4200,
         timeframe: '1d', source: 'alpaca',
       },
     ],
   },
   '/xstockstrat.marketdata.v1.MarketDataService/ListAssets': {
     assets: [
       { symbol: 'AAPL', exchange: 'NASDAQ', asset_class: 'us_equity' },
       { symbol: 'MSFT', exchange: 'NASDAQ', asset_class: 'us_equity' },
       { symbol: 'TSLA', exchange: 'NASDAQ', asset_class: 'us_equity' },
     ],
   },
   ```

2. In `services/xstockstrat-trader/playwright.config.ts`, add to the `webServer.env` block (after `IDENTITY_HTTP_ENDPOINT: 'http://127.0.0.1:9091'` at L50):
   ```ts
   MARKETDATA_HTTP_ENDPOINT: 'http://127.0.0.1:9091',
   ```

3. Create `services/xstockstrat-trader/e2e/chart-panel.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * E2E tests for the ChartPanel component and /api/chart route handler.
 *
 * Mock backend handles GetBars and ListAssets — see mock-backend.ts.
 * API smoke tests verify the route contract; component tests verify rendering.
 */

const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';
const BASE_URL = 'http://localhost:3000';

async function addAuthCookie(page: Page): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    user_id: 'test-user-001',
    email: 'test@example.com',
    roles: [],
    issued_at: now,
    expires_at: now + 3600,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));

  await page.context().addCookies([
    { name: 'access_token', value: token, url: BASE_URL, httpOnly: true, sameSite: 'Lax' },
  ]);
}

// ── API Smoke Tests ──────────────────────────────────────────────────────────

test.describe('GET /api/chart — ChartPanel data contract', () => {
  test('returns bars array and symbol/timeframe metadata', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get('/api/chart?symbol=AAPL&timeframe=1d&limit=100');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('bars');
    expect(Array.isArray(body.bars)).toBe(true);
    expect(body).toHaveProperty('symbol', 'AAPL');
    expect(body).toHaveProperty('timeframe', '1d');

    if (body.bars.length > 0) {
      const bar = body.bars[0];
      // Fields consumed by ChartPanel candlestick series
      expect(bar).toHaveProperty('time');
      expect(bar).toHaveProperty('open');
      expect(bar).toHaveProperty('high');
      expect(bar).toHaveProperty('low');
      expect(bar).toHaveProperty('close');
      expect(Number(bar.open)).not.toBeNaN();
      expect(Number(bar.high)).not.toBeNaN();
      expect(Number(bar.low)).not.toBeNaN();
      expect(Number(bar.close)).not.toBeNaN();
    }
  });

  test('returns 400 when symbol is missing', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get('/api/chart?timeframe=1d');
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('returns 401 without auth cookie', async ({ page }) => {
    const res = await page.request.get('/api/chart?symbol=AAPL&timeframe=1d');
    expect(res.status()).toBe(401);
  });
});

test.describe('POST /api/chart — ListAssets data contract', () => {
  test('returns assets array with symbol field', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.post('/api/chart');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('assets');
    expect(Array.isArray(body.assets)).toBe(true);
    expect(body.assets.length).toBeGreaterThan(0);
    // First asset symbol is used as chart default (AC-1)
    expect(body.assets[0]).toHaveProperty('symbol');
    expect(typeof body.assets[0].symbol).toBe('string');
  });
});

// ── Component Rendering Tests ────────────────────────────────────────────────

test.describe('ChartPanel component rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Chart card is visible on the trading dashboard', async ({ page }) => {
    await expect(page.getByText('Chart')).toBeVisible();
  });

  test('timeframe switcher options are visible', async ({ page }) => {
    // Find the timeframe Select by looking for one of its trigger labels
    const timeframeTrigger = page.locator('[aria-label*="Candlestick chart"]')
      .or(page.getByText('1d').first());
    // At minimum the default timeframe label should be visible somewhere
    await expect(page.getByText('1d').first()).toBeVisible();
  });

  test('bar-count selector shows default 100 bars', async ({ page }) => {
    await expect(page.getByText('100 bars')).toBeVisible();
  });

  test('chart shows error message when GetBars fails', async ({ page }) => {
    // Override the GET /api/chart route to return an error
    await page.route('/api/chart?**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'GetBars failed: upstream unavailable' }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/');
    // Error state renders the error message inside the chart area
    await expect(page.getByText(/GetBars failed|Failed to load chart data|upstream unavailable/i)).toBeVisible({ timeout: 10000 });
  });
});
```

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm test:e2e --reporter=list 2>&1 | tail -30
# Expect: all chart-panel.spec.ts tests pass; no regressions in existing specs
# Note: xstockstrat-trader has no coverage threshold — E2E coverage applies (per threshold table)
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
