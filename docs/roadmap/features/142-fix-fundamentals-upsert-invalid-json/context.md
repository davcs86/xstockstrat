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

## Session 2026-08-16 — sdd-execute (sequential)

- Tooling confirmed: Go 1.25.0, golangci-lint present.
- Discovery (Phase 1): marketdata_repo.go matched implementation-spec.md's Codebase Evidence exactly.
- **Steps 1 & 3 (manual live-DB repro) are BLOCKED**: this execute sandbox has no running Docker
  daemon (`docker ps` → "failed to connect to the docker API... dial unix
  /var/run/docker.sock: connect: no such file or directory"). sdd-execute's own HARD CONSTRAINTS
  forbid starting a database container to verify a step, Floor-adjacent, no carve-out. Escalated to
  the user via AskUserQuestion rather than silently skipped or faked. User chose: apply Steps 2 and
  4 (code-only) now, leave Steps 1/3 as a required follow-up before this fix is considered fully
  verified against the actual reported production error — see implementation-spec.md Deviation Log
  for the full writeup. **The RED/GREEN error transcripts this section's Step 1/3 instructions call
  for are NOT YET CAPTURED** — a future session with Docker access must run them and append the
  transcripts here before this feature can honestly move past `in-progress`.

### Step 2 — service: Add ::jsonb cast to the extra_metrics bind parameter [done]
- Added `"github.com/jackc/pgx/v5/pgconn"` import, `execer` interface (`Exec` only), `db execer`
  field on `MarketDataRepo` (alongside unchanged `pool`), `NewMarketDataRepo` sets `db: pool`.
  Retargeted `UpsertFundamentals`'s `Exec` call onto `r.db`. Added `::jsonb` cast to the `$14`
  bind parameter in the INSERT SQL text.
- Verification: `GOWORK=off go build ./...` — clean. `grep '\$14::jsonb'` — present.
- Files modified: `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go`
- Deviations: none.

### Step 4 — test: pgxmock regression test pinning the ::jsonb cast [done]
- Added `github.com/pashagolub/pgxmock/v4 v4.9.0` via `go get` + `go mod tidy` (matches
  xstockstrat-portfolio's identical pin).
- Wrote `TestUpsertFundamentals_CastsExtraMetricsToJSONB` in `marketdata_repo_test.go`.
- One implementation fix beyond the spec's literal text: `pgxmock.ExpectExec(...)` defaults to
  expecting **zero** args unless `.WithArgs(...)` is called — the spec's example omitted it,
  causing `expected 0, but got 16 arguments`. Fixed by adding `.WithArgs(anyArgs...)` with 16
  `pgxmock.AnyArg()` matchers (the test only cares about the SQL text/cast, not the specific
  argument values). Mechanical pgxmock API detail, not a design change.
- **Red-before-green (P-06), actually executed**:
  - GREEN (post-Step-2 cast): test passes.
  - RED (temporarily reverted the `::jsonb` cast back to bare `$14`, re-ran the identical test):
    fails with `could not match actual sql: "...VALUES ($1,...,$14,...)..." with expected regexp
    "\$14::jsonb"` — confirms the test genuinely requires the fix.
  - Re-applied the cast; re-ran green — passed again.
- `golangci-lint run --modules-download-mode=mod` — 0 issues. Full suite (`go test ./... -race
  -count=1 -coverprofile=...`) — all packages `ok`. Total coverage 63.3% (`repository` package
  excluded from `COVERPKGS` per spec, as expected).
- Files modified: `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go`,
  `services/xstockstrat-marketdata/go.mod`, `services/xstockstrat-marketdata/go.sum`.
- Deviations: pgxmock `.WithArgs` requirement (mechanical, documented above).

**2 of 4 steps done (2, 4). Steps 1 and 3 blocked on Docker access. Feature status:
implementation-ready → in-progress (NOT code-completed — genuine open verification gap).**

## Session 2026-08-16 — sdd-execute (sequential) — session summary

**Steps this session**: 2, 4 (done); 1, 3 (blocked)
**Progress**: 2 done / 4 total (2 blocked)
**Stopped at**: Steps 1 & 3 — no Docker daemon in this environment
**Next**: In an environment with Docker access, run `/sdd-execute fix-fundamentals-upsert-invalid-json 1` then `... 3` to complete the mandatory repro gate design.md requires, then re-run `/sdd-execute fix-fundamentals-upsert-invalid-json` to close out the feature (advance to code-completed).

Accountability:
- Out-of-scope changes: none
- Open questions / items: **the fix is unverified against the actual reported production error** — it rests on a well-evidenced but explicitly-unconfirmed hypothesis (recon.md, design.md). This is the single most important open item in this whole session's work and must not be lost track of before this fix is treated as done.
- Unaddressed review warnings: none (Track C bug fix, never went through /sdd-review).

## Session 2026-08-16 — sdd-execute (follow-up: the shipped fix did NOT resolve the bug)

- PR #967 (Steps 2 + 4 only — the `::jsonb` cast, `extraJSON` still `[]byte`) merged into
  `main-dev` at commit `57d3424` and deployed to `xstockstrat-staging`. User reported the bug was
  "not fixed" after deploy.
- Verified via DigitalOcean deployment status + fresh log pull: the deployed image tag
  (`57d3424`) is confirmed to be the merge commit (matches the GitHub Actions `deploy-dev.yml` run
  for that exact SHA, `conclusion: success`, completed 10:18:34Z). `xstockstrat-marketdata`
  restarted cleanly (fresh boot log 10:17:53-56Z) and then logged, at 10:20:02Z — **after** the
  fix was live — the **identical** error: `GetFundamentalsMulti: cache upsert failed symbol=UPRO
  error="upsert fundamentals UPRO: ERROR: invalid input syntax for type json (SQLSTATE 22P02)"`.
  This is real, first-party evidence that the merged fix did not work — not a caching/propagation
  artifact.
- **Root cause, corrected**: `extraJSON` was bound as `[]byte`. Inspected the vendored
  `github.com/jackc/pgx/v5@v5.9.2` source directly (`conn.go` `QueryExecMode` doc comments) rather
  than continuing to guess. `QueryExecModeExec`'s doc comment says it "uses the extended protocol
  with text formatted parameters" and explicitly cross-references `QueryExecModeSimpleProtocol`'s
  fuller warning: "`[]byte` values are encoded as PostgreSQL bytea. `string` must be used instead
  for text type values including json and jsonb" — and states `QueryExecModeSimpleProtocol`
  "should have the user application visible behavior as `QueryExecModeExec`." This is pgx's own
  documented confirmation of the exact bug class: a `[]byte` argument is wire-encoded as `bytea`
  regardless of any `::jsonb` cast in the SQL text, because Postgres's `bytea::jsonb` cast path
  goes through `bytea`'s hex-escaped text representation (`bytea_output = hex` is Postgres's
  default), which is never valid JSON syntax — producing this exact SQLSTATE 22P02.
- **Corrected fix**: `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` —
  added `extraJSONText := string(extraJSON)` and bind that (not `extraJSON`) as the `$14`
  argument to `UpsertFundamentals`'s `Exec` call. The `::jsonb` cast from the original fix stays
  (correct, matches repo convention) — it was necessary but not sufficient on its own.
- **Test strengthened**: `TestUpsertFundamentals_CastsExtraMetricsToJSONB` (marketdata_repo_test.go)
  now uses a custom `pgxmock.Argument` matcher (`isStringArg`) on the `extra_metrics` bind
  position specifically, asserting it's a Go `string`. Verified this actually catches the
  regression: reverted the bind back to `extraJSON` ([]byte), confirmed the test fails with
  `matcher repository.isStringArg could not match 13 argument []uint8 - [123 125]` (RED),
  re-applied `extraJSONText`, confirmed green. The prior version of this test (SQL-text-only pin)
  would have passed either way — a real, now-closed coverage gap.
- Full verification: `go build ./...` clean, `golangci-lint run` — 0 issues, full suite
  `go test ./... -race -coverprofile=...` — all packages `ok`, 63.3% total coverage (repository
  package excluded from `COVERPKGS` as before).
- Branch handling: PR #967 had already squash-merged, so per the harness's merged-PR convention,
  reset `claude/commit-135-opportunities-strategies-0xjnxk` to `origin/main-dev` (`git checkout -B
  ... origin/main-dev`) before applying this follow-up fix, rather than stacking on the old
  pre-squash branch history.
- Migrated this feature's lifecycle-status storage to the new `status.md` convention (merged via
  PR #965 into `main-dev` while this feature was in flight, so it predates this feature's
  creation and was never applied to it) — created `status.md` (`in-progress`), removed the
  now-duplicate `**Lifecycle Status**` field from `feature.md` per the updated
  `docs/roadmap/features/CLAUDE.md` convention.
- **Steps 1 & 3 (the mandatory live-DB repro) are STILL blocked** — no Docker daemon in this
  session either. This real-world miss (a fix that passed all available tests but failed in
  production) is exactly the failure mode design.md's mandatory gate was created to prevent — it
  still has not run. The next staging deployment of this corrected fix, and its logs, are the
  closest available substitute for now; a genuine Docker-accessible session should still run the
  actual repro per Step 1/3's instructions when one becomes available.
- Status: in-progress (unchanged) — still 2 of 4 steps done (2, 4, now corrected), 2 blocked (1, 3).
