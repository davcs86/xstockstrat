# Context Log: fix-listorders-ambiguous-updated-at

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-16 (/sdd-triage)

- Bug captured via `docs/reports/2026-08-16-trading-listorders-ambiguous-updated-at-defect.md`
  (GitHub Issues disabled on this repo — `--from-report` path).
- Severity: SEV-2 (wrong/degraded behavior, no live-trading impairment)
- Config-only: no → routed to Track C (SDD path)
- Created: feature.md, product-spec.md, context.md
- Affected services: xstockstrat-trading only
- Root cause hypothesis: `intentLateralJoinSQL` (feature 101, PR #880) introduced a second
  unqualified `updated_at` column that collides with `trading.orders.updated_at` in `GetOrder`/
  `ListOrders`/`ListSubmittedOrders`'s SELECT lists. Confidence: high.
- Recommended design depth: quick (SEV-2, single service, no proto/migration/config) →
  `/sdd-design fix-listorders-ambiguous-updated-at quick`
- Development branch: `feature/fix-listorders-ambiguous-updated-at`

## Session 2026-08-16 (/sdd-design boot correction)

- Corrected **Development Branch** `feature/<slug>` → `claude/commit-135-opportunities-strategies-0xjnxk` in feature.md — the session harness assignment overrides the default `feature/<slug>` branch model (same pattern as feature 135's own boot correction). All three bug-fix features created this session share this one branch.

## Session 2026-08-16 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-trading; key reuse pattern: xstockstrat-portfolio's `queryRower`/pgxmock testing precedent).
- Phase 1 Grilling: 1 round (quick). Proposer proposed 3-site column qualification + dbQuerier seam + 3 pgxmock tests. Adversary found no Floor breach but surfaced a better single-site alternative (AS-alias rename on the shared LATERAL subquery) plus should-fix items (interface shape mismatch vs. cited precedent, missing go.mod/go.sum in Files list, C-13 fixture-centralization question, scope-creep tension on routing 3 functions through a new seam).
- User gate (AskUserQuestion): chose the single-site AS-alias rename (Recommended) over 3-site qualification; chose 3 pgxmock tests (one per function) over 1 targeted test.
- Chosen approach: rename `intentLateralJoinSQL`'s own `updated_at` → `updated_at AS intent_updated_at`, forecloses the bug class at the source. Rejected: 3-site qualification (matches spec literally but larger diff, doesn't foreclose future recurrence); plain string-constant test (doesn't exercise the LATERAL join).
- Constitution rules touched: C-01, C-08, C-13 (open), C-14 (n/a), F-04, F-08. Floor breaches: none.
- Open risks carried forward: pgxmock can't detect a differently-shaped SQL regression (mitigate with a manual local docker-compose smoke test before merge); C-13 fixture-centralization to be checked concretely once the 3 test bodies are written.
- Status: draft → design-approved.

## Session 2026-08-16 — sdd-spec

- Generated implementation-spec.md with 2 steps (Step 1 `service`, Step 2 `test`). Status → implementation-ready.
- Key codebase findings:
  - `TradingRepo` has exactly one construction site (`trading_repo.go:26`, called from `cmd/server/main.go:74`) and exactly 4 `.Pool()`/`NewTradingRepo(` call sites total (`main.go:74,83,87,90`) — confirmed the new `db dbQuerier` field is additive and breaks nothing.
  - `li.updated_at` has zero consumers repo-wide (grep-confirmed) — the AS-alias rename is a pure rename with nothing downstream to update; only `li.state` is ever selected from the LATERAL join (`trading_repo.go:98,126,212` → `scanOrder` → `o.IntentState`, `:279-280,284-286`).
  - `xstockstrat-trading/go.mod` already pins `github.com/jackc/pgx/v5 v5.9.2` — byte-identical to `xstockstrat-portfolio`'s pin — so `portfolio/go.sum`'s two `pashagolub/pgxmock/v4 v4.9.0` hash lines are valid to reuse verbatim in trading's `go.sum`; a full module-set diff between the two services' `go.sum` files confirms `pgxmock` is the *only* module portfolio has that trading lacks (no other transitive-dependency gap).
  - `scanOrder`'s exact 21-column positional scan order (`trading_repo.go:247-256`) is the fixture shape each of the 3 new pgxmock tests must supply; the regression guard for the bug itself is a `mock.ExpectQuery` regex requiring the literal substring `intent_updated_at` in the emitted SQL (pgxmock never parses real SQL, so this text-match is what actually proves the alias survives — not the scanned values, since `scanOrder` never selects `li.updated_at`/`intent_updated_at` at all).
  - New code lands entirely in `internal/repository/`, a package this service's CI `COVERPKGS` excludes from the 40% threshold — no coverage-percentage gate applies to the new lines; `go vet`/`golangci-lint`/full-suite `go test` still gate the step.
  - `internal/testdata/` does not exist yet for this service (confirmed via `find`) — Step 2 defers the C-13 materialize-on-second-consumer decision to execute time, once the 3 test bodies are actually written, per design.md's own open item.

## Session 2026-08-16 — sdd-spec

- Generated implementation-spec.md, 2 steps (service + test), both scoped to xstockstrat-trading. Grounded in design.md's single-site AS-alias rename + dbQuerier seam. Consumed recon.md/design.md directly; re-verified all evidence live against trading_repo.go (no drift found).
- Status: design-approved → implementation-ready.

## Session 2026-08-16 — sdd-execute (sequential)

- Tooling confirmed: Go 1.25.0, golangci-lint present — matches root CLAUDE.md's pinned version.
- Discovery (Phase 1): trading_repo.go matched implementation-spec.md's Codebase Evidence exactly — no drift.

### Step 1 — service: qualify the LATERAL join's own updated_at and add a mockable query seam [done]
- Added `"github.com/jackc/pgx/v5"` import, `dbQuerier` interface (QueryRow+Query), `db dbQuerier` field on `TradingRepo` (alongside unchanged `pool`), `NewTradingRepo` sets `db: pool`. Retargeted `GetOrder`/`ListOrders`/`ListSubmittedOrders` onto `r.db`. Renamed `intentLateralJoinSQL`'s `SELECT state, updated_at` → `SELECT state, updated_at AS intent_updated_at`.
- Verification: `GOWORK=off go build ./...` — clean.
- Files modified: `services/xstockstrat-trading/internal/repository/trading_repo.go`
- Deviations: none.

### Step 2 — test: pgxmock regression tests for GetOrder/ListOrders/ListSubmittedOrders [done]
- Added `github.com/pashagolub/pgxmock/v4 v4.9.0` via `go get` (go.mod/go.sum diff matched the cited xstockstrat-portfolio precedent exactly).
- Wrote 3 tests in new `trading_repo_test.go`. C-13: all 3 shared the identical fixture shape — extracted `NewOrderRow`/`OrderRowColumns` into new `internal/testdata/order_rows.go` package (first for this service), per the spec's own instructed branch for this case.
- One implementation fix beyond the spec's literal text: `pgxmock` requires the mocked `state` column value to be `*int16` (a pointer), not a bare `int16`, to satisfy `scanOrder`'s `&intentState` (`*int16`) scan target — `pgxmock.NewRows(...).AddRow(...)` failed with "destination kind 'ptr' not supported for value kind 'int16'" until `NewOrderRow` passed `&intentState` instead of `intentState`. Mechanical pgxmock API detail, not a design change.
- **Red-before-green (P-06), actually executed, not assumed**:
  - GREEN (post-Step-1 rename): all 3 tests pass — `go test ./internal/repository/... -race -count=1 -v -run '...'` → `PASS` (all 3), `ok`.
  - RED (temporarily reverted Step 1's rename back to bare `updated_at`, re-ran the identical tests): all 3 fail with `could not match actual sql: "...LEFT JOIN LATERAL ( SELECT state, updated_at FROM trading.order_intents ...) li ON true..." with expected regexp "(?s)LEFT JOIN LATERAL.*intent_updated_at..."` — confirms the tests genuinely require the fix, not vacuously passing.
  - Re-applied the rename; re-ran green — passed again. Confirms Step 1 + Step 2 together, not just independently.
- `go vet ./...` — clean. `golangci-lint run --modules-download-mode=mod` — 0 issues. Full suite (`go test ./... -race -count=1 -coverprofile=...`) — all packages `ok`, including `internal/repository`. Total coverage 62.9% (repository package excluded from COVERPKGS per spec, as expected).
- Live-DB smoke test (instruction 7): unavailable — `docker ps` failed, no Docker daemon running in this execute environment. Fallback used: go vet + golangci-lint + the pgxmock red/green proof above, per the product spec's own explicit fallback clause. Recorded as a Deviation Log entry; a live-DB smoke test remains recommended before production per design.md Open Risk 1.
- Files modified: `services/xstockstrat-trading/internal/repository/trading_repo_test.go` (new), `services/xstockstrat-trading/internal/testdata/order_rows.go` (new), `services/xstockstrat-trading/go.mod`, `services/xstockstrat-trading/go.sum`.
- Deviations: pgxmock pointer-scan requirement (mechanical, documented above); C-13 fixture centralization (per spec's own instructed branch); live-DB smoke test unavailable (environment constraint).

**Both steps done. Feature status: implementation-ready → in-progress → code-completed.**

## Session 2026-08-16 — sdd-execute (sequential) — session summary

**Steps this session**: 1, 2
**Progress**: 2 done / 2 total
**Stopped at**: all complete
**Next**: merge-order.md check, then open the integration PR (claude/commit-135-opportunities-strategies-0xjnxk → main-dev)

Accountability:
- Out-of-scope changes: none
- Open questions / items: pgxmock never parses real SQL (Open Risk 1, design.md) — a live-DB smoke test against local docker-compose Postgres remains recommended before this fix is considered fully verified in a real environment; C-13 fixture-centralization question was resolved (see Step 2 above), not left open.
- Unaddressed review warnings: none (this feature never went through /sdd-review — Track C bug fix, per docs/runbooks/bug-triage.md).
