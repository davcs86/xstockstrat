# Context Log: fix-fundamentals-upsert-invalid-json

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-16 (/sdd-triage)

- Bug captured via `docs/reports/2026-08-16-marketdata-fundamentals-upsert-invalid-json-defect.md`
  (GitHub Issues disabled on this repo — `--from-report` path).
- Severity: SEV-3 (narrow, single-symbol, cache-only impact — no trading path dependency)
- Config-only: no → routed to Track C (SDD path)
- Created: feature.md, product-spec.md, context.md
- Affected services: xstockstrat-marketdata only
- Root cause hypothesis: `UpsertFundamentals` marshals `ExtraMetrics` to JSON; some field Finnhub
  (or FMP) returns for UPRO (a leveraged ETF) produces a payload Postgres's `json` column
  rejects. Not yet isolated to a specific field. Confidence: low. Confirmed unrelated to
  131/132/133/134/022/138 — none touch `xstockstrat-marketdata`.
- Recommended design depth: quick (SEV-3 alone would suggest skip, but root cause confidence is
  low/not yet isolated, which triggers quick per triage C-0) →
  `/sdd-design fix-fundamentals-upsert-invalid-json quick`
- Development branch: `feature/fix-fundamentals-upsert-invalid-json`

## Session 2026-08-16 (/sdd-design boot correction)

- Corrected **Development Branch** `feature/<slug>` → `claude/commit-135-opportunities-strategies-0xjnxk` in feature.md — the session harness assignment overrides the default `feature/<slug>` branch model (same pattern as feature 135's own boot correction). All three bug-fix features created this session share this one branch.

## Session 2026-08-16 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-marketdata; key finding: original "bad vendor data" hypothesis ruled out — ExtraMetrics is map[string]float64, hardcoded keys, finite floats only; strongest lead is a missing ::jsonb cast on the $14 bind combined with QueryExecModeExec (required for PgBouncer pooling) causing pgx to mis-infer the parameter's OID as bytea instead of jsonb).
- Phase 1 Grilling: 1 round (quick). Proposer proposed the ::jsonb cast fix, explicitly symbol-agnostic (correct whether the bug is universal or UPRO-specific-for-an-unknown-reason), with a two-tier test plan (pgxmock text-pin + a live-DB test explicitly caveated as CI-skipped/manual). Adversary raised a BLOCKING objection: shipping a fix for a hypothesis never confirmed against the real error DETAIL, with nothing in CI able to catch a wrong guess, violates the "define success, then verify" principle — recommended requiring the manual repro as a mandatory gate, not an optional follow-up.
- User gate (AskUserQuestion): required the mandatory manual repro (reproduce-then-fix against local docker-compose Postgres with DB_PGBOUNCER=true, capturing the real error DETAIL for the first time) before merge.
- Chosen approach: `$14::jsonb` cast (services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:316) + mandatory pre-merge repro gate recorded in context.md as the fix's actual verification evidence, not the pgxmock test alone. Rejected: shipping on the hypothesis alone; adding a Postgres CI container to this PR (deferred as separate follow-up); a repo-wide jsonb-cast lint rule (only 1 instance exists).
- Constitution rules touched: C-01, P-03, P-06, F-04. Floor breaches: none.
- Open risk carried forward: if the mandatory repro does NOT reproduce SQLSTATE 22P02 against unfixed code, the driver/OID hypothesis is wrong and design must be revisited before shipping the cast fix regardless.
- Status: draft → design-approved.

## Session 2026-08-16 — sdd-spec

- Generated implementation-spec.md with 4 steps. Status → implementation-ready.
- Step order: Step 1 (test, manual live-DB repro against unfixed code — RED) → Step 2 (service, the
  `::jsonb` cast fix, plus an `execer` interface + `db` field added to `MarketDataRepo` so
  `UpsertFundamentals` becomes `pgxmock`-substitutable) → Step 3 (test, re-run the same manual repro
  against fixed code — GREEN, records the before/after transcript in this file per design.md's
  requirement) → Step 4 (test, permanent `pgxmock` SQL-text-pin regression test + `go.mod` dependency
  on `github.com/pashagolub/pgxmock/v4 v4.9.0`, matching `xstockstrat-portfolio`'s existing pin).
- Key codebase findings:
  - `MarketDataRepo.pool` is a concrete `*pgxpool.Pool` (not an interface), so `pgxmock` cannot be
    injected without an interface — reused `xstockstrat-portfolio`'s `queryRower` pattern
    (`portfolio_repo.go:18-33`) but for `Exec` (new `execer` interface), since `UpsertFundamentals`
    calls `Exec`, not `QueryRow`. No existing `Exec`-shaped mockable interface exists anywhere in
    the Go services — flagged as **not found**, built fresh from the `queryRower` analog.
  - No prior `mock.ExpectExec`/`pgxmock.NewResult` usage exists in this repo (only `ExpectQuery` is
    exercised, in `portfolio_repo_test.go`) — flagged for execute-time confirmation against the
    vendored `pgxmock/v4` module rather than presented as grep-verified.
  - Confirmed via `.github/workflows/ci.yml:185-230` (`go-lint` job): no Postgres service container
    exists for any Go CI job, matching design.md's claim and justifying why Steps 1/3 are manual,
    not automated.
  - `internal/repository/` is excluded from the Go coverage `COVERPKGS` regex in CI — Step 4's new
    code lands entirely in an excluded package, so no coverage threshold applies to it; the targeted
    `go test -run` is the actual regression proof (per `reference/spec-template.md`'s excluded-package
    note).
  - Not trading-domain-relevant (fundamentals JSON upsert, no `BrokerType`/`OrderType`/`TradingMode`
    touch) — `reference/step-constraints.md` §A skipped; §B (lint/coverage) applied to the service
    step.
