# Context Log: fix-trading-config-plumbing

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bugs reported via defect reports (Issues disabled):
  - docs/reports/2026-10-19-trading-ibkr-timeout-hardcoded-defect.md — IBKR broker client ignores trading.broker.timeout_ms (SEV-3)
  - docs/reports/2026-10-19-trading-config-accessor-type-mismatch-defect.md — trading reads int-documented config keys with GetFloat (SEV-3)
  - docs/reports/2026-10-19-trading-requires-approval-always-false-defect.md — trading.orders.requires_approval is always persisted false (SEV-3)
  - docs/reports/2026-11-06-trading-broker-paper-env-derived-default-unseedable-defect.md — trading.broker.paper has an environment-derived default a catalog seed cannot express (SEV-2)
- Cluster rationale: all four are xstockstrat-trading config-read / persistence plumbing in the same service files (broker instantiation, config watcher getters, order persistence), so one feature touches them once.
- Severity: SEV-2 (highest; R4)
- Routed to SDD path (Track C); prod-impacting SEV-2 routed to C by operator decision 2026-11-10
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios @AC-1..4), context.md
- Affected services (from reports): xstockstrat-trading, xstockstrat-config
- Root cause hypotheses: see product-spec.md § Root Cause Hypothesis (spot-check: broker.timeout_ms now has a single GetFloat reader at HEAD)
- Recommended design depth: full → `/sdd-design fix-trading-config-plumbing` (rationale: SEV-2 + ≥2 affected services (trading, config) + config-key changes and a getter-coercion design fork)
- Development branch: feature/fix-trading-config-plumbing

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); config-key contract (value_type/default/reader/seed/live) for broker.timeout_ms, order.max_retries, order.retry_delay_ms, broker.paper deferred; migration NNN unpinned; AC-1 'about 2 seconds' imprecise; C-2/C-3 notes (Alpaca unaffected, paper-safety) missing
- Overlap findings: WARN: trading.go shared with 311/312/315; trading.broker.paper coordination with 322; config migration NNN with 322/330
- Recommended design depth: full (trading + config; config seeds; 322 TRADING_MODE coupling)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-13 — sdd-review A1b (demoted-duplicate, interactive)

- sdd-batch preflight flagged a demoted-duplicate match against 277 `fix-ingest-seeded-config-keys` (demoted/canceled, archived 2026-11-04). Routed through /sdd-review A1b interactively.
- Operator decision (2026-11-13): **321 is a re-attempt of 277.** Recorded as "Reactivated as duplicate of demoted feature `fix-ingest-seeded-config-keys`". Status stays `spec-ready` (the full review already passed 2026-11-10; A1b's skip-review path is moot).
- Design must read 277's `## Archive Synthesis` (`docs/roadmap/features/277-fix-ingest-seeded-config-keys/context.md`) as prior art, in particular its demotion reason (scope grew from 5 keys to an 18-key cross-service re-key over four rounds of new blockers) and its config-migration scars: key-only UPDATEs write no audit row; a blind namespace re-key aborts on `config_values_scope_uniq` when twins exist; a PRE_DEPLOY `RAISE` leaves golang-migrate dirty and blocks every deploy; `migration-rerun.sh` runs `up` to head before assertions (needs a dedicated `goto` pass).
- Development branch created: `feature/fix-trading-config-plumbing` (from origin/main-dev).

## Session 2026-11-20 — sdd-design (in progress)

- Phase 0 Recon: wrote recon.md (services: trading, config; consumer surfaces checked: ui, agent — no change). Two product-spec premises are stale at HEAD: the getters no longer return 0 on the other numeric branch (feature 295), and migration 041 already seeds `broker.timeout_ms`, `order.max_retries`, `order.retry_delay_ms` as int. Only `broker.paper` is unseeded.
- Phase 1 Grilling: rounds 1-2 run (full mode); register in debate.md (D-1..D-15, R-1..R-8). No Floor breach.
- **Operator rulings at the round-2 gate (2026-11-20):**
  - **O-1 / D-13 — IBKR request bound: accepted, with a pre-deploy operator action.** Each signed IBKR request is bounded by the live `trading.broker.timeout_ms` instead of the hardcoded 10 s. Before 321 deploys, the operator sets `trading.broker.timeout_ms` to 10000 in both environments. Accepted consequences: slow IBKR calls become uncertain outcomes at the configured bound; an emergency flatten that times out halts the account with the position possibly open until reconciliation; at 10000 every Alpaca call's timeout also becomes 10 s and the Alpaca 429 retry budget is a single attempt.
  - **O-8 / O-11 / D-14 — paper/live source: signed off.** `APPLICATION_ENV` alone decides trading's paper/live; `broker.paper` is seeded per environment (staging true, production false) and becomes a one-edit config-ui row. **C-16 CHANGE approved: 304 @AC-14 is superseded by 321 @AC-4** — `trading.broker.paper` is seeded per environment by the config migration, the `scripts/config-wiring.json` read-unseeded entry is removed, and `check-config-wiring.mjs --final` must report no read-unseeded or STALE line for it.
  - **O-21 / D-15 — proto comment:** fix the stale `TRADING_MODE env` comment at `packages/proto/trading/v1/trading.proto:264` in 321 (comment-only proto step).
  - **Gate decision: run another round** (round 3). The P-06 natural-RED waiver for AC-2 is NOT yet given — it is part of design approval.

## Session 2026-11-20 — sdd-design

- Phase 0 Recon: wrote recon.md (services: trading, config; key reuse patterns: Alpaca's live `Timeout func()` closure; the 054 INSERT-if-absent seed migration).
- Phase 1 Grilling: 3 rounds (full). Chosen approach: IBKR signed requests read `broker.timeout_ms` live with the 10 s stale floor kept; no getter change, an int-row flatten guard test; `requires_approval` bound from the insert-time status; `broker.paper` from `APPLICATION_ENV`, seeded per environment by config migration 056 (provisional); a comment-only proto fix. Rejected: `GetInt` switch, getter coercion, dropping the floor, keeping `broker.paper` unseeded, keeping the `TRADING_MODE` fallback (R-1..R-9 in debate.md).
- **Operator rulings at the round-3 gate (2026-11-20):**
  - **Design approved.**
  - **P-06 waiver for AC-2 granted:** "AC-2 red N/A — no behavior change: since feature 295 `GetFloat` widens an int row, so an int `order.max_retries` row is already honoured at HEAD; characterization test `TestFlattenAndHalt_IntRetryRowsSetAttempts_F321_AC2` added. Discrimination is shown by mutation instead of a natural RED (hardwiring `maxRetries := 3` → 4 submissions vs want 2/6 FAIL; hardwiring `retryDelay` to 500 ms → elapsed FAIL; reverted → PASS)."
  - **D-20 — the pre-deploy action is two edits per environment:** `trading.broker.timeout_ms` = 10000 AND `trading.order_intent.stale_multiplier` = 4.0 (keeps Alpaca 429 retry and pacing at T = 10 s; S = 40 s). Pass condition (stored state, checkable any time): timeout_ms is an int >= 10000 and stale_multiplier >= 4.0 in staging and production, each with a `config.config_audit` row; audit timestamps recorded here; the integration PR stays draft until then.
- Constitution rules touched: C-01, C-05, C-07, C-08, C-09, C-10, C-13, C-14, C-15, C-16, C-18, F-01, F-04, F-07, P-03, P-04, P-06. Floor breaches: none.
- Status: spec-ready → design-approved.

## Open Threads

- [ ] Pre-deploy operator action: staging deployments done and recorded 2026-11-20 (production is out, operator ruling). Re-check the stored values just before the integration PR leaves draft — implementation-spec Step 13.
- [ ] Production first launch: bring `trading` `broker.timeout_ms` to >= 10000 and `order_intent.stale_multiplier` to >= 4.0 before trading goes live there (seeds are 5000 / 3.0) — production launch checklist.
- [ ] Migration 056 is provisional (feature 317's spec also claims 056); regenerate `scripts/config-wiring-stored.json` after each main-dev merge — U4+U5 and integration PR.
- [ ] IBKR call chain (40 s) equals S = 40 s with no margin; conid-lookup timeout leaves the order PENDING — known gap, not widened.
- [ ] Credential poller hardcoded 5 s (`trading.go:2837`); stale stored descriptions (`stale_multiplier`, `broker.timeout_ms`); no DO env-pairing assertion — record as findings in the docs unit.
- [ ] `&config.Config{}` harnesses move LIVE → PAPER under the new fallback — full-suite run in U4+U5.
- [ ] 277 halt condition: stop for an operator re-scope if anything pushes toward rewriting stored descriptions or touching `watchcore.go`.
- [ ] C-16 promotion: 321 `@AC-4` to platform.feature with a "Superseded by @feature-321" comment above 304 `@AC-14` — integration PR.
- [x] /sdd-spec must amend product-spec.md and acceptance.feature per design.md § Spec amendments — done 2026-11-20 (/sdd-spec).
- [ ] impl-spec review to confirm the five spec-time findings in implementation-spec.md § Execution Summary, first of all the deletion of the non-empty-baseline assertion at `scripts/config-wiring.test.mjs:618` — /sdd-review impl-spec.
- [ ] Before Step 6: record which route regenerates `scripts/config-wiring-stored.json` (local scratch Postgres with `migrate` + `psql`, or the `config-wiring-stored` CI artifact); this host has no `migrate` on PATH — /sdd-execute, unit Steps 6–9.

## Session 2026-11-20 — pre-deploy operator action (D-13 / D-16 / D-20), staging

- Applied on the operator's instruction through the agent MCP `set_config` (global scope, attributed to the operator's user; audited in `config.config_audit`):
  - **DO staging** (`xstockstrat_staging`, environment `staging`): `trading`/`broker.timeout_ms` 5000 → **10000** (int) at 2026-11-20T13:59:10Z; `trading`/`order_intent.stale_multiplier` 3.0 → **4.0** (float) at 2026-11-20T13:59:12Z. Read back via `get_config`: 10000 / 4.0.
  - **Homelab staging** (`xstockstrat_homelab_staging`, environment `staging`, a separate config store): the same two edits at 2026-11-20T13:59:38Z and 13:59:39Z.
- **Production: NOT done** — no production agent MCP is connected to this session. D-16's pass condition is therefore met for staging only; the integration PR stays draft until production reads `broker.timeout_ms` >= 10000 and `order_intent.stale_multiplier` >= 4.0 with audit timestamps recorded here.
- Live effect from the edit (321 is not deployed yet): on both staging deployments every Alpaca call's timeout and the T-bounded reconciliation / position-sync polls (all brokers) are now 10 s; S = 40 s; Alpaca 429 budget B = 20 s. IBKR signed requests are unaffected until 321 deploys.

## Session 2026-11-20 — operator ruling: production is out of the pre-deploy action

- Operator (2026-11-20): **leave production out** — production has never been launched, so there is no production config to edit and no live IBKR/Alpaca traffic there. This amends D-13 / D-16 / D-20: the pre-deploy action and its stored-state pass condition apply to the **staging deployments only** (DO staging and homelab staging — both done 2026-11-20, see the previous entry). The integration PR's draft gate is satisfied by the staging record.
- Carried forward as an Open Thread: when production is first launched, its `trading` config must be brought to `broker.timeout_ms` >= 10000 and `order_intent.stale_multiplier` >= 4.0 before trading goes live there (the seeds are 5000 / 3.0).

## Session 2026-11-20 — sdd-spec

- Tree: `feature/fix-trading-config-plumbing@b5756b2 ≡ origin/feature/fix-trading-config-plumbing` (origin/main-dev merged). Trading, proto and scripts are unchanged since recon's `3da4293d`; every cited line was re-read on this tree.
- Generated implementation-spec.md with 13 steps. Status → implementation-ready.
- Amended product-spec.md and acceptance.feature per design.md § Spec amendments (`@AC-1..4` IDs unchanged). product-spec.md gained `## Consumer Surface(s)` (none, internal), `## Config Key Changes` (`trading.broker.paper`, `trading.broker.timeout_ms` — the keys sdd-execute's step-time wiring gate reads), and the staging-only pre-deploy action.
- Step map (D-18): 1+2 IBKR live timeout (one unit) · 3 AC-2 characterization test · 4, 5 `requires_approval` · 6+7+8+9 `broker.paper` fallback + config migration 056 + wiring gate (one unit) · 10+11 proto comment + stubs (one unit) · 12 docs · 13 operator-only stored-state re-check.
- Key codebase findings:
  - **Not in recon or design:** `scripts/config-wiring.test.mjs:618` asserts the committed baseline is non-empty. The `broker.paper` entry is the only finding, so removing it fails `baseline 2 @AC-8`; Step 9 deletes that one assertion. Needs confirming at impl-spec review.
  - Wiring gate prototyped on a scratch copy of `b5756b2` (reader change + two stored rows + entry removed + line 618 deleted): `--final` exits 0 with no `broker.paper` line and the checker tests pass 75/75. With the entry kept: `STALE: config-wiring.json:broker.paper:read-unseeded`. With a new migration file and no regeneration: `STALE-STORED`.
  - AC-2 test prototyped on the same copy: passes at HEAD; `maxRetries := 3` → `submissions = 4, want 2`; `retryDelay` 500 ms → `elapsed 502ms, want < 400ms`.
  - Config migration tail is `055`; no ref carries `056`+; feature 317 also plans `056` (provisional, merge checklist in the spec). `config-heal-dryrun.py` (goto 40/41) and `migration-rerun.py` (computed top) are not affected by a new config migration.
  - No existing test exercises `environmentIsPaper` / `GetTradingEnvironment`; eleven `&config.Config{}` test harnesses move LIVE → PAPER under the new fallback and none asserts LIVE.
  - `buf` and `migrate` are not on this host's PATH; `psql`, `docker`, `go` and `golangci-lint` are.
- Decisions taken at spec time (within the approved design): U1a + U1b are one atomic unit (a scaffold-only commit cannot pass F-05); `callTimeout` lives in `internal/broker/broker.go`; pin rows added for the D-20 stored state (`10000 × 4.0` → S 40 s, B 20 s); the AC-4 trading test is a new file `trading_paper_env_test.go`; migration name `056_trading_broker_paper_per_environment`.

## Session 2026-11-20 — sdd-review impl-spec (advisory)

- Tree: feature/fix-trading-config-plumbing@5c416868 (≡ origin; main-dev fb52065c merged).
- Result: 0 failures, 8 warnings (advisory — did not block). No Floor risk. `@AC-1..4` all covered; atomic units 1+2, 6+7+8+9, 10+11 are symmetric and can pass their own Verification.
- Unresolved ⚠ carried into execution:
  - Step 10: `buf breaking --against …branch=feature/fix-trading-config-plumbing` compares the branch with itself after the commit (vacuous) — run it against `main-dev`; CI's breaking check currently excludes `trading/v1/trading.proto` (`ci.yml:253`), so the local run is the only real check (C-09) — [ ] unaddressed
  - Step 9: replace the deleted `scripts/config-wiring.test.mjs:618` assertion with `assert.ok(Array.isArray(findings), …)` rather than removing it outright; never assert an empty baseline (it is a ratchet later features may refill) — [ ] unaddressed
  - Steps 4/5: add a PARTIALLY_FILLED row to the `requires_approval` table (expect false) — [ ] unaddressed
  - Step 5: say how the "RED before Step 4" run is captured, since Step 4 precedes it (P-06) — [ ] unaddressed
  - Step 3: state the coverage-threshold position in the Verification block (C-08) — [ ] unaddressed
  - Step 8: confirm the stored-JSON regeneration route (scratch Postgres + migrate, or the CI artifact) and re-check `056` before starting (C-07) — [ ] unaddressed
  - Step 13: the grep-only Verification proves a log entry exists, not the stored values; keep the operator read-back of the staging config — [ ] unaddressed
  - Steps 1/2: the RED run uses an uncommitted scaffold; record it in context.md and the PR body (P-06) — [ ] unaddressed
- Overlap findings:
  - **Config migration `056` is claimed by three features** — 321 (`056_trading_broker_paper_per_environment`), 317 (`056_marketdata_bars_miss_backoff`), 314 (`056_mcp_deadline_budget`), each verified on its own branch. Free on main-dev today (tail 055). Whichever merges second and third renumbers to max(main-dev)+1 and regenerates `scripts/config-wiring-stored.json`. No merge-order.md row exists yet.
  - Textual only: `trading.go` with 311/312/315; `trading.proto` with 322 (a different message, ~`:336`, vs 321's `:263-265`); `order_intent.go` with 347 (merged).
  - Not a collision: 330's `055` is on main-dev via #1592 (330 is `in-progress` only for its post-deploy step).

## Session 2026-11-21 — operator ruling on the Step 9/10 review warnings, recorded by the orchestrator (verbatim)

Question (handoff § 3.11): "Feature 321 (fix-trading-config-plumbing): its impl-spec review recorded warnings on Steps 9 and 10 (context.md, commit 6369dc10). Proceed with /sdd-execute for 321 despite those warnings?"

Operator's answer (option selected): "Fix the spec first".
Option text as offered: "Re-spec Steps 9 and 10 to address the warnings, then re-review before execution."

Done by the orchestrator (not an operator quote): the two warnings listed `[ ] unaddressed` in the impl-spec review were addressed in `implementation-spec.md`: Step 9 Instruction 3 now replaces the `findings.length > 0` assertion with `assert.ok(Array.isArray(findings), …)` and forbids asserting an empty baseline; Step 10 Verification runs `buf breaking` against `main-dev` instead of the feature branch (with the ci.yml:253 note). Line anchors were not re-grepped; the BRANCH SYNC step still re-checks them. Remaining: a re-review (`/sdd-review fix-trading-config-plumbing impl-spec`) before `/sdd-execute`.

## Session 2026-11-26 — independent impl-spec re-review (spec-reviewer), recorded by the orchestrator

Verdict: PASS WITH WARNINGS, no blockers (independent `spec-reviewer` subagent, older main-dev checkout). Both 2026-11-21 warnings confirmed addressed; three residual warnings fixed in `implementation-spec.md` the same day: (1) Execution Summary item 1 now matches Step 9 Instruction 3 (replace with `Array.isArray`; the 75/75 prototype used the deletion variant); (2) Step 10's `buf breaking` uses `branch=origin/main-dev`, as CI does (`ci.yml:240`); (3) Step 10's comment-only diff check is `git diff -U0 origin/main-dev -- …` (the worktree diff was vacuous after the commit). Still to re-verify at execute time: config migration `056` is also claimed by 314 and 317 (the merge checklist covers the renumber); anchors on current `main-dev` at BRANCH SYNC.

## Session 2026-11-26 — sdd-execute sequential (sdd-batch-execute)

Up-front confirmation: the operator approved the plan with this record (binding, verbatim):

`{"mainDev":"f802b184b13bd899d858c4b0349a616e9981b9d9","dev":"77d8d2d22d93050479362b3d31624ec57357af5c","specHash":"9cebe140a3fb499953b20743a6cbfc178b39cfd1","directive":"conditional","pending":[1,2,3,4,5,6,7,8,9,10,11,12,13],"mismatches":[{"n":8,"detail":"Migration number 056 is taken: origin/main-dev now has services/xstockstrat-config/migrations/056_analysis_live_only_cycle_max_days.up.sql and .down.sql (feature 366, commits 540f8ff7 and 92769965). The Files paths services/xstockstrat-config/migrations/056_tr"},{"n":12,"detail":"docs/patterns/config-governance.md: the Per-Feature Registered Keys log now starts with feature 366 at :152, and feature 330 has moved to :173. The instruction to add the feature 321 entry 'above the feature-330 entry' would break the newest-first order; it mu"},{"n":1,"detail":"internal/service/trading.go has drifted after the main-dev merge (feature fix-alert-event-targeting #1609); every symbol is present. brokerCallTimeout is at :2637-2644 (spec :2633-2640). instantiateBrokerLocked starts at :3356 (spec :3348), with the IBKR liter"},{"n":3,"detail":"Line drift; the symbols are present. trading.go maxRetries and retryDelay are at :3091-3092 and the loop at :3095 (spec :3083-3084, :3087), so the mutation targets move. trading_flatten_rejection_test.go changed in the merge (+3 lines): TestFlattenAndHalt_Unce"},{"n":6,"detail":"Line drift in trading.go; the symbols are present. environmentIsPaper is at :2834-2838 (spec :2828-2832). Its callers are :1080, :2709, :2743 and :2823 (spec :1080, :2705, :2739, :2819), and GetTradingEnvironment is at :2821 (spec :2817). resolveTradingMode is"},{"n":13,"detail":"The scripts/config-wiring-stored.json broker.timeout_ms description is now at :4546 (spec :4522). The context.md pre-deploy records exist (:43, :55, :73, :81), and the configServiceImpl.ts SetConfig insert is at about :841, inside the cited :831-845. The Files"}]}`

- Merged `origin/main-dev` `f802b184` into the feature branch (`e08a3b9e`; resolver clean, ledger-guard clean).
- Re-spec commits (`git log --first-parent origin/main-dev..HEAD`): `52ca97d6` respec(fix-trading-config-plumbing): align steps 8,12,1,3,6,13 with current codebase.
  - Step 8: the migration pair is now `057_trading_broker_paper_per_environment` (`056` is feature 366's; no `origin` ref carries `057`+ on 2026-11-26).
  - Step 12: the feature 321 log entry goes above feature 366 (`:152`), keeping newest first.
  - Steps 1, 3, 6, 13: line anchors only; every symbol is present. Re-grepped `environmentIsPaper` is `:2832-2836` (func `:2834`), not the record's `:2834-2838`.
- Tooling (detection only): go1.27 ✓ · golangci-lint v2.5.0 on PATH (v2.14.0 pinned: `go install` per step) · pnpm 9.15.9 ✓ · node v22 (pinned 24) · uv ✓ · ruff ✓ · buf ✗ (Docker codegen route; daemon not running, start per tooling-setup) · hook check hook=0.
- Status → `in-progress` (feature.md row and status.md).

```sdd-batch-setup
{"mainDev":"f802b184b13bd899d858c4b0349a616e9981b9d9","date":"2026-11-26"}
```

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), unit Steps 1+2

- Tree: detached at `origin/feature/fix-trading-config-plumbing@360349ea`. Discovery re-verified every Step 1/2 anchor by symbol; trading.go lines: `brokerCallTimeout` :2638, `ibkrTiming` :2653 (literal `10000` :2663), `instantiateBrokerLocked` :3356.
- Tooling (steps 1+2): go1.27 ✓ · golangci-lint ⬇ v2.14.0 (built with go1.27.0, `/root/go/bin`; prepended to PATH for the Verification runs — `/usr/local/bin` still holds v2.5.0) · hook check hook=0.

### Step 1 — service: IBKR signed requests read `broker.timeout_ms` live [done]
- Atomic unit Steps 1+2. `callTimeout` (broker.go) is the shared fallback; Alpaca `timeout()` and IBKR `sendSigned` both use it. `IBKRRequestTimeout` deleted, IBKR `http.Client{}` has no fixed timeout, `send` (handshake) unchanged (R-7). `IBKRDefaultHandshakeTimeout` is the stale floor. `brokerTimeout` + `ibkrClientConfig` wire `Timeout: s.brokerTimeout` for both brokers.
- Files modified: `services/xstockstrat-trading/internal/broker/{broker.go,alpaca.go,ibkr.go,ibkr_session.go}`, `services/xstockstrat-trading/internal/service/{trading.go,order_intent.go}`
- Deviations: none
- TDD: RED/GREEN recorded under Step 2 (one cycle for the unit). Config-key wiring gate (step-time, `--declared-from product-spec.md`): exit=0, only `PENDING: services/xstockstrat-trading/internal/service/trading.go:broker.paper:read-unseeded` (Steps 6–9 scope).

### Step 2 — test: IBKR live timeout, shared fallback, floor and budget pins (AC-1) [done]
- Atomic unit Steps 1+2. Added the seven F321 tests and the D-17/D-20 pin rows; `ibkrAuthService` now builds from `svc.ibkrClientConfig`; the rate-limit harness uses `h.svc.brokerTimeout`; `TestStaleThreshold_UsesLiveConfigDefaults` reads `broker.IBKRDefaultHandshakeTimeout`.
- Files modified: `services/xstockstrat-trading/internal/broker/{ibkr_do_test.go,ibkr_session_internal_test.go}`, `services/xstockstrat-trading/internal/service/{trading_ibkr_auth_test.go,trading_rate_limit_test.go,order_intent_test.go}`
- Deviations: none
- AC-1 red (uncommitted scaffold, P-06): `TestCallTimeout_F321` "nil: callTimeout = 0s, want 5s"; `TestIBKRSignedRequest_BoundedByLiveTimeout_F321_AC1` "SubmitOrder returned after 10.015798976s, want under 3s"; `TestIBKRSignedRequest_TimeoutChangeAppliesWithoutRebuild_F321_AC1` "err = <nil>, want a timeout"; `TestIBKRClientConfig_WiresLiveBrokerTimeout_F321_AC1` "ValidateCredentials returned after 10.010744918s, want under 3s"; `TestBrokerTimeout_IntRow_F321` "int row 10000: brokerTimeout = 0s, want 10s" → green: all pass. Item 3 (R-7 guard) green on the scaffold as specced; discrimination by mutation: a `callTimeout` deadline inside `send` → FAIL "ibkr handshake: live_session_token: … context deadline exceeded"; reverted → PASS.
- Green: selected run `ok internal/broker`, `ok internal/service` (39 tests PASS, 0 FAIL in the verbose re-run); full suite all `ok`, coverage `total: 85.0%` (>= 40%); `golangci-lint` v2.14.0 `0 issues.`; C-13 declaration count `3`.
- Fixture note: the first RED run deadlocked in cleanup (the held order POST never drained its body, so the server never saw the client hang up, and the release channel closed after `srv.Close`); the hold now drains the body and its cleanup is registered after the client.

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), Step 3

- Tree: detached at `origin/feature/fix-trading-config-plumbing@7463d4c3`. Discovery: `maxRetries`/`retryDelay` at `trading.go:3095-3096`, loop `:3099` (spec `:3091-3092`/`:3095`, +4 drift after Steps 1+2; symbols unchanged); `GetFloat` `watchcore.go:406`; `snapshotInts` `trading_ibkr_auth_test.go:120`; harness `trading_flatten_rejection_test.go:99-131`, `errBuyingPower` `:133`.
- Tooling (step 3): go1.27 ✓ · golangci-lint ✓ v2.14.0 (`/root/go/bin`, built with go1.27.0) · hook check hook=0. Config-key wiring gate: not applicable (test-only; `order.max_retries` is not in product-spec `## Config Key Changes`).

### Step 3 — test: an int `order.max_retries` row sets the flatten's attempts (AC-2) [done]
- Added `TestFlattenAndHalt_IntRetryRowsSetAttempts_F321_AC2` (int rows `max_retries` 1 → 2 submissions, 5 → 6; `retry_delay_ms` 10 → elapsed < 400 ms; account halted), reusing `snapshotInts` and `errBuyingPower` (C-13). No production change.
- Files modified: `services/xstockstrat-trading/internal/service/trading_flatten_rejection_test.go`
- Deviations: none
- TDD: AC-2 red N/A — no behavior change: since feature 295 `GetFloat` widens an int row, so an int `order.max_retries` row is already honoured at HEAD; characterization test `TestFlattenAndHalt_IntRetryRowsSetAttempts_F321_AC2` added. Discrimination shown by mutation: hardwiring `maxRetries := 3` → "max_retries int 1: submissions = 4, want 2" / "int 5: submissions = 4, want 6" FAIL; hardwiring `retryDelay := 500 * time.Millisecond` → "max_retries int 1: elapsed 501.68131ms, want < 400ms" FAIL; both reverted → PASS.
- Green: `ok  github.com/xstockstrat/trading/internal/service 7.638s`; `git diff --stat -- internal/service/trading.go` empty; `golangci-lint` `0 issues.`; verbose re-run 8 `TestFlattenAndHalt*` PASS incl. `--- PASS: TestFlattenAndHalt_IntRetryRowsSetAttempts_F321_AC2 (0.07s)`. Coverage: test-only change in `internal/service` (excluded package), no threshold applies.

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), Step 4

- Tree: detached at `origin/feature/fix-trading-config-plumbing@0053916b`. Discovery: `UpsertOrder` `trading_repo.go:53`, column list `:63-69` (`requires_approval` `$17`), `DO UPDATE SET` `:77-86` (no `requires_approval`), literal `false` `:93`; `trading.go` approval decision `:588` (spec `:586`, +2 drift), `Status: orderStatus` `:669`, first insert `:694`, approval return `:703`; column `001_orders_hypertable.up.sql:24`.
- Tooling (step 4): go1.27 ✓ · golangci-lint ✓ v2.14.0 (`/root/go/bin`; lint is Step 5's Verification) · hook check hook=0. Config-key wiring gate: not applicable (no config key touched).

### Step 4 — service: bind `requires_approval` from the insert-time status [done]
- `UpsertOrder` binds `$17` as `o.Status == ORDER_STATUS_PENDING_APPROVAL` instead of `false`, with a one-line constraint comment (ON CONFLICT never updates the column). No signature, call-site, migration or proto change.
- Files modified: `services/xstockstrat-trading/internal/repository/trading_repo.go`
- Deviations: RED captured with a transient, reverted probe test (Deviation Log "Step 4 — RED captured…").
- TDD: red (transient `TestTransientStep4RedProbe`, not committed): "argument 16 expected [bool - true] does not match actual [bool - false]", `FAIL github.com/xstockstrat/trading/internal/repository` → green: `ok github.com/xstockstrat/trading/internal/repository`. Final Verification after the probe revert: `:94` bind grep hit, `DO UPDATE SET` count `0`, `ok internal/repository`, `ok internal/service`, exit=0. Excluded packages — no coverage threshold. AC-3 coverage lands in Step 5; impl-spec warning "add a PARTIALLY_FILLED row (expect false)" stays for Step 5.
