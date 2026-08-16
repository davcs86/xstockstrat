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
