# Context Log: fix-opportunities-read-hangs

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-14 (/sdd-triage)

- Bug recorded as `docs/reports/2026-10-14-opportunities-read-hangs-defect.md` (Issues disabled), found while
  attempting feature 215 Step 26's staging measurement.
- Severity: SEV-2 (dev observed). Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (AC-1..4 regression scenarios), context.md.
- Affected services: xstockstrat-agent, xstockstrat-analysis, xstockstrat-marketdata.
- Root cause hypothesis: no deadline at any hop and marketdata discards its errors (confirmed in code). The stalling
  dependency is unconfirmed: either the saturated shared DB (load 7–9 on 1 vCPU) or marketdata/Alpaca.
- Operator decision (2026-10-14): fix = deadlines + degrade-to-unenriched + log dropped errors + bounded pool acquires
  ("option 3"). DB resize and the OTel export failure are out of scope.
- **Production exposure:** `main` carries the same code (2026-10-14 promotion), and production shares the same
  saturated cluster. Not observed in production, so not escalated to Track A; noted for the operator.
- Recommended design depth: full → `/sdd-design fix-opportunities-read-hangs` (rationale: 3 affected services).
- Development branch: feature/fix-opportunities-read-hangs.

## Session 2026-10-14 (/sdd-design — round-cap override)

- Rounds 1–5 ran in full mode. Round 5 returned APPROVE WITH FIXES and the fixes were applied (ef54e88a, de432f0d).
- **Operator override (2026-10-14):** at the round-5 approval gate, the operator chose "Do another round, override cap".
  That is explicit sign-off to exceed the 5-round full-mode cap, recorded here per the Commandment override rule.
  Round 6 is a whole-document adversarial re-review of the post-fix design.md.

### Operator decisions recorded during the design debate (2026-10-14)

- **D1** (round-1 gate): one request-scoped DB budget, with `pool.acquire(timeout=remaining)`, a short read transaction carrying `SET LOCAL statement_timeout = <remaining ms>`, and a bounded `pool.release`. Only transient DB errors become UNAVAILABLE; the type and message are always logged.
- **D2** (round-1 gate): **seeding waiver.** The new keys are unseeded, which consciously deviates from feature 184's `analysis.opportunity.*` seeding convention.
- **D3** (round-1 gate): the AC-4 proof runs against a real local Postgres binary, test-scoped, with no long-running container.
- **D4** (round-2 gate): 57P01/57P02/57P03 are transient (UNAVAILABLE).
- **Round 6 (operator cap override):** APPROVE WITH FIXES, with no Floor breach and no C-16 regression. All 12 text fixes were applied:
  - AC-2 reachability (the test uses an insecure in-process channel and asserts the handler was entered);
  - red-step hang guards;
  - AC-1/AC-4 Gherkin wording aligned to the design;
  - the D1–D4 record;
  - the worst case is now B+3.05+E;
  - G4/G7/G10 test placement.
- **Design approved (2026-10-14):** the operator approved the round-6 design, and the status moved draft → design-approved. Open risks accepted as documented in design.md § Open Risks:
  - a PgBouncer BEGIN/COMMIT stall is bounded only by the B+2 backstop, at the cost of a reconnect.
  Next: `/sdd-spec`.

## Session 2026-10-14 — sdd-spec

- Generated `implementation-spec.md` with 13 steps (6 service/test pairs, plus the `local_pg` infra step and the docs/teardown step). Status `design-approved` → `implementation-ready`.
- Coverage: AC-1 → Step 8, AC-2 → Step 12, AC-3 → Step 4, AC-4 → Step 10.
- Key codebase findings:
  - **Evidence baseline is `origin/main-dev` @ `08d63011`, not this branch.** The branch is one commit behind main-dev. That commit (feature 215) rewrote `servicer.py` (+647 lines) and touched `opportunities.py`, analysis `tests/conftest.py`, `test_analysis_servicer.py`, agent `client.py`/`tools.py`, and marketdata `marketdata_service.go`. design.md line numbers are therefore stale:
    - `ListOpportunities` is now `servicer.py:4490-4635`, not `:4178`.
    - `_enrich_opportunities_live` is `:4637-4703`.
    - `owner_scoped` is `:462-475`.
    - `BatchGetLatestPrice` is `marketdata_service.go:730-807`.
    - The agent tool is `tools.py:1509-1546`; `_extract_policy` is `:2338`.

    `/sdd-execute` BRANCH SYNC must merge main-dev before Step 1.
  - Feature 215 added a `symbol=req_symbol` kwarg to both `opportunities_repo.read` calls in the handler. `_read_opportunity_queue` must forward it.
  - There are 19 (not 18) `ListOpportunities` call sites in `test_analysis_servicer.py`, plus 3 in `test_opportunity_compute_state.py`, for the G4 parametrization.
  - `intGetter` does not exist in marketdata. Step 3 creates it beside `fundamentalsConfig` (`:101-106`). Existing tests build `&MarketDataService{…}` literals with a nil cfg, so the nil fallback is load-bearing.
  - There is no in-process `grpc.aio.server` harness in agent tests. Step 12 creates the first one.
  - The local sandbox has PostgreSQL 16 binaries (`/usr/lib/postgresql/16/bin`) and a `postgres` user, so `local_pg` can run here via `runuser`.
- One addition beyond design §7, flagged in Step 13: `docs/runbooks/mcp-tools.md` (`:1026` sparkline bullet, `:1045` Errors line), for parity with the `list_opportunities` docstring change. The agent reviewer focus and C-10 require it.

## Session 2026-10-14 — sdd-review impl-spec (advisory)

- Result: 1 advisory failure and 4 warnings (advisory, did not block). Floor: an F-08 risk in Step 8, not a breach.
- Evidence baseline was verified against the feature-215 tree (post-215 lines match the spec).
- Unresolved ✗ / ⚠ carried into execution:
  - Step 8: the shared G4 pool-mode helper (FakePool, factories, per-FakeConn order/release assertion) has 2 consumer files. C-13 puts it in `tests/conftest.py`, which is not in Step 8 Files (F-08 risk). — [x] resolved pre-execution (spec patched, operator choice 2026-10-14)
  - Step 8: in pool mode, `_state_repo_factory(bc)` must return None when the test's `_opportunity_compute_state_repo` is None. — [x] resolved pre-execution (spec patched, operator choice 2026-10-14)
  - Step 5: bare `1.0` / `0.05` literals in `_rollback_then_release` (C-18, F-07-adjacent). Name them, or reuse `_RELEASE_TIMEOUT_S`. — [x] resolved pre-execution (spec patched, operator choice 2026-10-14)
  - Step 9: Verification has no coverage threshold and no full-suite run after the conftest edit. — [x] resolved pre-execution (spec patched, operator choice 2026-10-14)
  - Step 3: join `<-done` only when the prevClose goroutine was started. Step 4 and Step 12: RED is structural before the paired code step; use the skeleton-first approach (P-06). The patched `_agent_policy` must be async. — [x] resolved pre-execution (spec patched, operator choice 2026-10-14)
  - Step 10: build the real servicer via `from tests.test_analysis_servicer import make_servicer` (precedent: test_opportunity_refresh.py:15). Step 9: document `XSTOCKSTRAT_PG_BIN` in analysis CLAUDE.md § Running Tests. — [x] resolved pre-execution (spec patched, operator choice 2026-10-14)
- Overlap findings: none (CLEAN). 215 is merged; its only open item is the Step 26 measurement, which changes no code.

## Session 2026-10-15 — sdd-execute sequential (entry)

- The operator agreed to sequential mode and approved the 13-step plan. No re-spec: origin/main-dev @ 08d63011 was merged
  into the branch (5b7943ea), and the spec's anchors match it.
- Tooling setup (steps 1–13): go1.27.0 ✓ · golangci-lint v2.14.0 ✓ (the CI version, /tmp/claude-0/gl-v2.14.0; the
  /usr/local/bin v2.5.0 cannot read Go 1.27 export data) · uv ✓ (analysis and agent synced) · ruff/pytest ✓ (uv) ·
  pnpm 9.15.9 ✓ with config deps installed · node v22.22.0 (pinned 24; CI runs 24) · PostgreSQL 16 binaries ✓
  (test-scoped, D3).

### Step 1 — Write-bound the four new timeout keys in `SCALAR_BOUNDS_REGISTRY` [done]

Appended the four full-dotted timeout keys with their design §5 bounds and a 2-line constraint comment; unseeded (D2), `lookupScalarBounds` unchanged.
- Files modified: `services/xstockstrat-config/src/grpc/configServiceImpl.ts`
- Deviations: none
- TDD red: `pnpm test` with Step 2's cases before the registry entries → 9 fail (e.g. "999 must be rejected" for `opportunity.read_db_budget_ms`). Green: `pnpm run test:coverage` → 150/150 pass, lines 84.21%; `pnpm run lint` 0 errors. Node v22 locally (CI 24).

### Step 2 — Bounds tests for the four keys (G8) [done]

Added a feature-226 table over both key-column forms of every key (min/max accepted reach INSERT; min−1/max+1 rejected `INVALID_ARGUMENT` with the `[min, max]` message and no INSERT), plus an `intVal` case for the float agent key; `setConfig` gained an optional `namespace` arg defaulting to `NS`. Full-dotted marketdata form added alongside the specced stripped one.
- Files modified: `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts`
- Deviations: none
- TDD red (before Step 1): 9 fail — every out-of-range case accepted. Green: `pnpm run test:coverage && pnpm run lint` → 150/150, c8 lines 84.21% (≥40), lint 0 errors.

### Step 3 — marketdata `BatchGetLatestPrice`, a detached budget plus logs for every dropped error [done]

The singleflight closure now runs on `context.WithTimeout(context.WithoutCancel(ctx), resolveBatchPriceBudget(s.budgetCfg))`, starts prevClose concurrently (joined only when started), and logs every formerly dropped error (source lookup, multi-fetch, budget-exhausted skip, aggregate per-symbol-incomplete, previous-close); new `intGetter`/`prevCloseReader` seams are set in the constructor only when non-nil.
- Files modified: `services/xstockstrat-marketdata/internal/service/marketdata_service.go`
- Deviations: golangci-lint v2.14.0 binary substituted for the sandbox's v2.5.0 (Deviation Log, CI-equivalent fallback)
- TDD red (skeleton-first per Step 4 instr. 0: seams/fields + a `resolveBatchPriceBudget` stub returning 2500ms, unused): `go test ./internal/service/ -race -run 'BatchGetLatestPrice|ResolveBatchPriceBudget'` → 8 FAIL (AC-3 "expected the multi-symbol fetch failure WARN, got []"; hang and G10 tripped the 5s guard; resolver "2.5s, want 50ms"). Green: same run → all 11 PASS; `go build` ok; golangci-lint 0 issues.

### Step 4 — marketdata AC-3, hang/budget, prevClose concurrency (G10), resolver [done]

Extended `fakeBatchPriceSource` (ctx-honouring, injectable multi-fetch error/block/gate, `GetLatestTrade`), added `recordingWarnHandler`, `fakeIntGetter`, `fakePrevCloseReader` and a 5s goroutine/select guard, plus AC-3, hang, incomplete-record, source-lookup, prevClose, G10, detached-cancel and resolver tests. Fakes stay inline (C-13, one consumer).
- Files modified: `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go`
- Deviations: none (golangci-lint substitution as Step 3)
- TDD: AC-3 red: "expected the multi-symbol fetch failure WARN, got []" → green: PASS (red/green detail in Step 3 entry). Verification: `go test ./... -race -count=1 -coverpkg=…` all ok, total 71.0% (≥40); golangci-lint 0 issues.

### Step 5 — analysis `read_budget.py`, the request-scoped DB budget primitive [done]

Created the module per design §1: the four named constants, D4 `_TRANSIENT`/`_NOT_TRANSIENT` + `is_transient_db_error`, `BudgetedConn` (`_arm` re-arms `SET LOCAL statement_timeout` or raises `TimeoutError` with no statement), `budgeted_read` (backstop over acquire→BEGIN→yield→COMMIT only, log-before-await, guarded rollback-or-terminate, bare re-raise, bounded success release) and `_rollback_then_release` (shared 1.0s window, 0.05s release floor). No servicer wiring.
- Files modified: `services/xstockstrat-analysis/app/repositories/read_budget.py` (new)
- Deviations: none
- TDD: the paired behavioral test is Step 6 (later agent). Red here is the throwaway Verification import with the module absent → `ModuleNotFoundError: No module named 'app.repositories.read_budget'`; green: import ok, `ruff check` all passed, `ruff format --check` 110 files formatted. A throwaway (uncommitted) fake-driven smoke also showed: success → BEGIN/SET LOCAL/COMMIT + 1 release; stalls at BEGIN/fetch/COMMIT → `TimeoutError` (transient) + terminate=1; body `QueryCanceledError` → ROLLBACK + release, terminate=0.

### Step 6 — `test_read_budget.py` (G1, G2 unit, G5, G7, classification) and the shared fakes [done]

Added the shared `FakeTx`/`FakeConn`/`FakePool`/`bc_routed` fakes to `tests/conftest.py` (per-conn `log` incl. "release", stall/raise injection per stage, detached mode; `bc_routed(None)` yields a factory returning `None`) and 36 unit tests over success order, G1, G2, G5 (4 stall stages), external cancel, G7 (identity, log-before-rollback, detached, terminate/rollback raising, defensive closed branch), H5 and classification.
- Files modified: `services/xstockstrat-analysis/tests/conftest.py`, `services/xstockstrat-analysis/tests/test_read_budget.py` (new)
- Deviations: none. `bc_routed(repo)` is the factory itself (`bc -> wrapper`), so Step 8 assigns `svc._opps_repo_factory = bc_routed(repo)`.
- TDD red (Step 5 code exists, so behavioral red against a stub): temporarily replaced `read_budget.py` with a naive unbudgeted stand-in exposing the same names (plain `acquire()`, no SET LOCAL/backstop, rollback+release on any error, `is_transient_db_error → False`), ran `uv run pytest tests/test_read_budget.py -q` → `28 failed, 8 passed` (G5 stalls tripped the 10s hang guard; e.g. "cleanup after begin skipped/failed (InterfaceError" absent), then restored via `git checkout` (never committed). Green: `36 passed`; full `pytest --cov=app --cov-fail-under=40` → 1181 passed, 87.88%; ruff check/format clean.

### Step 7 — `ListOpportunities` DB phase under the budget, kicks after release, enrichment deadline [done]

The DB phase moved into `_read_opportunity_queue` (sequential statements, `symbol=req_symbol` forwarded to both reads, G3 counter read at the `compute_state.get` instant) filling a new `_OpportunityQueueRead` dataclass; the pool path runs it under `budgeted_read` via the new `_opps_repo_factory`/`_state_repo_factory`, kicks fire in the `finally` after release, transient errors abort `UNAVAILABLE` (outside the try) and others re-raise with an error log; the enrichment is wrapped in `asyncio.wait_for(…, enrich_ms/1000)` with the typed log. `@owner_scoped` and the no-DB early return are unchanged.
- Files modified: `services/xstockstrat-analysis/app/handlers/servicer.py`
- Deviations: none. Defaults are named module constants `_DEFAULT_OPP_READ_DB_BUDGET_MS = 20000` / `_DEFAULT_OPP_LIVE_ENRICH_TIMEOUT_MS = 3000` (each used twice: config default + ≤0 fallback).
- TDD red (Step 8 tests written first, run on the pre-Step-7 tree): `uv run pytest tests/test_list_opportunities_deadlines.py tests/test_analysis_servicer.py tests/test_opportunity_compute_state.py -q` → `81 failed, 342 passed` (57× "expected one budgeted read connection, got 0" in pool mode; AC-1 tripped the 10s hang guard; G5/G7/classification "abort not awaited"). Green: same command → `423 passed`; Verification greps all hit; ruff clean.

### Step 8 — handler tests (AC-1, G3, G4, G5, G6 unit, G7, H5, O8, classification) [done]

New `test_list_opportunities_deadlines.py` (AC-1, G3 on both paths, G5 ×4 stages, G6 cancel, G7 lost connection, H5, transient ×10 / non-transient ×3 classification, compute_state `TimeoutError` → one kick + UNAVAILABLE, O8 float/negative, identity gate before any acquire). G4: a parametrized `read_path` fixture plus `assert_budgeted_read_order` in conftest; pool mode installs a shared request-tracking `FakePool`, routes the test's own repos through `bc_routed` (state factory → `None` when the state repo is `None`), asserts per request exactly one acquired conn with the BEGIN→(SET LOCAL→stmt)+→COMMIT→release order (nᵢ ≤ budget, non-increasing), and asserts that conn is released at enrichment and at each kick (per-request via a ContextVar, not a global `in_use==0`).
- Files modified: `services/xstockstrat-analysis/tests/test_list_opportunities_deadlines.py` (new), `tests/test_analysis_servicer.py`, `tests/test_opportunity_compute_state.py`, `tests/conftest.py`
- Deviations: none. G4 marks every test that reaches `ListOpportunities` (found by instrumenting a full run: 52 tests in `test_analysis_servicer.py` covering all 19 call sites, two of which sit in the shared `_list_opps` helper, plus the 2 tests holding the 3 call sites in `test_opportunity_compute_state.py`); class-level marks on 4 classes (one non-calling test, `test_drain_source_weights_maps_and_is_best_effort`, is thereby also run twice, harmlessly), method-level on 7. The `owner_scoped_completeness`/`unreadable_formula` callers are outside the step's Files and stay unparametrized.
- TDD red/green: see Step 7 (`81 failed, 342 passed` → `423 passed`). Verification: the three files → 423 passed; full `pytest --cov=app --cov-fail-under=40` → 1269 passed, 88.06%; ruff clean; the conftest grep hits `FakeConn, FakePool, bc_routed`.

### Step 9 — the `local_pg` fixture, the `real_pg` marker, and the CI PostgreSQL step (D3) [done]

Added the session-scoped `local_pg` fixture (binary discovery `$XSTOCKSTRAT_PG_BIN` → `pg_ctl` on PATH → newest `/usr/lib/postgresql/*/bin` → Homebrew; `mkdtemp(dir="/tmp")`; `runuser -u postgres --` when root; `initdb -U postgres -A trust --no-sync`; Unix-socket-only `pg_ctl -w start` with `fsync=off`; finalizer `-m immediate stop` + `rmtree`; skip locally / fail under `CI=true`), the `real_pg` marker, and the guarded `install postgresql (analysis real_pg tests)` CI step.
- Files modified: `services/xstockstrat-analysis/tests/conftest.py`, `services/xstockstrat-analysis/pyproject.toml`, `.github/workflows/ci.yml`
- Deviations: none. `initdb -U postgres` added so the DSN's `user=postgres` also holds on the non-root CI runner (whose default superuser would be `runner`).
- TDD: N/A (infrastructure; exercised by Step 10). A throwaway, uncommitted smoke test (`SELECT 1` via `local_pg`) passed in 1.1s, leaving no `/tmp/xss-pg-*` dir or postgres process. Verification: `pytest --markers` lists `real_pg`; ci.yml grep hits `:392`; full `pytest --cov=app --cov-fail-under=40` → 1269 passed, 88.06%; ruff clean.

### Step 10 — real-Postgres proofs (AC-4, G2, F2, G6) [done]

New `test_read_budget_real_pg.py` (module-level `real_pg` mark, `local_pg` DSN, pools with `statement_cache_size=0`, every call hang-guarded, pools closed in `finally`): AC-4 drives the real servicer (`make_servicer`, `svc._db_pool = pool`, real repos, `read_db_budget_ms=300` via a `_StubWatcher` snapshot) against a held min=max=2 pool → UNAVAILABLE in <0.8s, "failed at acquire (TimeoutError", terminate spy untouched, held conns open, headerless → UNAUTHENTICATED; G2 `pg_sleep(5)` under 300ms → `QueryCanceledError`, no asyncpg "Resetting connection…" record, same pid, `statement_timeout` '0'; F2 no-reset `connection_class` → '0' on the same pid plus the `SET statement_timeout = 1234` negative control → '1234ms'; G6 outer `asyncio.timeout(0.3)` over the whole block → `TimeoutError` <1s, new pid, '0'.
- Files modified: `services/xstockstrat-analysis/tests/test_read_budget_real_pg.py` (new)
- Deviations: none
- TDD red (pre-fix tree, temporarily restored and never committed: `servicer.py` from c8cb05d5 and the naive unbudgeted `read_budget` stand-in from Step 6, with commit-before-release corrected in the stub): `uv run pytest -m real_pg -q tests/test_read_budget_real_pg.py` → `3 failed, 1 passed` (AC-4 hit the 10s hang guard, `TimeoutError`; G2 "DID NOT RAISE QueryCanceledError"; G6 "assert (3749 != 3749)", same pid reused). F2 stays green on the stub by construction (no SET LOCAL is sent, so nothing can leak); its negative control is what proves it can detect a leak. Restored via `git checkout`. Green: `4 passed` (not skipped) in 2.0s; full `pytest --cov=app --cov-fail-under=40` → 1273 passed, 88.08%; ruff clean.

### Step 11 — agent `list_opportunities` deadline and explicit error (consumer surface) [done]

`client.list_opportunities` gained `timeout: float | None = None` passed to `stub.ListOpportunities` (header trio unchanged); `_extract_policy` → `_agent_policy` (definition + 4 call sites, generalized docstring and log line); `_POLICY_READ_TIMEOUT_S = 3.0`; the tool reads `opportunities.read_timeout_seconds` under `asyncio.wait_for(…, _POLICY_READ_TIMEOUT_S)` (timeout → warning + 40.0; non-finite or ≤ 0 → 40.0) and maps errors with `_grpc_error_message(e, deadline_s=timeout_s)`, whose new `DEADLINE_EXCEEDED` branch names the deadline (no "within …" clause when `deadline_s` is None); the sparkline phrase was dropped from the tool docstring (one-line edit, the rest of the paragraph's wrap kept).
- Files modified: `services/xstockstrat-agent/app/client.py`, `services/xstockstrat-agent/app/tools.py`
- Deviations: none
- TDD (Step 12 tests written first, run on the pre-Step-11 tree with the `_agent_policy` / `_POLICY_READ_TIMEOUT_S` patches temporarily set `raising=False`, never committed): `uv run pytest tests/test_list_opportunities_deadline.py tests/test_tools.py -q -k "deadline or policy"` → `9 failed` — AC-2 red: the 10s hang guard fired (`TimeoutError`) with the in-process handler-entered event **set** (probe printed `entered.is_set() = True`); policy fallbacks `KeyError: 'timeout'`; mapper `TypeError: unexpected keyword argument 'deadline_s'` and `'deadline exceeded' not in 'Deadline Exceeded'`. Green: same files (unmodified test, `raising=True`) → `119 passed` (AC-2 0.28s). Verification: `ruff check`/`format --check` clean; `_extract_policy` grep empty; `_agent_policy`/`_POLICY_READ_TIMEOUT_S`/`DEADLINE_EXCEEDED`/`timeout=timeout` greps hit; `metadata=_metadata(("x-user-id", user_id))` still on the `ListOpportunities` call (`client.py:871`).
