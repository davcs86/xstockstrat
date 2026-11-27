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

- [x] Pre-deploy operator action: staging deployments done and recorded 2026-11-20 (production is out, operator ruling). Re-check the stored values just before the integration PR leaves draft — implementation-spec Step 13. Done 2026-11-27 (Step 13 entry below).
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

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), Step 5

- Tree: detached at `origin/feature/fix-trading-config-plumbing@2ffd368d`. Discovery: `upsertArgs` `trading_repo_test.go:274`, `TestUpsertOrder_PersistsFeesPresence` `:284`; `rowCapture` `trading_offline_test.go:1602`, `upsertRequiresApprovalArg` `:1609`, `expectUpsert` `:1652`; `activeSnapshot`/`auditSvc`/`placeReq` `trading_order_state_audit_test.go:105/117/128`; bind `trading_repo.go:94` (Step 4 done); approval decision `trading.go:586-589`, insert `:694`, approval return `:703-710`. `trading_order_state_audit_test.go` had no `pgxmock` import (module already requires it) — added.
- Tooling (step 5): go1.27 ✓ · golangci-lint ✓ v2.14.0 (`/root/go/bin`, prepended to PATH for the runs) · hook check hook=0. Config-key wiring gate: not applicable (test-only; the approval keys are not in product-spec `## Config Key Changes`).

### Step 5 — test: `requires_approval` bind (AC-3) [done]
- Added `TestUpsertOrder_RequiresApprovalFromStatus_F321_AC3` (PENDING_APPROVAL → true with the full `DO UPDATE SET` list pinned to the end of the statement, NEW → false, FILLED → false; arg index 16 pinned) and `TestPlaceOrder_AboveApprovalThreshold_PersistsRequiresApproval_F321_AC3` (qty 21 over a float 20 threshold → `PENDING_APPROVAL`, captured `requires_approval` true, broker not called, two ledger events, expectations met), reusing `rowCapture`, `upsertRequiresApprovalArg`, `auditSvc`, `placeReq` (C-13 count `2`).
- Files modified: `services/xstockstrat-trading/internal/repository/trading_repo_test.go`, `services/xstockstrat-trading/internal/service/trading_order_state_audit_test.go`
- Deviations: RED captured by transiently reverting Step 4's bind (Deviation Log "Step 5 — RED captured…").
- TDD: AC-3 red (bind reverted to `false`, uncommitted): "argument 16 expected [bool - true] does not match actual [bool - false]" and "requires_approval bind = false, want true" → green: `ok internal/repository`, `ok internal/service`, full suite all `ok`, `total: 85.0%` (>= 40%), `golangci-lint` `0 issues.`, C-13 count `2`. Verbose re-run: 3 subtests + the PlaceOrder test PASS. Mutation: adding `requires_approval = EXCLUDED.requires_approval` to `DO UPDATE SET` fails the PENDING_APPROVAL subtest; reverted.
- Impl-spec review warning "add a PARTIALLY_FILLED row (expect false)" not applied (Step 5 Instruction 1 names three statuses) — still unaddressed.

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), unit Steps 6+7+8+9

- Tree: detached at `origin/feature/fix-trading-config-plumbing@1eeae5cd`. Discovery: `environmentIsPaper` `trading.go:2836-2840` (GetBool `:2839`), callers `:1080`, `:2713`, `:2747`, `:2827` (`GetTradingEnvironment` `:2825`); `resolveTradingMode` `:3863-3874` (GetBool `:3869`); `cfg.TradingMode` read only at those two lines. Config migrations: `origin/main-dev` max `056`, so `057` stands (`057` is on 314's branch only). `scripts/config-wiring.json` held the single `broker.paper` read-unseeded entry; `config-wiring.test.mjs:618` the `findings.length > 0` assertion.
- Stored-set route (Open Thread "Before Step 6"): route (a), an operator-authorized throwaway local PostgreSQL 16 provisioned by the main session (go-ahead 2026-11-26), `migrate` v4.17.1 and `psql` 16 on PATH. Generator only; no database started by this agent; verification offline. Deviation Log "Steps 6+7+8+9 — stored set regenerated…".
- Tooling (steps 6–9): go1.27 ✓ · golangci-lint ✓ v2.14.0 (`/root/go/bin`, prepended to PATH) · pnpm ✓ (linked main-checkout node_modules) · node v22 · python3 ✓ · hook check hook=0.

### Step 6 — service: `broker.paper` has one reader and an `APPLICATION_ENV` fallback [done]
- Atomic unit Steps 6+7+8+9. `environmentIsPaper` falls back to `s.cfg.ApplicationEnv != "production"` and is the sole `broker.paper` reader; `resolveTradingMode` calls it. `Config.TradingMode`, `NewWatcher` and deployment files untouched (D-19).
- Files modified: `services/xstockstrat-trading/internal/service/trading.go`
- Deviations: none
- Verification: one `"broker.paper"` hit (`:2839`), no `cfg.TradingMode` hit, `environmentIsPaper()` at `:1080`, `:2713`, `:2747`, `:2827`, `:3869`; TRADING_MODE lines unchanged; deployment diff empty; `go build`/`go vet` clean.

### Step 7 — test: paper/live resolution follows `APPLICATION_ENV` and the stored row (AC-4) [done]
- Atomic unit Steps 6+7+8+9. Added `TestEnvironmentIsPaper_F321_AC4` (seven table rows on three surfaces plus the explicit-request row), literal enums.
- Files modified: `services/xstockstrat-trading/internal/service/trading_paper_env_test.go`
- Deviations: none
- TDD: AC-4 red: the four no-row rows failed, e.g. "production, TRADING_MODE paper, no row: environmentIsPaper() = true, want false" / "GetTradingEnvironment().TradingMode = TRADING_MODE_PAPER, want TRADING_MODE_LIVE" → green: `ok internal/service`; full suite all `ok` (the eleven `&config.Config{}` harnesses stay green in PAPER), `total: 85.0%` (>= 40%), `golangci-lint` `0 issues.`

### Step 8 — migration: seed `trading` / `broker.paper` per environment (config `057`) [done]
- Atomic unit Steps 6+7+8+9. `057_trading_broker_paper_per_environment.{up,down}.sql`: two-tuple insert-if-absent (staging `true`, production `false`, sentinel `system:config-migration-feature-321`); the down deletes only the sentinel rows still at their seeded per-environment value. Stored set regenerated (2 rows, new `inputs_sha256`).
- Files modified: `services/xstockstrat-config/migrations/057_trading_broker_paper_per_environment.up.sql`, `.down.sql`, `scripts/config-wiring-stored.json`
- Deviations: operator-authorized scratch database for the generator (Deviation Log).
- TDD: N/A (migration). Offline check: pair is the highest number; down reverses up by inspection; stored-JSON count `2`; catalog.tsv / trading config diff empty. Config-key wiring gate (step-time, `--declared-from product-spec.md --declared-migration 057_…up.sql`): exit=0, no findings printed.

### Step 9 — test: per-environment seed and a clean wiring gate (AC-4) [done]
- Atomic unit Steps 6+7+8+9. Added `brokerPaperSeedMigration.test.ts` (4 cases); removed the `broker.paper` baseline entry (`"findings": []`); `config-wiring.test.mjs:618` now `assert.ok(Array.isArray(findings), 'findings must be an array')`.
- Files modified: `services/xstockstrat-config/src/__tests__/brokerPaperSeedMigration.test.ts`, `scripts/config-wiring.json`, `scripts/config-wiring.test.mjs`
- Deviations: none
- TDD: AC-4 red: "expected exactly one *_trading_broker_paper_per_environment.up.sql, got []" (4 subtests failed) → green: config suite `# tests 409 / # pass 409 / # fail 0`, coverage `All files 92.31` lines (>= 40), lint 0 errors; `config-wiring.test.mjs` 75/75; `--final` `exit 0` with `broker.paper` count `0` (only the two pre-existing `REPORTED:` readers-disagree lines); `--doc-check` + `check-watcher-copies: all groups byte-identical`; C-13 fixture grep none.

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), unit Steps 10+11

- Tree: detached at `origin/feature/fix-trading-config-plumbing@8599b995`. Discovery: comment `trading.proto:263-265`, field `bool is_paper = 3 [deprecated = true];` `:266`; the only `.proto` hit for `TRADING_MODE env` is `:264`; `grep -rln` over `packages/proto/gen` lists exactly the five Step 11 files.
- Tooling (steps 10+11): buf ✗ on host → `xstockstrat-codegen` image ✓ (buf 1.72.0, protoc-gen-go v1.36.11, grpcio-tools 1.80.0, go1.27.4; Docker daemon up) · hook check hook=0. Toolchain check on the unedited tree: `buf-gen.sh` left `packages/proto/gen` unchanged. Config-key wiring gate: not applicable (comment only; no key read or seeded).

### Step 10 — proto: fix the stale `TRADING_MODE env` comment on `is_paper` [done]
- Atomic unit Steps 10+11. Rewrote the three comment lines only: `trading.broker.paper` seeded per environment, `APPLICATION_ENV` fallback when the row is absent, the server derives `is_paper` and ignores the field. Field unchanged.
- Files modified: `packages/proto/trading/v1/trading.proto`
- Deviations: Verification run inside the codegen image (Deviation Log "Steps 10+11 — Verification blocks run inside…").
- TDD: N/A (proto). Verification exit=0; per-line re-run: `lint rc=0`, `breaking rc=0` (against `origin/main-dev`), `noncomment grep rc=1`, `stale grep rc=1`.

### Step 11 — proto-gen: regenerate the stubs [done]
- Atomic unit Steps 10+11. `./scripts/buf-gen.sh` changed exactly the five listed trading files (`5 files changed, 15 insertions(+), 15 deletions(-)`); no Python or other stub changed.
- Files modified: `packages/proto/gen/go/trading/v1/trading.pb.go`, `packages/proto/gen/ts/trading/v1/{trading.ts,trading_pb.ts}`, `packages/proto/gen/ts/dist/trading/v1/{trading.d.ts,trading_pb.d.ts}`
- Deviations: same as Step 10 (codegen image); the first run failed only at `go build` on the image's module-cache path, re-run green.
- TDD: N/A (proto-gen). Verification exit=0: no `TRADING_MODE env` hit in `packages/proto/gen`; `GOWORK=off go build ./...` in `services/xstockstrat-trading` clean.

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), Step 12

- Tree: detached at `origin/feature/fix-trading-config-plumbing@2a6ee3d7`. Discovery: trading CLAUDE.md anchors `:13`, `:21`, `:81`, `:82`, `:85`, `:90`, `:117`, `:181-186`, `:231` as specced; trading findings IBKR row `:24`, `requires_approval` row `:25`, `NewWatcher` question `:43`, Resolved `:45`; config-governance log intro `:148-150`, feature 366 at `:152`; root findings `:23`. Code claims re-grounded: `IBKRRequestTimeout` gone from non-test code, `IBKRDefaultHandshakeTimeout` `ibkr_session.go:34`, `environmentIsPaper` `trading.go:2838` (fallback `ApplicationEnv != "production"`), credential poller `5*time.Second` `trading.go:2845`, migration `057_trading_broker_paper_per_environment` with sentinel `system:config-migration-feature-321`, `.do/app.yaml`/`.do/app.dev.yaml` `APPLICATION_ENV` `production`/`staging`.
- Tooling (step 12): node ✓ · python3 ✓ · hook check hook=0. No install.

### Step 12 — docs: trading CLAUDE.md, config-governance log, findings [done]
- Trading CLAUDE.md: paper/live from `is_paper` + per-environment `broker.paper` with the `APPLICATION_ENV` fallback; `broker.paper` default environment-derived; `broker.timeout_ms` bounds Alpaca and signed IBKR requests; handshake independent of `broker.timeout_ms`; stale floor `broker.IBKRDefaultHandshakeTimeout`; `requires_approval = true` persisted; two rate-limit rows (10 s × 3.0, 10 s × 4.0); `TRADING_MODE` marked unread (cleanup 322). Trading findings: IBKR timeout and `requires_approval` (narrowed) moved to Resolved; open rows for the 5 s credential poller, the stale stored descriptions, the IBKR chain = S, the missing `APPLICATION_ENV` pairing check; `Config.TradingMode` added to the `NewWatcher` question. config-governance: `### feature 321` entry above feature 366 with a two-key table. Root findings `:23`: trading no longer uses `TRADING_MODE` as the `broker.paper` fallback.
- Files modified: `services/xstockstrat-trading/CLAUDE.md`, `services/xstockstrat-trading/docs/context-constitution-findings.md`, `docs/patterns/config-governance.md`, `docs/context-constitution-findings.md`
- Deviations: a third stale stored description (`ibkr.handshake_timeout_ms`) recorded (Deviation Log "Step 12 — a third stale stored description…").
- TDD: N/A (docs). Verification (`.sdd-logs/v-1.log`): exit=0; per-line re-run (`.sdd-logs/v-2.log`): `line1 rc=0` (no `IBKRRequestTimeout` in trading CLAUDE.md), `feature 321` counts 1 / 7 / 1 (`line2 rc=0`), `line3 rc=0` (append-only, no removed line), `line4 rc=0` (`--doc-check`), "OK - all context-map and doc references resolve." `line5 rc=0`. Config-key wiring gate (step-time, `--declared-from product-spec.md`): exit=0, no findings printed.
- Not edited (out of the step's instructions): the trading CLAUDE.md constitution-pointer blurb still says "(dead retry config, IBKR timeout oversight)" — both now resolved; the `:103` `syncPositions` sentence is unchanged.

## Session 2026-11-27 — operator ruling recorded by the orchestrator (verbatim)

Question (Step 13 blocker, operator-only stored-state check): who runs the live read-back of `trading/broker.timeout_ms` and `trading/order_intent.stale_multiplier` on DO staging and homelab staging, plus the `config.config_audit` rows?
Operator answer: **"Defer Step 13"** — Step 13 stays `pending` and the feature stays `in-progress`, with the draft gate held until just before the integration PR leaves draft. Pass condition unchanged: `timeout_ms` is an int >= 10000 and `stale_multiplier` >= 4.0; a reverted value is re-applied through SetConfig, never a migration. Production is out of scope (standing ruling).

## Session 2026-11-27 — correction to the preceding Step 13 ruling, recorded by the orchestrator (verbatim)

The preceding "Defer Step 13" entry was selected by mistake (operator, same session). It is superseded. Operator's intended answer: **"You authorize me"** — the main session reads `trading/broker.timeout_ms` and `trading/order_intent.stale_multiplier` with the read-only `get_config` tool on the `xstockstrat_staging` and `xstockstrat_homelab_staging` MCP servers (staging only, no writes, production out of scope); the `config.config_audit` rows are read by the operator with `scripts`-free read-only SQL (A8).

Read-back taken 2026-11-27T03:13Z by the main session (get_config namespace `trading`, global scope):
- DO staging (`xstockstrat_staging`, environment=staging, config version `d6b3f8be0d742264`): `broker.timeout_ms` = 10000 (int), `order_intent.stale_multiplier` = 4.0 (float).
- Homelab staging (`xstockstrat_homelab_staging`, environment=staging, config version `d6b3f8be0d742264`): `broker.timeout_ms` = 10000 (int), `order_intent.stale_multiplier` = 4.0 (float).
- Pass condition (`timeout_ms` int >= 10000, `stale_multiplier` >= 4.0): met on both, each at the boundary. Both deployments report the same opaque version, which is consistent with identical content; it is not proof that the two stores are independent.
- Outstanding: the `config.config_audit` rows (operator-run read-only query A8 on each database). Step 13 is not marked done until they are recorded.

## Session 2026-11-27 — Step 13 audit rows, homelab staging, supplied by the operator (verbatim)

Operator pasted the A8 result (`config.config_audit`, namespace `trading`, keys `broker.timeout_ms` and `order_intent.stale_multiplier`) from the **homelab** database, 6 rows:
- id 874, staging, `order_intent.stale_multiplier`: 3 → 4, changed_by `a169f6e3-9ab1-450d-9f03-faa2496f572b`, reason "Feature 321 fix-trading-config-plumbing pre-deploy operator action (D-20): S = 40 s so Alpaca 429 retry and pacing are kept at broker.timeout_ms = 10000.", 2026-11-20 13:59:39.11027+00.
- id 873, staging, `broker.timeout_ms`: 5000 → 10000, same changed_by, reason "Feature 321 fix-trading-config-plumbing pre-deploy operator action (D-13/D-20): keep IBKR signed requests at 10 s once they honour this key.", 2026-11-20 13:59:38.664314+00.
- ids 766 / 765 (`order_intent.stale_multiplier`, production / staging) and 751 / 750 (`broker.timeout_ms`, production / staging): `system:config-migration-044` "feature 296: renamed from trading.…", 2026-11-10 08:22:20+00, old = new (3 and 5000).

Read against the main-session `get_config` read-back of 2026-11-27 (homelab staging `broker.timeout_ms` = 10000, `order_intent.stale_multiplier` = 4.0): the current staging values equal the new_value of the latest audit row for each key, so no later write has reverted them. Production rows were not touched by this feature (production out of scope). Outstanding for Step 13: the same A8 query result from **DO staging**.

## Session 2026-11-27 — Step 13 audit rows, DO staging, supplied by the operator (verbatim)

Operator pasted the A8 result from the **DO staging** database, 6 rows (`config.config_audit`, namespace `trading`):
- id 1669, staging, `order_intent.stale_multiplier`: 3 → 4, changed_by `80880990-2b79-4d85-8761-d8d9102c2efb`, reason "Feature 321 fix-trading-config-plumbing pre-deploy operator action (D-20): S = 40 s so Alpaca 429 retry and pacing are kept at broker.timeout_ms = 10000.", 2026-11-20 13:59:12.271171+00.
- id 1668, staging, `broker.timeout_ms`: 5000 → 10000, same changed_by, reason "Feature 321 fix-trading-config-plumbing pre-deploy operator action (D-13/D-20): keep IBKR signed requests at 10 s once they honour this key.", 2026-11-20 13:59:10.841901+00.
- ids 1572 / 1571 (`order_intent.stale_multiplier`, production / staging) and 1557 / 1556 (`broker.timeout_ms`, production / staging): `system:config-migration-044` "feature 296: renamed from trading.…", 2026-11-08 07:51:52+00, old = new (3 and 5000).

Step 13 read-back summary (both environments, staging only; production out of scope): DO staging and homelab staging each hold `broker.timeout_ms` = 10000 (int, >= 10000) and `order_intent.stale_multiplier` = 4.0 (float, >= 4.0) per the main-session `get_config` read-back of 2026-11-27, and each value equals the `new_value` of that environment's latest audit row (DO staging ids 1668/1669, homelab staging ids 873/874, both 2026-11-20). Pass condition met on both; no value was reverted, so no SetConfig re-apply is needed.

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), Step 13

- Tree: detached at `origin/feature/fix-trading-config-plumbing@b86076cc`. Discovery: the 2026-11-20 pre-deploy record (`## Session 2026-11-20 — pre-deploy operator action`), the production-out ruling, and the three 2026-11-27 read-back / audit entries above are present; `SetConfig` upsert `configServiceImpl.ts:839-851` (`DO UPDATE SET` omits `value_type`); stored `broker.timeout_ms` rows now at `config-wiring-stored.json:4564`/`:4576` (spec `:4546`/`:4558`, drift from the Steps 6–9 regeneration).
- Tooling (step 13): node ✓ (wiring gate only) · hook check hook=0. No install.

### Step 13 — config: operator-only stored-state check before the integration PR leaves draft [done]
- Stored-state pre-deploy re-check (D-13 / D-16 / D-20, staging only; operator-authorized read-back): at 2026-11-27T03:13Z the main session's read-only `get_config` (namespace `trading`, global scope) read, on **DO staging** (`xstockstrat_staging`) and **homelab staging** (`xstockstrat_homelab_staging`): `broker.timeout_ms` = 10000 (int) and `order_intent.stale_multiplier` = 4.0 (float). Audit rows (operator A8): DO staging ids 1668 (`broker.timeout_ms` 5000 → 10000, 2026-11-20 13:59:10Z) / 1669 (`order_intent.stale_multiplier` 3 → 4, 13:59:12Z); homelab staging ids 873 (13:59:38Z) / 874 (13:59:39Z). Each current value equals its latest audit `new_value`: nothing reverted, no SetConfig re-apply. Pass condition met on both (each at the boundary). Production not checked (never launched; Open Thread kept).
- Files modified: `docs/roadmap/features/321-fix-trading-config-plumbing/context.md`
- Deviations: none
- TDD: N/A (config, operator-only). Config-key wiring gate (step-time, `--declared-from product-spec.md`): exit=0, no findings printed. `--final` (last step): exit=0, only the two pre-existing `REPORTED:` readers-disagree lines (`fundsignal_loop.py:marketdata/fundamentals.provider`, `trading.go:platform/trading_state`); `broker.paper` count `0`.
- All 13 steps done → status `code-completed`. Integration PR opens as a draft; this entry satisfies its draft gate.

## Session 2026-11-27 — sdd-batch-execute promotion plan (awaiting operator confirm)

````sdd-batch-promotion-plan
## Promotion plan: fix-trading-config-plumbing (feature 321)

Source: docs/roadmap/features/321-fix-trading-config-plumbing/acceptance.feature (4 scenarios, read from the working tree). Affected service: xstockstrat-trading (config seed and gate are cross-cutting). Dedup targets: the 20 existing files under /home/user/xstockstrat/services/xstockstrat-trading/acceptance/, services/xstockstrat-config/acceptance/fix-config-keys-drift.feature, and /home/user/xstockstrat/docs/sdd/business-rules/platform.feature. A grep for `@feature-321` across all service suites found nothing, so no scenario has been promoted before.

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| @AC-1 | services/xstockstrat-trading/acceptance/fix-trading-config-plumbing.feature | CREATE | NEW | The observable subject is the IBKR signed order request's deadline and the handshake bound, which live in trading. The closest existing rule, 295 @AC-17 in fix-config-keys-drift.feature, covers only an Alpaca client's live timeout. It is complementary, not an overlap (design.md marks it EXTEND). |
| @AC-2 | same file | CREATE | NEW | The subject is the flattenAndHalt attempt count with int-typed rows. No existing trading scenario asserts it. 347 @AC-28 uses max_retries 3 with a 429 hold. 295 @AC-12 covers getter fallback on timeout_ms. |
| @AC-3 | same file | CREATE | NEW | A grep of the trading suites for requires_approval found no match. |
| @AC-4 | docs/sdd/business-rules/platform.feature | APPEND | CONFLICT (signed-off supersession of 304 @AC-14) | The guarantee spans the config seed migrations, trading's APPLICATION_ENV fallback and the repo-wide scripts/config-wiring.json gate, so no single service owns it. It contradicts the standing platform.feature scenario 304 @AC-14 at line 2095 (see Notes). |

### Ready-to-write blocks

--- /home/user/xstockstrat/services/xstockstrat-trading/acceptance/fix-trading-config-plumbing.feature (CREATE) ---
```gherkin
# Promoted from docs/roadmap/features/321-fix-trading-config-plumbing/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-321` tag.
# Durable regression guards for three xstockstrat-trading config/persistence defects: the IBKR signed-request
# timeout, the int-typed retry rows, and requires_approval persistence. A rule enters only by promotion from a
# reviewed feature acceptance.feature, never by hand-authoring.

Feature: fix-trading-config-plumbing (bug fix, trading config and persistence guarantees)
  Regression guard for three xstockstrat-trading defect reports (IBKR timeout, accessor type
  mismatch, requires_approval persistence).

  # guards: docs/reports/2026-10-19-trading-ibkr-timeout-hardcoded-defect.md
  @AC-1 @regression @feature-321
  Scenario: Signed IBKR requests honour the live trading.broker.timeout_ms
    Given trading.broker.timeout_ms is 2000
    And an IBKR account whose order endpoint never answers
    When an order is placed for that account
    Then the signed order request times out after about 2 seconds, not 10
    And a later change of trading.broker.timeout_ms applies to the same broker client without a restart
    And a handshake slower than trading.broker.timeout_ms but within trading.ibkr.handshake_timeout_ms still succeeds

  # guards: docs/reports/2026-10-19-trading-config-accessor-type-mismatch-defect.md
  @AC-2 @regression @feature-321
  Scenario Outline: An int-typed trading.order.max_retries row sets the emergency flatten's attempts
    Given trading.order.max_retries is stored as an int row with value <max_retries>
    And trading.order.retry_delay_ms is stored as an int row below its 500 ms default
    When every broker submission of a protection-window flatten is definitively rejected
    Then the flatten submits <attempts> times, which is 1 + max_retries, before halting the account
    And it waits the stored retry delay between attempts, not the default

    Examples:
      | max_retries | attempts |
      | 1           | 2        |
      | 5           | 6        |

  # guards: docs/reports/2026-10-19-trading-requires-approval-always-false-defect.md
  @AC-3 @regression @feature-321
  Scenario: An order that crosses the approval threshold is persisted with requires_approval true
    Given trading.approval.require_above_qty is 20
    When an order with qty 21 is placed and returns ORDER_STATUS_PENDING_APPROVAL
    Then the trading.orders row first written for that order_id has requires_approval = true
    And an order written with any other status has requires_approval = false
```

--- /home/user/xstockstrat/docs/sdd/business-rules/platform.feature (APPEND) ---
CONFIRMED 2026-11-27: the operator confirmed the 304 @AC-14 supersession (sign-off 2026-11-20; context.md O-8/O-11/D-14, design.md § Business Rules Touched) and chose "Promote all, comment only". Write this block and the single companion comment line; do not rewrite 304 @AC-14.
```gherkin
  # guards: docs/reports/2026-11-06-trading-broker-paper-env-derived-default-unseedable-defect.md
  # Supersedes @feature-304 @AC-14 (the broker.paper baseline entry is removed, not respelled).
  @AC-4 @regression @feature-321
  Scenario: trading.broker.paper is seeded per environment and falls back to the application environment
    Given the config catalog row for trading.broker.paper has an environment-derived default
    When the config seed migrations run for staging and production
    Then trading.broker.paper is stored true in staging and false in production, never one literal for both
    And a row that already exists is left unchanged
    And with no stored row trading resolves paper unless APPLICATION_ENV is production, whatever TRADING_MODE says
    And staging resolves to paper and production resolves to live
    And scripts/config-wiring.json holds no entry for trading.broker.paper and "node scripts/check-config-wiring.mjs --final" exits 0 with no read-unseeded or STALE line for it
```

Companion comment edit, which is additive and leaves the scenario text unchanged. Insert this single line directly above the tag line `@AC-14 @FR-4 @feature-304` (currently line 2095) in platform.feature:
```
  # Superseded by @feature-321 @AC-4 (user sign-off 2026-11-20, feature 321 design.md § Business Rules Touched); text intentionally not rewritten.
```

### Notes / ambiguities / conflicts
- **CONFLICT, AC-4 against 304 @AC-14** (`/home/user/xstockstrat/docs/sdd/business-rules/platform.feature:2095`).
  - 304 @AC-14 requires `scripts/config-wiring.json` to hold a respelled `broker.paper` read-unseeded entry that stays owned by the defect.
  - 321 @AC-4 requires the entry to be removed once the key is seeded.
  - Feature 321 design.md § Business Rules Touched records this as `CHANGE 304 @AC-14 ... superseded by 321 @AC-4; signed off by user @ 2026-11-20`. The same decision appears as the open C-16 item at context.md:68.
  - I could not independently verify the sign-off wording in context.md; my grep output omitted the long matching line (line 44). The orchestrator should confirm the sign-off is in context.md before writing.
  - I recommend keeping the existing 304 @AC-14 in place and adding only the "Superseded" comment. Nothing is deleted or rewritten.
- **AC-4 routing.**
  - Per-service routing was rejected because the Then clauses span the config seed migrations (config service), trading's `APPLICATION_ENV` fallback, and the repo-level `check-config-wiring.mjs` gate.
  - It is placed in platform.feature next to 304 @AC-14, which it supersedes.
  - Splitting it was rejected because promotion must be verbatim and one scenario maps to one target.
- **Related rules, not conflicts.**
  - 295 @AC-12 and @AC-17 (trading `fix-config-keys-drift.feature`) are preserved. There is no getter change.
  - 347 @AC-28 is preserved (design says PRESERVE).
  - Config `@AC-29` "A key whose readers disagree on the default is not seeded" (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature:112`) is extended by 321 @AC-4 but not contradicted.
  - The platform scenarios at lines 1201 and 2360, which render `TRADING_MODE` paper or live, stay consistent with AC-4's "whatever TRADING_MODE says", since there is no render change.
  - None of these is an OVERLAP.
- **Tags.** The source scenarios carry no `@FR-*` tags (only `@AC-n @regression`). I did not invent any, so promoted tags are `@AC-n @regression @feature-321`. Source `# guards:` comments are kept verbatim; the defect-report paths may be pruned later, as noted in the 192 suite header.
- **Dropped from the Feature description.** The source header line "Scenarios amended at design approval (2026-11-20...)" is process history and was not carried into the trading file header.
- **P-06 waiver.** AC-2 passes at HEAD, with an operator-granted natural-RED waiver recorded in context.md:54. This has no effect on promotion.

### Coverage check
- Source scenarios: 4 (AC-1, AC-2 as a Scenario Outline with 2 example rows, AC-3, AC-4). Planned: 4 (NEW 3, CONFLICT 1 with its block held pending sign-off confirmation, DUP 0, OVERLAP 0). Nothing was skipped. Every @AC-* is accounted for, and counts match.
- Files: 1 CREATE (trading, 3 scenarios) and 1 APPEND (platform.feature, 1 scenario plus one additive comment line). The `services/xstockstrat-trading/acceptance/` directory already exists.
````

## Session 2026-11-27 — C-16 promotion ruling recorded by the orchestrator (verbatim)

Question: promote @AC-1..@AC-4 (trading suite for @AC-1..@AC-3; @AC-4 appended to platform.feature with only a "Superseded by @feature-321 @AC-4" comment above 304 @AC-14)? Operator answer: **"promote 321"** (the offered option "Promote all, comment only (Recommended)"). The HOLD line in the `sdd-batch-promotion-plan` block above was replaced by this confirmation before the gate was approved.
