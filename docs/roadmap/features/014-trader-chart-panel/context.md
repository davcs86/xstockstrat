# Context: trader-chart-panel

**Feature**: `docs/roadmap/features/014-trader-chart-panel/feature.md`
**Product Spec**: `docs/roadmap/features/014-trader-chart-panel/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/014-trader-chart-panel/implementation-spec.md`

---

## Session 2026-05-20T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Backend data path confirmed fully implemented: `GetBars` RPC, `MarketDataHandler`, `MarketDataService`, Alpaca REST client, `marketdata.ohlcv` hypertable.
- `StreamBars`/`StreamQuotes` exist in handler but have zero callers — polling `GetBars` chosen deliberately; streaming not needed at ≥5m timeframe.
- Origin of the missing chart panel: roadmap §5C specified it; `phase5-deviations.md` silently dropped it. Documented in `013-phase-2-data-layer/context.md`.
- Charting library: **`lightweight-charts`** (TradingView, MIT) — decided by user 2026-05-20.
- Default symbol: **first result from `ListAssets`** — decided by user 2026-05-20.

## Session 2026-05-20T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: 012-wire-fe-auth (code-completed) also modifies xstockstrat-trader — 014 should be built on top of merged 012.
- Overlap findings: no FAIL-level conflicts; no merge-order.md entry required.
- FR-8 added (bar-count selector: 50/100/200, default 100) to resolve final open question (user chose option B — user-adjustable).

## Session 2026-05-20T00:00:00Z — sdd-spec

- Generated implementation-spec.md with 5 steps. Status → implementation-ready.
- Key codebase findings:
  - `MARKETDATA_HTTP_ENDPOINT` is absent from the `xstockstrat-trader` service block in all three deployment files (`docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`); it exists only in the `xstockstrat-insights` blocks. Step 3 adds it to all three trader sections.
  - Connect-RPC route pattern: `fetch(${BASE_URL}/${rpc_path}, { method: 'POST', headers: { 'Content-Type': 'application/connect+json', ...propagationHeaders }, body: JSON.stringify(body) })` — confirmed in `services/xstockstrat-trader/src/app/api/orders/route.ts` L16–20.
  - `lightweight-charts` is not yet in `package.json` (confirmed absent); Step 1 adds it at `^4.2.0`. The component uses dynamic `import('lightweight-charts')` inside `useEffect` to avoid SSR issues.
  - Mock backend at `e2e/mock-backend.ts` L20 does not include `GetBars` or `ListAssets` paths; Step 5 adds both. `MARKETDATA_HTTP_ENDPOINT` is also absent from `playwright.config.ts` webServer.env (L46–52); Step 5 adds it.
  - The trading dashboard grid (`src/app/page.tsx` L29–39) uses `grid-cols-1 md:grid-cols-12`; chart panel will be mounted as a full-width row below the existing 3-column grid within the same `space-y-4` container.
