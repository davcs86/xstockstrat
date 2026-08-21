# Context: fix-listorders-ambiguous-updated-at  (archived 2026-08-19)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-19 — /sdd-archiver

**What**: A SEV-2 bug where every `TradingRepo` DB read of orders (`GetOrder`/`ListOrders`/`ListSubmittedOrders`) failed with `SQLSTATE 42702` ("column reference updated_at is ambiguous") and silently fell back to a process-local in-memory store. The shipped fix was NOT the product-spec's literal prescription (qualify `updated_at` at 3 SELECT sites) but a single-site rename of the shared `intentLateralJoinSQL` const's own projection to `updated_at AS intent_updated_at` (`trading_repo.go`), plus a first-ever `pgxmock` test seam for this service. It shipped to production verified only by go vet + a text-regex mock assertion — never executed against real Postgres.

**Why (irrecoverable rationale)**: The single-site AS-alias rename was chosen over 3-site qualification because it structurally forecloses the whole bug class: once no second column literally named `updated_at` exists in the joined range, a future 4th caller built on the shared `intentLateralJoinSQL` const cannot reintroduce the ambiguity by omission the way the original three sites did (user chose it at the AskUserQuestion gate). The inner `ORDER BY updated_at DESC LIMIT 1` was safe to leave unaliased because it resolves inside the subquery before the output alias applies — a subtlety not evident from the diff alone.

**Rejected alternatives**:
- 3-site qualification `trading.orders.updated_at` (the product-spec's own literal fix) — lost: larger diff, doesn't foreclose future recurrence for a 4th caller of the shared const.
- Plain string-constant unit test (assert no bare `, updated_at,` via Go string matching, no DB seam) — lost: doesn't exercise the LATERAL join with a populated `order_intents` row.
- One targeted `ListOrders`-only pgxmock test — lost: user chose full 3-test coverage since all three functions are independently in scope.

**Scars & gotchas**: `pgxmock` never parses real SQL — the regression "guard" is only a Go-regexp text match for the literal substring `intent_updated_at` in the emitted query; it proves the alias text survives but by construction cannot catch a differently-shaped ambiguity/typo the way live Postgres would (why the fix ships with residual risk despite green tests). The mocked `state` column had to be supplied as `*int16` (pointer), not bare `int16` — `pgxmock.NewRows(...).AddRow(int16)` fails with "destination kind 'ptr' not supported for value kind 'int16'" because `scanOrder` scans into `&intentState`. Red-before-green was genuinely executed: reverting the rename to bare `updated_at` made all 3 tests fail on the regex mismatch.

**Permanent deviations**: product-spec said "qualify at 3 sites" → shipped single-site `AS intent_updated_at` rename → because it forecloses the bug class at the source (design.md and shipped code agree; the divergence is spec-vs-shipped, and that "why" dies with design.md). The `dbQuerier` seam was deliberately made broader than the cited `xstockstrat-portfolio` `queryRower` precedent (adds `Query`, not just `QueryRow`) because `ListOrders`/`ListSubmittedOrders` return multiple rows.

**Cross-feature signal**: Root cause traces to feature 101 (`exactly-once-order-intent`, PR #880, 2026-08-06): its `intentLateralJoinSQL` addition projected a second `updated_at`, colliding with the three pre-existing outer SELECTs; the defect lived in staging ~10 days. A feature that added a shared SQL fragment silently broke callers it didn't touch. The same `ListOrders` function was flagged once before in fails.md (2026-08-06, positional arg-index builder bug) — `trading_repo.go`'s hand-rolled SQL is a repeat offender. pgxmock text-shape testing via a mockable `db` interface field is now a 2x platform pattern: portfolio (125) → trading (140).

**Deferred follow-ons**: Live-DB smoke test of the fixed `ListOrders` against local docker-compose TimescaleDB was never run (no Docker daemon in the execute env) — still recommended before the fix is considered fully verified in a real environment. A future auditor must not assume this fix was exercised against real Postgres.

**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-08-19 `fix-listorders-ambiguous-updated-at` entries.

**Runtime-invariant recommendations (→ /context-constitution)**: TRADING-* candidate — `intentLateralJoinSQL` (`trading_repo.go`) projects `state` and `updated_at AS intent_updated_at`; a 4th caller must select `li.state` (never `li.updated_at`), and the outer query's bare `updated_at` now resolves unambiguously to `trading.orders.updated_at`; adding another same-named projection reintroduces SQLSTATE 42702. PLAT-*/testing-convention candidate — Go repo packages (trading, portfolio) have no live-DB CI harness and CI `COVERPKGS` excludes `internal/repository`; SQL correctness is asserted only via pgxmock text-match, which cannot catch real SQL ambiguity — a live-DB smoke step is the compensating control and is often skipped when Docker is unavailable.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 1d97c6c.
