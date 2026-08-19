# Recon: fix-listorders-ambiguous-updated-at

**Created**: 2026-08-16
**From**: product-spec.md
**Affected services**: xstockstrat-trading

---

## Objective

`GetOrder`, `ListOrders`, and `ListSubmittedOrders` in `TradingRepo` all SELECT an unqualified
`updated_at` from a query that LEFT JOIN LATERALs `trading.order_intents` (which itself projects
its own `updated_at`), causing Postgres to reject the query as ambiguous (SQLSTATE 42702) on every
call. Fix: qualify the column; add a regression test that would fail on reintroduction.

## Codebase Map

- **`xstockstrat-trading`** (Go)
  - `intentLateralJoinSQL` const (the ambiguity source) — `services/xstockstrat-trading/internal/repository/trading_repo.go:85-90`
  - `GetOrder` SELECT — `trading_repo.go:95-98` (uses the lateral join at `:100`)
  - `ListOrders` SELECT — `trading_repo.go:123-126` (uses the lateral join at `:128`)
  - `ListSubmittedOrders` SELECT — `trading_repo.go:209-212` (uses the lateral join at `:214`)
  - `scanOrder` (row scan → proto `Order`) — `trading_repo.go:241-297`; scans `createdAt,
    updatedAt` (`:258`) as `trading.orders`' own columns → `o.CreatedAt`/`o.UpdatedAt`
    (`:279-280`); the intent's own `state`/`updated_at` are scanned separately into
    `intentState` (`:251,259`) → `o.IntentState` (`:284-286`) — confirms the callers have always
    wanted `trading.orders.updated_at`, never the intent's.
  - `UpsertOrder`'s `ON CONFLICT ... DO UPDATE SET updated_at = EXCLUDED.updated_at` (`:66`) is
    the write side that bumps this same column — consistent with "order updated_at" meaning the
    order row's own timestamp.
  - No 4th call site: repo-wide grep confirms `intentLateralJoinSQL` is used only at
    `trading_repo.go:100,128,214` — `order_intent_repo.go`'s own six queries operate on
    `trading.order_intents` directly, never joined against `trading.orders`, so they carry no
    analogous ambiguity risk.
  - No existing `trading_repo_test.go` in this service today (confirmed via directory listing) —
    this would be the first repo-level test file for `xstockstrat-trading`.

## Patterns to REUSE

- Mockable DB seam for a repo-level SQL-shape test → reuse the `queryRower` interface pattern
  already landed in `xstockstrat-portfolio` (feature 125's `GetPosition` account-scoping fix):
  `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:18-24` (interface
  definition) and `:44` (`db: pool` wiring in the constructor). That service's own regression test
  (`portfolio_repo_test.go:18-24,49-89`) is the direct precedent for asserting emitted SQL text via
  `pgxmock` where no live-DB CI harness exists.

## Dependencies

- Proto/RPC: none — no proto or wire-format change
- Migration: none — no schema change
- Config keys: none
- Inter-service edges: none — internal query fix only
- New env vars / ports: none

## Risks / Not-found

- No live Postgres is reachable in this environment/CI for `xstockstrat-trading` (matches
  `xstockstrat-portfolio`'s own documented finding, `portfolio_repo_test.go:47-48`) — the
  regression test can only assert query *shape* via `pgxmock`, not execute the real ambiguous
  query against live Postgres. The product-spec's acceptance criteria already accepts this
  fallback ("otherwise confirmed via go vet/query-shape review").
- Applicable `fails.md` trap (2026-08-06, uncredited entry under trading): "A hand-rolled
  positional-arg WHERE-clause builder (`trading_repo.go` `ListOrders`) had one branch silently
  missing its arg-index increment; went unnoticed until a later feature extended the function." —
  same function, different bug class. The lesson generalizes: when touching `ListOrders`, verify
  every branch/callsite explicitly rather than assuming symmetry; this recon's "no 4th call site"
  claim above was verified by grep, not assumed.
- Introducing a new `dbQuerier`/`db` interface field on `TradingRepo` (to make the fix testable) is
  an inference from a *sibling* service's convention (`xstockstrat-portfolio`), not an existing
  same-service precedent — flagged for the grilling round to weigh against the "minimum diff"
  principle vs. the product-spec's explicit regression-test acceptance criterion.

## Recommended Scope

One step: qualify `updated_at` → `trading.orders.updated_at` in all three SELECT lists
(`trading_repo.go:97,125,211`), add the minimal DB-seam + `pgxmock` regression tests (one per
affected function) in a new `trading_repo_test.go`. No other files change.
