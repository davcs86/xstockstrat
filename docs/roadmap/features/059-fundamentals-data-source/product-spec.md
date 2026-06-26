# Product Spec: fundamentals-data-source

**Created**: 2026-06-26
**Priority Bucket**: P1 — Foundation for the screener initiative (2 of 6); the single FMP chokepoint

---

## Problem Statement

The platform has no fundamental data (no fundamentals RPC in `marketdata.proto`; no
`fundamentals`/`company_info`/`metrics` table in marketdata migrations — only `ohlcv` + `quotes`
exist; no caching layer beyond the DB-as-cache read-through). The screener's fundamental criteria
need P/E, market cap, dividend yield, etc., and FMP's free tier (250 req/day, Personal Use) makes an
uncached per-scan fetch infeasible.

## User Story

As the **screener engine (and the fundamentals-signal producer)**, I want to fetch cached fundamental
metrics for a symbol through one internal RPC, so that fundamental criteria evaluate without
exhausting the FMP daily quota.

## Functional Requirements

FR-1. Add `GetFundamentals(GetFundamentalsRequest) returns (GetFundamentalsResponse)` and a batch
`GetFundamentalsMulti` (watchlist scans fetch many symbols) to `MarketDataService`.

FR-2. Implement an FMP client behind a **new `FundamentalsSource` interface** (NOT the OHLCV-shaped
`DataSourceClient`), placed at `internal/fmp/fmp_client.go`, registered alongside Alpaca in
`cmd/server/main.go`. The existing `source.Registry`/`DataSourceClient` and the Alpaca path are
**untouched**.

FR-3. **Read-through cache** in a new `marketdata.fundamentals` table (the codebase's established
DB-as-cache idiom): on `GetFundamentals`, serve from cache when fresh (within TTL); on miss/stale,
fetch FMP, upsert, return. Per-symbol keyed.

FR-4. **Quota guard**: a configurable daily request cap (default 250) prevents exceeding the free
tier; when the cap is hit, serve stale cache if present and mark the response `stale=true`, else
return a typed `ResourceExhausted` — never silently fail. Daily usage is measured by `COUNT(*)` over
`fetched_at` in the UTC-day window (no separate counter table).

FR-5. **Hybrid fetch strategy** to minimise calls: core metrics via the **batchable `quote`**
endpoint (1 call per scan chunk → `market_cap`, `pe`, `eps`, `price`, 52-week range); extended metrics
via **per-symbol `ratios-ttm` + `profile`** (`pb_ratio`, `dividend_yield`, `roe`, `beta`,
`debt_to_equity`). Both written to the same `marketdata.fundamentals` row. **Avoid** the gated
`profile-bulk` endpoint.

FR-6. FMP is **disabled by default** behind `marketdata.fmp.enabled=false`; the API key is a secret
config key (`secret.*` prefix). Establish the `marketdata.<source>.enabled` config convention
(currently absent — Alpaca is hardcoded).

FR-7. Emit a `WARNING` notify alert when the day's FMP usage crosses ~80% of the cap, so an operator
can upgrade the FMP plan before scans start returning stale.

## Out of Scope

- Replacing Alpaca for OHLCV.
- Historical fundamentals time-series/backfill jobs (v1 stores the **latest snapshot** per symbol).
- The screener engine itself (060) and the fundamentals-signal producer (062).
- Any UI.
- IBKR scanner (explicitly out per the initiative brief).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-marketdata` — owns the RPC + FMP client + cache.
- `xstockstrat-config` — new `marketdata.fmp.*` keys.
- `xstockstrat-identity` / Security — secret-key review.

## Proto Contract Changes

- **Changes required (all additive → non-breaking):**
  - `packages/proto/marketdata/v1/marketdata.proto` — `GetFundamentals` / `GetFundamentalsMulti`
    RPCs; `Fundamentals` message — typed core fields (`symbol`, `market_cap`, `pe_ratio`, `pb_ratio`,
    `dividend_yield`, `eps`, `beta`, `roe`, `debt_to_equity`, `price`, `year_high`, `year_low`) plus
    `map<string,double> extra_metrics` for FMP's open-ended set, `as_of` timestamp, `currency`,
    `source`, `bool stale`.
  - **Note**: `BackfillBarsRequest` has **no `source` field** — fundamentals cannot be routed through
    the existing backfill path; this dedicated RPC is required.

## Config Key Changes

| Key | Type | Default |
|---|---|---|
| `marketdata.fmp.enabled` | bool | `false` |
| `secret.marketdata.fmp.api_key` | string (secret) | `""` |
| `marketdata.fmp.cache_ttl_hours` | int | `24` |
| `marketdata.fmp.daily_request_cap` | int | `250` |
| `marketdata.fmp.base_url` | string | `https://financialmodelingprep.com` |
| `marketdata.fmp.metrics` | string (allowlist) | `core,extended` |

## Database Changes

New migrations `002_fundamentals.up.sql` / `.down.sql`:
- `marketdata.fundamentals(symbol text PRIMARY KEY, as_of timestamptz NOT NULL, market_cap numeric,
  pe_ratio numeric, pb_ratio numeric, dividend_yield numeric, eps numeric, beta numeric, roe numeric,
  debt_to_equity numeric, price numeric, year_high numeric, year_low numeric,
  extra_metrics jsonb NOT NULL default '{}', currency text, source text NOT NULL default 'fmp',
  fetched_at timestamptz NOT NULL default now())`
- Plain table (latest-snapshot semantics; not a hypertable — no time-series). Index on `fetched_at`
  to support the day-window quota count (FR-4). **No new DB pool** (reuses marketdata's pgxpool;
  budget unchanged at 2).

## Feature Workflow Notes

Branch to create: `feature/fundamentals-data-source` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (additive proto change)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, all additive
- [x] DBA review + service owner (schema migration)
- [x] Security review + config team (new `secret.marketdata.fmp.api_key`)

## Acceptance Criteria

1. With `marketdata.fmp.enabled=true` and a key set, `GetFundamentals("AAPL")` returns populated
   metrics and persists a `marketdata.fundamentals` row.
2. A second call within `cache_ttl_hours` serves from cache and issues **no** FMP HTTP request
   (proven by a mocked-transport call-count assertion).
3. When the daily cap is reached, a fresh-cache miss returns `stale=true` from cache, or
   `ResourceExhausted` when no cache exists — never a fabricated zero-metric response.
4. With `marketdata.fmp.enabled=false`, `GetFundamentals` returns `FailedPrecondition`/`Unavailable`
   and makes no external call; the Alpaca OHLCV path is unaffected (existing marketdata tests stay green).
5. A batched `GetFundamentalsMulti` over a watchlist fetches core metrics in ~1 `quote` call.
6. `migrate up`/`down` cleanly creates/drops the fundamentals table.

## Resolved Decisions

- [x] **Metric set = Core + extended ratios** (OQ-059-a): core via batch `quote`; extended via
  per-symbol `ratios-ttm`/`profile`; everything else in `extra_metrics`.
- [x] **Per-environment 250/day cap** (OQ-059-b): dev and prod are separate DO apps with separate
  config; each gets its own budget — no cross-environment sharing.
- [x] **Snapshot-only v1** (OQ-059-c): no trailing fundamentals; revisit if a growth criterion is requested.
- [x] **`COUNT(fetched_at)` day-window** (OQ-059-d): no extra counter table.
- [x] **License = Personal/paper, start free** : free Basic "Personal Use" is licensable for the
  stated personal/paper usage; config-driven cap; documented upgrade path. **A move to
  commercial/multi-user use requires re-evaluating the FMP plan** (Security to note).

## Open Questions

- [ ] OQ-059-a-impl: confirm exact FMP endpoint paths and the canonical core-metric field mapping at
  `/sdd-spec` time (e.g. `/stable/profile`, `/stable/ratios-ttm`, `/stable/quote`).
