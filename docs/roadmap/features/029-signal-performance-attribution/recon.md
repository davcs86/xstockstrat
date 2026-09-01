# Recon: signal-performance-attribution

**Created**: 2026-08-31
**From**: product-spec.md
**Affected services**: xstockstrat-trading (Go), xstockstrat-analysis (Python), xstockstrat-ledger (Node), xstockstrat-ingest (Python), xstockstrat-ui (Next.js), packages/proto

---

## Objective

Give the operator per-source trading performance (win rate, avg return, total realized P&L) derived
from real closed positions, so signal-source weights can be tuned with evidence instead of intuition.
Exposed as a new analysis `GetAttribution` RPC rendered by a sortable `/insights` table. The central
design question is how much of this collapses into **reusing feature 042's already-shipped
order-snapshot + realized-P&L capture** rather than building a new producer-side attribution store.

## Codebase Map

- **`xstockstrat-analysis`** (Python) — owns the P&L-attribution surface (feature 042)
  - Entry point / servicer: `services/xstockstrat-analysis/app/handlers/servicer.py`
  - Existing attribution RPC: `QueryPnLPatterns` — `servicer.py:2817-2854` (symbol-scoped, ranked
    indicator/signal *factors*, buckets at query time)
  - 042 ledger consumer: `app/engine/pnl_pattern_consumer.py` (`PnLPatternConsumer.run_forever`) —
    captures a snapshot per `order.*` event, opens/seals the `pnl_positions` window on
    `portfolio.position.closed`, writes `pnl_pattern_samples`. Registered in `app/main.py:166`.
  - Snapshot signal capture: `pnl_pattern_consumer.py:108-116` — `SnapshotComposer.signals` builds
    `[{name: s.source, value: conviction, source: s.source}]` from ingest `QuerySignals` (value = the
    **ingest conviction**, not a source input-weight).
  - Repos: `app/repositories/pnl_positions.py` (`open`/`seal`, user-scoped, dedup on close_event_id),
    `app/repositories/order_snapshots.py` (`insert`/`list_for_position`/`count_for_position`),
    `app/repositories/pnl_pattern_samples.py` (`insert_many`/`query`)
  - Last migration: `020_job_schedule.up.sql` → **next is `021`** (`services/xstockstrat-analysis/migrations/`)
  - 042 storage: `migrations/016_order_snapshots_pnl_patterns.up.sql`
  - Owner-scoping convention: `servicer._caller_user_id` from the `x-user-id` header, never the body
    (feature 133; `services/xstockstrat-analysis/CLAUDE.md` § Strategy Ownership)
  - Config-read pattern: `self._cfg.get_int(...)` (e.g. `servicer.py:2836`)
- **`xstockstrat-trading`** (Go) — orders store
  - `trading.orders` schema: `migrations/001_orders_hypertable.up.sql` (PK `(order_id, created_at)`,
    hypertable on `created_at`; columns include `user_id`, `status`, `strategy_id`, `account_id`)
  - **No `closed_at`, no `signal_id`, no attribution columns.** Real fill timestamp `filled_at` added
    by `migrations/008_offline_accounts.up.sql:11`.
  - `PlaceOrder` RPC: `packages/proto/trading/v1/trading.proto:11`; `PlaceOrderRequest`
    `trading.proto:96` — **carries no signal / weight / attribution field.**
  - Last trading migration: `009_offline_position_baselines` → next would be `010` (NOT used — see Scope)
- **`xstockstrat-portfolio`** (Go) — authoritative realized P&L (not in product spec's list, but the
  realized-P&L source, so surveyed)
  - `portfolio.position.closed` emit: `internal/service/portfolio_service.go:304-307`, sealed value =
    `pnl.RealizedDelta(...)` accum (`:288-302`) — **price-only, GROSS of fees**
  - Producer contract documented in `services/xstockstrat-portfolio/CLAUDE.md` § Ledger Events Emitted
    ("realized_accum is **attribution-stats-only and never a user-facing figure** — GetPnL remains the
    authoritative realized P&L … exact only for long, order-fill-originated positions")
- **`xstockstrat-ingest`** (Python) — source registry + signals
  - `ingest.newsletter_signals`: `migrations/001_newsletter_signals.up.sql` (`source`, `symbol`,
    `direction`, `conviction NUMERIC(4,3)`)
  - `ingest.signal_sources`: `migrations/002_add_signal_sources_registry.up.sql` — **PK `slug TEXT`,
    no `id` column**; `display_name` column present; join is `newsletter_signals.source =
    signal_sources.slug`
  - `ListSignalSources` RPC: `packages/proto/ingest/v1/ingest.proto:23`; `SignalSource{slug=1,
    display_name=2}` `ingest.proto:143-145` (resolves slug → display name)
  - `ExternalSignal.conviction = 0.0–1.0 confidence` `ingest.proto:110`
- **`xstockstrat-ledger`** (Node) — event store; `portfolio.position.closed` / `order.*` events are
  read by the 042 consumer. **No schema change needed.** `order.filled` emit
  (`services/xstockstrat-trading/internal/service/trading.go:731-745`) carries `FilledQty` /
  `FilledAvgPrice` / `FilledAt` — **no fee/commission field.**
- **`xstockstrat-ui`** (Next.js) — `/insights` segment
  - Nav: `src/components/shared/PlatformHeader.tsx:72` `PLATFORM_SUBNAV` — `/insights` already lists
    Opportunities/Strategies/Formulas/**P&L Patterns** (`:82`, feature 042)/Screener/Watchlists
  - 042 UI page (direct sibling to model): `src/app/insights/pnl-patterns/page.tsx`; hook
    `src/hooks/usePnLPatterns.ts`; BFF `src/lib/insightsBff.ts`; catch-all route
    `src/app/insights/api/[...connect]`
  - Sortable table primitive: `src/components/ui/data-table.tsx` (`DataTable`)

## Patterns to REUSE

- **Realized-P&L per closed position** → reuse `analysis.pnl_positions` (`user_id`, `symbol`,
  `closed_at`, `realized_pnl`) sealed by the 042 consumer (`pnl_positions.py:46-76`) — do **not**
  recompute P&L (C-10(b); the single fold is `packages/proto/pnl/pnl.go`).
- **Per-order signal capture (with conviction values)** → reuse `analysis.order_snapshots.signals`
  JSONB (`order_snapshots.py`; written at `pnl_pattern_consumer.py:206-223`). Retains
  `{name,value,source}` — the winner-takes-all input FR-3 needs.
- **Slug → display name** → reuse ingest `ListSignalSources` (`ingest.proto:23`) over the **existing**
  analysis→ingest stub (`INGEST_ENDPOINT`; used already by fundsignal) — no new edge/env var (F-06).
- **Owner-scoping** → reuse `servicer._caller_user_id` (x-user-id header, feature 133) — anti-IDOR.
- **Query-time bucketing precedent** → 042's `QueryPnLPatterns` computes everything at read time
  (`servicer.py:2817`); GetAttribution follows the same read-only pattern (no new write path).
- **UI**: reuse `DataTable` (`ui/data-table.tsx`), the `usePnLPatterns.ts` → `useSignalAttribution`
  hook shape, `insightsBff.ts`, the `[...connect]` BFF route, and design-role tokens/state primitives
  (C-17). New e2e fixture (`SourceAttribution`) + `INVENTORY.md` row (C-12/C-13).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-*` in `services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature`
  (feature 042): "Filling an order captures a snapshot", "pnl_pattern_factors written within 10s of
  close", "QueryPnLPatterns returns ranked positive/negative factors", "snapshot-capture timeout never
  blocks order execution", "snapshot/pattern events recorded in the ledger". 029 adds a **read RPC
  only** — it must not alter the consumer's capture/seal or `QueryPnLPatterns`.
- **PRESERVE** `docs/sdd/business-rules/platform.feature:50` "Deregistering an offline account purges
  its positions and realized P&L" — 029 reads realized data and must respect purges.
- **PRESERVE** `docs/sdd/business-rules/platform.feature:18` "A watchlist-direction signal adds the
  symbol to the caller's system-managed watchlist" — signal-source behavior 029 does not touch.
- No existing acceptance suite for xstockstrat-ingest or xstockstrat-ledger yet.
- 029's per-source aggregation is otherwise **net-new** behavior.

## Dependencies

- Proto/RPC: **additive** to `packages/proto/analysis/v1/analysis.proto` — new `GetAttribution` RPC
  (append to `AnalysisService`, after `:49`) + new messages `GetAttributionRequest`,
  `SourceAttribution`, `GetAttributionResponse` (append after `:746`). **No change to `Opportunity`
  (`analysis.proto:542`)** → no field-number collision with features 095/110 (both touch
  `Opportunity`). Reuse existing `SignalEntry`/`OrderSnapshot` shape (`:705`/`:712`) for the persisted
  vector. `./scripts/buf-gen.sh` + `buf breaking` (C-09).
- Migration: analysis **`021`** (optional additive index `pnl_positions (user_id, closed_at)` + paired
  `.down.sql`, C-07). **No trading migration** (see Scope). No ledger schema change.
- Config keys: none new (reuse analysis pool/stubs).
- Inter-service edges: analysis → ingest `ListSignalSources` (existing stub). No new trading/portfolio
  edge required under the chosen approach.
- New env vars / ports: none.

## Risks / Not-found

- **AC-6 net-of-fees is unbuildable from existing data (highest-priority).** The only realized-P&L
  figure anywhere (`pnl_positions.realized_pnl`; `GetPnL`) is the shared price-only `pnl.RealizedDelta`
  fold — **gross of fees** — and `order.filled` events carry **no** fee/commission field
  (`trading.go:731-745`). AC-6 ("$12 gross − $15 fees = loss; fees from the fill event payload") has no
  fee source in the platform today. Requires an operator decision (redefine AC-6 to the gross
  authoritative figure, or add fee-capture plumbing across trading→ledger→042). Ties to the C-10(b)
  parity guardrail.
- **"Input weight" has no causal persisted source.** `PlaceOrderRequest` carries no signal linkage;
  no analysis-score→order per-source weight vector is persisted anywhere. `SignalEntry.value` is the
  **ingest conviction** (cardinal — correct per the 023 ordinal-vs-cardinal fail — but the signal's
  own confidence, not a feature-007 source-reliability-weighted score input). FR-3's "highest input
  weight" must be realized as highest conviction-at-order-time (a proxy). Operator confirm.
- **`avg return %` has no denominator** on `pnl_positions` (only `realized_pnl` $). Derive cost basis
  from the opening `order_snapshots` price×qty (approximate) or express as avg P&L $ — resolve at
  /sdd-spec.
- **042 v1 window limitations inherited**: `position_id` is synthesized `{user}:{account}:{symbol}:
  {mode}` (`pnl_pattern_consumer.py:385`), so multiple open→close cycles for one identity share a
  `position_id` — a sealed window may include prior-cycle snapshots. `realized_accum` is inexact for
  shorts / sync-originated positions (portfolio CLAUDE.md). 029 is no worse than 042's shipped
  pnl-patterns page, which surfaces the same figure — accept as inherited v1 limitation.
- **`pnl_pattern_samples` cannot power winner-takes-all**: `_build_samples`
  (`pnl_pattern_consumer.py:337-352`) stores only `signal_present=true`, dropping the conviction
  value — so 029 must read `order_snapshots.signals` (retains value), not the samples table.
- Ledger trap (131 IDOR, fails.md): every GetAttribution query must be user-scoped via the header.
- Ledger trap (056 / C-10(b)): do not introduce a second realized-P&L computation that disagrees with
  the authoritative source.
- Ledger trap (signal-source-registry): source values are an open registry (base/derived/mediated) —
  keep `source_id` a string, never an enum with a fixed subset (also satisfies AC-9 auto-appearance).

## Recommended Scope

Advisory step boundaries for the grilling and /sdd-spec:

1. **proto** — additive `GetAttribution` RPC + `GetAttributionRequest{start,end,source_id?}` +
   `SourceAttribution{source_id,source_name,trade_count,win_count,win_rate,avg_return,total_pnl}` +
   `GetAttributionResponse`; `buf-gen` + `buf breaking`.
2. **analysis service** — `GetAttribution` handler (owner-scoped) + additive repo reads
   (`pnl_positions` closed-in-range by user; `order_snapshots.signals` for those positions) +
   winner-takes-all/exact-tie aggregation + slug→display_name via `ListSignalSources`; resolve the
   AC-6 P&L-source decision here. (+ paired test.)
3. **analysis migration 021** (optional) — additive `(user_id, closed_at)` index + `.down.sql`.
4. **UI** — `/insights/attribution` page (DataTable, date-range, source_id filter, copy-CSV) +
   `PLATFORM_SUBNAV` entry + nav-reachability test (C-10(a)) + BFF hook/route + fixture/INVENTORY.
5. **acceptance promotion** — the AC-6 resolution and the FR-2/FR-3 realization decisions recorded;
   042 suite preserved.
