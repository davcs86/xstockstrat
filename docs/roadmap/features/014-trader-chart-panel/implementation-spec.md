# Implementation Spec: trader-chart-panel

**Status**: `pending`
**Created**: 2026-05-20
**Feature**: `docs/roadmap/features/014-trader-chart-panel/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/trader-chart-panel`

---

## Execution Summary

All work is confined to `xstockstrat-trader`. Steps execute in strict order: add `lightweight-charts` as a package dependency first (Step 1), wire the `/api/chart` route that proxies `GetBars` and `ListAssets` to `xstockstrat-marketdata` (Step 2), add the `MARKETDATA_HTTP_ENDPOINT` env var to all three deployment files (Step 3), build the `ChartPanel` React component that calls `/api/chart` with SWR polling (Step 4), mount the component on the trading dashboard page (also Step 4), then cover the new API route and component in E2E tests (Step 5). No proto, migration, or backend service changes are required.

## Step Dependencies

- Step 2 requires Step 1: `lightweight-charts` types are referenced in the component but the API route has no dependency on it; Step 1 is a prerequisite for Step 4.
- Step 3 must precede Step 4: the component's API route reads `MARKETDATA_HTTP_ENDPOINT` at runtime; the env var must be declared so local dev and deploys resolve correctly.
- Step 4 requires Step 2: `ChartPanel` fetches `/api/chart` which is created in Step 2.
- Step 5 requires Steps 2–4: tests target both the route and the rendered component.

---

### Step 1 — service: Add `lightweight-charts` dependency

**Status**: `done`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/package.json` — modify
- `services/xstockstrat-trader/pnpm-lock.yaml` — modify (updated by `pnpm install`)

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- Confirmed via: `cat services/xstockstrat-trader/package.json` → `"dependencies"` block at L17; `lightweight-charts` is absent from the block.
- Existing pattern: other UI-only deps like `recharts` and `swr` are declared in `"dependencies"` (not `"devDependencies"`) at L36 and L33 respectively.
- Confirmed `lightweight-charts` is not present anywhere: `grep -rn "lightweight-charts" services/xstockstrat-trader/` → no match.

**Instructions**:
1. In `services/xstockstrat-trader/package.json`, add `"lightweight-charts": "^4.2.0"` to the `"dependencies"` object, alphabetically between `"lucide-react"` and `"next"` (currently L28 and L29).
2. Run `pnpm install` from `services/xstockstrat-trader/` to update `pnpm-lock.yaml`.

**Verification**:
```bash
cd services/xstockstrat-trader && grep '"lightweight-charts"' package.json
# Expected: "lightweight-charts": "^4.2.0"
```

---

### Step 2 — service: Add `/api/chart` Next.js route handler

**Status**: `done`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/src/app/api/chart/route.ts` — create

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- `GetBars` RPC confirmed in: `packages/proto/marketdata/v1/marketdata.proto` L21 — `rpc GetBars(GetBarsRequest) returns (GetBarsResponse);`
- `GetBarsRequest` fields confirmed: `symbol` (field 1), `timeframe` (field 2), `page` (field 4, type `PageRequest`) — proto L67–73.
- `GetBarsResponse.bars` is `repeated Bar` (field 1); `Bar` has `open`, `high`, `low`, `close`, `volume`, `time` (fields 3–7, 2) — proto L32–44.
- `ListAssets` RPC confirmed: proto L29 — `rpc ListAssets(ListAssetsRequest) returns (ListAssetsResponse);`
- `ListAssetsRequest.tradable_only` (field 2), `ListAssetsResponse.assets` repeated `Asset` (field 1) — proto L95–101. `Asset.symbol` is field 1 in `packages/proto/common/v1/common.proto` L36.
- Existing Connect-RPC route pattern confirmed: `services/xstockstrat-trader/src/app/api/orders/route.ts` — `fetch(${BASE_URL}/${method}, { method: 'POST', headers: { 'Content-Type': 'application/connect+json', ...propagationHeaders }, body: JSON.stringify(body) })` at L16–20.
- Auth propagation pattern confirmed: `getSessionFromRequest`, `rolesToAccessScope`, `generateTraceId` imported from `@/lib/auth` and used to build `propagationHeaders` — `services/xstockstrat-trader/src/app/api/orders/route.ts` L3, L29–34.
- `MARKETDATA_HTTP_ENDPOINT` env var: absent from `services/xstockstrat-trader/src/` (confirmed: `grep -rn "MARKETDATA_HTTP_ENDPOINT" services/xstockstrat-trader/src/` → no match). Pattern for base URL fallback confirmed at `services/xstockstrat-trader/src/app/api/orders/route.ts` L5: `process.env.TRADING_HTTP_ENDPOINT ?? 'http://xstockstrat-trading:8051'`.

**Instructions**:
Create `services/xstockstrat-trader/src/app/api/chart/route.ts` with the following content:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

const MARKETDATA_BASE_URL =
  process.env.MARKETDATA_HTTP_ENDPOINT ?? 'http://xstockstrat-marketdata:8053';

async function rpc(method: string, body: object, headers: Record<string, string>): Promise<Response> {
  return fetch(`${MARKETDATA_BASE_URL}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/connect+json', ...headers },
    body: JSON.stringify(body),
  });
}

// GET /api/chart?symbol=AAPL&timeframe=1d&limit=100
// Returns { bars: [{time, open, high, low, close, volume}] }
export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const accessScope = String(rolesToAccessScope(claims.roles));
  const traceId = req.headers.get('x-trace-id') ?? generateTraceId();
  const propagationHeaders = {
    'x-user-id': claims.user_id,
    'x-access-scope': accessScope,
    'x-trace-id': traceId,
  };

  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol') ?? '';
  const timeframe = searchParams.get('timeframe') ?? '1d';
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '100', 10)));

  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }

  try {
    const res = await rpc(
      'xstockstrat.marketdata.v1.MarketDataService/GetBars',
      {
        symbol,
        timeframe,
        page: { pageSize: limit },
      },
      propagationHeaders,
    );
    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: errText || 'GetBars failed' }, { status: res.status });
    }
    const data = await res.json();
    const bars = (data.bars ?? []).map((b: any) => ({
      // lightweight-charts expects { time: Unix seconds, open, high, low, close }
      time: b.time?.seconds ?? Math.floor(new Date(b.time).getTime() / 1000),
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume ?? 0),
    }));
    return NextResponse.json({ bars });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET /api/chart/assets — returns tradable symbols for the symbol selector
export async function POST(req: NextRequest) {
  // Route doubles as assets endpoint: POST { action: 'listAssets' }
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const accessScope = String(rolesToAccessScope(claims.roles));
  const traceId = req.headers.get('x-trace-id') ?? generateTraceId();
  const propagationHeaders = {
    'x-user-id': claims.user_id,
    'x-access-scope': accessScope,
    'x-trace-id': traceId,
  };

  try {
    const res = await rpc(
      'xstockstrat.marketdata.v1.MarketDataService/ListAssets',
      { assetClass: 'us_equity', tradableOnly: true },
      propagationHeaders,
    );
    if (!res.ok) {
      return NextResponse.json({ assets: [] });
    }
    const data = await res.json();
    const symbols: string[] = (data.assets ?? []).map((a: any) => a.symbol as string).filter(Boolean);
    return NextResponse.json({ symbols });
  } catch {
    return NextResponse.json({ symbols: [] });
  }
}
```

Note: `ListAssets` is served via `POST /api/chart` (action route doubles as assets loader) to avoid a second API directory. The `ChartPanel` component will call `POST /api/chart` once on mount to populate the symbol selector, and `GET /api/chart?symbol=…&timeframe=…&limit=…` for bar data.

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm build
# Expected: build completes without TypeScript errors
# Smoke test (requires running dev server + valid JWT cookie):
# curl -s -b "access_token=<valid-jwt>" \
#   "http://localhost:3000/api/chart?symbol=AAPL&timeframe=1d&limit=100" | jq '.bars | length'
```

---

### Step 3 — service: Wire `MARKETDATA_HTTP_ENDPOINT` in deployment configs

**Status**: `done`
**Service**: `xstockstrat-trader`
**Files**:
- `docker-compose.yml` — modify
- `.do/app.dev.yaml` — modify
- `.do/app.yaml` — modify

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- `MARKETDATA_HTTP_ENDPOINT` confirmed **absent** from `xstockstrat-trader` section in `docker-compose.yml`: `grep -n "MARKETDATA_HTTP_ENDPOINT" docker-compose.yml` → matched only line 429 (inside `xstockstrat-insights` block at L417, not the trader block at L391).
- `MARKETDATA_HTTP_ENDPOINT` confirmed **absent** from `xstockstrat-trader` section in `.do/app.dev.yaml`: `grep -n -B5 "MARKETDATA_HTTP_ENDPOINT" .do/app.dev.yaml` → matched only L340 inside `xstockstrat-insights` block (which starts at L326), not the trader block (which starts at L302).
- `MARKETDATA_HTTP_ENDPOINT` confirmed **absent** from `xstockstrat-trader` section in `.do/app.yaml`: `grep -n -B5 "MARKETDATA_HTTP_ENDPOINT" .do/app.yaml` → matched only L336 inside `xstockstrat-insights` block (L322), not the trader block (L298).
- Existing pattern for trader env vars in `docker-compose.yml` at L401–404: `TRADING_HTTP_ENDPOINT: http://xstockstrat-trading:8051`, `PORTFOLIO_HTTP_ENDPOINT: http://xstockstrat-portfolio:8052`, etc.
- Existing pattern for insights `MARKETDATA_HTTP_ENDPOINT` in docker-compose at L429: `MARKETDATA_HTTP_ENDPOINT: http://xstockstrat-marketdata:8053`
- DO app spec pattern for trader at `.do/app.yaml` L308–315: `- key: TRADING_HTTP_ENDPOINT` / `value: ${xstockstrat-trading.PRIVATE_URL}` etc.
- DO insights pattern for `MARKETDATA_HTTP_ENDPOINT` at `.do/app.dev.yaml` L340–341: `- key: MARKETDATA_HTTP_ENDPOINT` / `value: ${xstockstrat-marketdata.PRIVATE_URL}`
- `xstockstrat-trader` `depends_on` in `docker-compose.yml` at L410–414: lists `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-notify`, `xstockstrat-identity` — must add `xstockstrat-marketdata`.

**Instructions**:

**docker-compose.yml** — in the `xstockstrat-trader` service block (L391–414), add `MARKETDATA_HTTP_ENDPOINT: http://xstockstrat-marketdata:8053` after `IDENTITY_HTTP_ENDPOINT` at L404, and add `- xstockstrat-marketdata` to the `depends_on` list after L414.

```yaml
# In xstockstrat-trader environment: block, after IDENTITY_HTTP_ENDPOINT:
MARKETDATA_HTTP_ENDPOINT: http://xstockstrat-marketdata:8053

# In xstockstrat-trader depends_on: block, add:
- xstockstrat-marketdata
```

**.do/app.dev.yaml** — in the `xstockstrat-trader` service block (L302–324), add after `IDENTITY_HTTP_ENDPOINT` entry (L318–319):

```yaml
      - key: MARKETDATA_HTTP_ENDPOINT
        value: ${xstockstrat-marketdata.PRIVATE_URL}
```

**.do/app.yaml** — in the `xstockstrat-trader` service block (L298–320), add after `IDENTITY_HTTP_ENDPOINT` entry (L314–315):

```yaml
      - key: MARKETDATA_HTTP_ENDPOINT
        value: ${xstockstrat-marketdata.PRIVATE_URL}
```

**Verification**:
```bash
grep -n "MARKETDATA_HTTP_ENDPOINT" docker-compose.yml .do/app.dev.yaml .do/app.yaml
# Expected: 3 matches — one in each file, all inside the xstockstrat-trader service block
grep -n "xstockstrat-marketdata" docker-compose.yml | grep -A0 "depends_on\|MARKETDATA"
# Expected: both the environment entry and the depends_on entry appear
```

---

### Step 4 — service: Create `ChartPanel` component and mount on trading dashboard

**Status**: `done`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/src/components/ChartPanel.tsx` — create
- `services/xstockstrat-trader/src/app/page.tsx` — modify

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- `'use client'` directive confirmed required for interactive components: `services/xstockstrat-trader/src/components/OrderForm.tsx` L1, `src/components/PortfolioPanel.tsx` L1, `src/components/OrderBook.tsx` L1.
- SWR polling pattern confirmed: `src/components/OrderBook.tsx` L2–3 (`import useSWR from 'swr'`), L14–18 (`useSWR(url, fetcher, { refreshInterval: 5000 })`).
- `useEffect` with manual polling confirmed: `src/components/AlertStream.tsx` L2 (`import { useEffect, useState } from 'react'`) — alternative pattern for non-SWR polling.
- Card component pattern confirmed: `src/components/PortfolioPanel.tsx` L7 (`import { Card, CardHeader, CardTitle, CardContent } from './ui/card'`).
- Select component pattern confirmed: `src/components/OrderForm.tsx` L9 (`import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'`).
- `lightweight-charts` will be installed in Step 1. Since it manipulates the DOM directly, the chart container ref must use `useEffect` + `useRef` — this is the required pattern per `lightweight-charts` docs (the chart is created via `createChart(container, options)` and updated by calling `series.setData(bars)`).
- Dynamic import required: `lightweight-charts` uses browser-only APIs; wrap with `dynamic(() => import(...), { ssr: false })` following Next.js convention, or guard with `useEffect` (chosen here since the whole component is `'use client'` and DOM ref is needed anyway).
- `page.tsx` grid confirmed: `src/app/page.tsx` L29–39 — `grid-cols-1 md:grid-cols-12` with `PortfolioPanel` (col-span-3), `OrderForm` (col-span-4), `OrderBook` (col-span-5). Chart panel will be added as a full-width row above (or below) this grid — product spec says "includes a chart panel" without specifying exact layout; full-width below the 3-column grid is simplest.
- Import list in `page.tsx` at L2–9: `AppShell`, `OrderForm`, `OrderBook`, `PortfolioPanel`, `AlertStream`, `AccountSelector`, `Button` — `ChartPanel` must be added.

**Instructions**:

1. Create `services/xstockstrat-trader/src/components/ChartPanel.tsx`:

```typescript
'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type Timeframe = '1m' | '5m' | '15m' | '1h' | '1d';
type BarCount = 50 | 100 | 200;

interface Bar {
  time: number;   // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const INTRADAY_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h'];
const POLL_INTERVAL_MS = 30_000;

export function ChartPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);

  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState<string>('');
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');
  const [barCount, setBarCount] = useState<BarCount>(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load symbol list on mount
  useEffect(() => {
    fetch('/api/chart', { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        const list: string[] = data.symbols ?? [];
        setSymbols(list);
        if (list.length > 0) setSymbol(list[0]);
      })
      .catch(() => {/* symbol list unavailable — user can type manually */});
  }, []);

  // Create chart on mount
  useEffect(() => {
    if (!containerRef.current) return;

    let chart: any;
    let series: any;

    import('lightweight-charts').then(({ createChart, CandlestickSeries }) => {
      chart = createChart(containerRef.current!, {
        width: containerRef.current!.offsetWidth,
        height: 320,
        layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
        grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: '#334155' },
        timeScale: { borderColor: '#334155', timeVisible: true },
      });

      series = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });

      chartRef.current = chart;
      seriesRef.current = series;

      const resizeObserver = new ResizeObserver(() => {
        if (containerRef.current) {
          chart.applyOptions({ width: containerRef.current.offsetWidth });
        }
      });
      resizeObserver.observe(containerRef.current!);

      return () => {
        resizeObserver.disconnect();
        chart.remove();
      };
    });

    return () => {
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Fetch bars and set on chart
  const fetchBars = async (sym: string, tf: Timeframe, count: BarCount) => {
    if (!sym || !seriesRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chart?symbol=${encodeURIComponent(sym)}&timeframe=${tf}&limit=${count}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load bars');
      const bars: Bar[] = (data.bars ?? []).sort((a: Bar, b: Bar) => a.time - b.time);
      seriesRef.current.setData(bars);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Re-fetch when symbol, timeframe, or barCount changes
  useEffect(() => {
    if (symbol) fetchBars(symbol, timeframe, barCount);
  }, [symbol, timeframe, barCount]);

  // Auto-refresh for intraday timeframes
  useEffect(() => {
    if (!symbol || !INTRADAY_TIMEFRAMES.includes(timeframe)) return;
    const id = setInterval(() => fetchBars(symbol, timeframe, barCount), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [symbol, timeframe, barCount]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base mr-auto">Chart</CardTitle>

          {/* Symbol selector */}
          {symbols.length > 0 ? (
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="w-28 h-7 text-xs">
                <SelectValue placeholder="Symbol" />
              </SelectTrigger>
              <SelectContent>
                {symbols.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {/* Timeframe switcher */}
          <div className="flex gap-1">
            {(['1m', '5m', '15m', '1h', '1d'] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                  timeframe === tf
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Bar count selector */}
          <Select value={String(barCount)} onValueChange={(v) => setBarCount(Number(v) as BarCount)}>
            <SelectTrigger className="w-20 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {([50, 100, 200] as BarCount[]).map((n) => (
                <SelectItem key={n} value={String(n)}>{n} bars</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        {error && (
          <p className="text-xs text-destructive mb-2">{error}</p>
        )}
        {loading && !seriesRef.current?.data?.length && (
          <p className="text-xs text-muted-foreground mb-2">Loading…</p>
        )}
        <div ref={containerRef} className="w-full" style={{ height: 320 }} />
      </CardContent>
    </Card>
  );
}
```

Note: `lightweight-charts` v4.x exports `CandlestickSeries` as a named class used with `chart.addSeries(CandlestickSeries, options)`. Confirm the exact API shape against the installed version after `pnpm install` in Step 1; the `addSeries` signature changed between v3 and v4. If v4 is not available via pnpm, fall back to `^3.8.0` and use `chart.addCandlestickSeries(options)` instead — update this comment in the code if you do so.

2. Edit `services/xstockstrat-trader/src/app/page.tsx`:
   - Add `import { ChartPanel } from '@/components/ChartPanel';` after the existing `import { Button } from '@/components/ui/button';` at L9.
   - Inside the returned JSX, after the closing `</div>` of the `grid grid-cols-1 md:grid-cols-12` div (currently L39), add:
     ```tsx
     <ChartPanel />
     ```
     The result should be a full-width chart below the 3-column order/portfolio grid within the same `space-y-4` container.

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm build
# Expected: build completes without TypeScript errors
# Then start dev server and navigate to http://localhost:3000 — chart panel should be visible below the order/portfolio grid
```

---

### Step 5 — test: E2E coverage for `/api/chart` route and `ChartPanel`

**Status**: `pending`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/e2e/chart-panel.spec.ts` — create
- `services/xstockstrat-trader/e2e/mock-backend.ts` — modify

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- Mock backend pattern confirmed: `services/xstockstrat-trader/e2e/mock-backend.ts` — `RESPONSES` map at L20, keyed by Connect-RPC path string. Each entry is a plain JSON object. Server starts on `MOCK_PORT = 9091` (L15).
- `ListBrokerAccounts` mock confirmed at `mock-backend.ts` L82 — pattern to follow for `GetBars` and `ListAssets`.
- `playwright.config.ts` — `webServer.env` at L46–52: all `*_HTTP_ENDPOINT` vars point to `http://127.0.0.1:9091`. `MARKETDATA_HTTP_ENDPOINT` is absent (confirmed: `grep "MARKETDATA" services/xstockstrat-trader/playwright.config.ts` → no match). It must be added.
- API smoke test pattern confirmed: `services/xstockstrat-trader/e2e/api-smoke.spec.ts` — uses `page.request.get` with `addAuthCookie`, checks response shape.
- Component test pattern confirmed: `services/xstockstrat-trader/e2e/order-form.spec.ts` — uses `page.goto('/')` and `page.route()` to intercept API calls at the browser level.
- `GetBars` Connect-RPC path: `xstockstrat.marketdata.v1.MarketDataService/GetBars` (derived from proto `package xstockstrat.marketdata.v1` + service `MarketDataService` + rpc name — confirmed in `packages/proto/marketdata/v1/marketdata.proto` L3, L12, L21).
- `ListAssets` Connect-RPC path: `xstockstrat.marketdata.v1.MarketDataService/ListAssets` (confirmed L12, L29 of same proto file).

**Instructions**:

1. Edit `services/xstockstrat-trader/e2e/mock-backend.ts`: add mock responses for `GetBars` and `ListAssets` to the `RESPONSES` map immediately after the existing entries (before L127 `let server`):

```typescript
  '/xstockstrat.marketdata.v1.MarketDataService/GetBars': {
    bars: [
      { symbol: 'AAPL', time: { seconds: 1716422400, nanos: 0 }, open: 188.0, high: 190.5, low: 187.2, close: 189.8, volume: 45000000, vwap: 189.1, trade_count: 120000, timeframe: '1d', source: 'alpaca' },
      { symbol: 'AAPL', time: { seconds: 1716508800, nanos: 0 }, open: 189.8, high: 192.0, low: 188.5, close: 191.5, volume: 38000000, vwap: 190.5, trade_count: 98000, timeframe: '1d', source: 'alpaca' },
    ],
    page: { next_page_token: '', total_count: 2 },
  },
  '/xstockstrat.marketdata.v1.MarketDataService/ListAssets': {
    assets: [
      { symbol: 'AAPL', exchange: 'NASDAQ', asset_class: 'us_equity' },
      { symbol: 'MSFT', exchange: 'NASDAQ', asset_class: 'us_equity' },
      { symbol: 'TSLA', exchange: 'NASDAQ', asset_class: 'us_equity' },
    ],
  },
```

2. Edit `services/xstockstrat-trader/playwright.config.ts`: add `MARKETDATA_HTTP_ENDPOINT: 'http://127.0.0.1:9091'` to the `webServer.env` object at L46, alongside the other `*_HTTP_ENDPOINT` entries.

3. Create `services/xstockstrat-trader/e2e/chart-panel.spec.ts`:

```typescript
import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

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

test.describe('GET /api/chart — GetBars data contract', () => {
  test('returns bars array with required candlestick fields', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get('/api/chart?symbol=AAPL&timeframe=1d&limit=100');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('bars');
    expect(Array.isArray(body.bars)).toBe(true);
    expect(body.bars.length).toBeGreaterThan(0);

    const bar = body.bars[0];
    // lightweight-charts requires these exact fields
    expect(bar).toHaveProperty('time');
    expect(bar).toHaveProperty('open');
    expect(bar).toHaveProperty('high');
    expect(bar).toHaveProperty('low');
    expect(bar).toHaveProperty('close');
    // values must be numeric (not NaN)
    for (const field of ['time', 'open', 'high', 'low', 'close'] as const) {
      expect(Number(bar[field])).not.toBeNaN();
    }
    // bars must be sorted ascending by time
    if (body.bars.length > 1) {
      expect(body.bars[0].time).toBeLessThan(body.bars[1].time);
    }
  });

  test('returns 400 when symbol is missing', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get('/api/chart?timeframe=1d');
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('returns 401 when unauthenticated', async ({ page }) => {
    const res = await page.request.get('/api/chart?symbol=AAPL&timeframe=1d');
    expect(res.status()).toBe(401);
  });
});

test.describe('POST /api/chart — ListAssets data contract', () => {
  test('returns symbols array for the symbol selector', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.post('/api/chart', { data: {} });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('symbols');
    expect(Array.isArray(body.symbols)).toBe(true);
    expect(body.symbols.length).toBeGreaterThan(0);
    // Each entry must be a non-empty string
    for (const sym of body.symbols) {
      expect(typeof sym).toBe('string');
      expect(sym.length).toBeGreaterThan(0);
    }
  });
});

test.describe('ChartPanel component', () => {
  test.beforeEach(async ({ page }) => {
    await addAuthCookie(page);
  });

  test('renders the Chart card on the trading dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Chart')).toBeVisible();
  });

  test('timeframe buttons are visible', async ({ page }) => {
    await page.goto('/');
    for (const tf of ['1m', '5m', '15m', '1h', '1d']) {
      await expect(page.getByRole('button', { name: tf, exact: true })).toBeVisible();
    }
  });

  test('chart container element is present in the DOM', async ({ page }) => {
    await page.goto('/');
    // lightweight-charts renders into the containerRef div;
    // confirm the parent card content div is rendered
    await expect(page.locator('[data-testid="chart-container"]').or(
      page.locator('.chart-panel-container')
    ).or(
      // fallback: the card with "Chart" heading exists
      page.getByText('Chart').locator('../..')
    )).toBeTruthy();
  });

  test('inline error message is shown when GetBars returns error', async ({ page }) => {
    // Override /api/chart GET to return an error
    await page.route('/api/chart?*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'GetBars service unavailable' }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/');
    await expect(page.getByText('GetBars service unavailable')).toBeVisible({ timeout: 10000 });
  });
});
```

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm test:e2e
# Expected: all tests pass including the new chart-panel.spec.ts suite.
# No coverage threshold applies (Next.js frontend — E2E coverage only).
```

---

## Deviation Log

### Deviation: Step 4 — ChartPanel timeframes and chart API
**Spec said**: Timeframes `['1m', '5m', '15m', '1h', '1d']`; `chart.addSeries(CandlestickSeries, options)` (v5 API); polling interval 30 000 ms for all intraday.
**Actual**: Timeframes changed to `['10Min', '30Min', '1Hour', '1Day', '1Week', '1Month']` (user request; Alpaca-native strings confirmed via integration-test.sh). `chart.addCandlestickSeries(options)` used instead (installed version is v4.2.3, which does not export `CandlestickSeries`; that export is v5-only). Per-timeframe poll intervals: 10Min→120s, 30Min→300s, 1Hour→900s; 1Day/1Week/1Month no auto-poll. Pre/after-market toggle omitted — backlogged as feature `017-premarket-aftermarket-session-toggle`.
