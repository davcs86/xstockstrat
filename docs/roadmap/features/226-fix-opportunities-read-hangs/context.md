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
