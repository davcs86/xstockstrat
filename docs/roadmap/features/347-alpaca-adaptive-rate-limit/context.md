# Context: alpaca-adaptive-rate-limit

**Feature**: `docs/roadmap/features/347-alpaca-adaptive-rate-limit/feature.md`
**Product Spec**: `docs/roadmap/features/347-alpaca-adaptive-rate-limit/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/347-alpaca-adaptive-rate-limit/implementation-spec.md`

---

## Session 2026-11-16T00:55Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator request: "Use adaptive rate limit for marketdata calls to Alpaca", spec =
  <https://docs.alpaca.markets/us/docs/broker-api-rate-limits>, "vendor-specific change".
- Operator decisions (asked and answered this session):
  1. The cited page is Broker API-scoped; apply its header/backoff contract to the Alpaca hosts we call,
     **and also cover `xstockstrat-trading`** (scope widened beyond marketdata by the operator).
  2. `marketdata.backfill.rate_limit_rps` stays as a ceiling over the adaptive rate.
  3. On 429: retry inside the client until the request context is done.
  4. Tunables: one kill-switch key per service only; thresholds and backoff are fixed in code.
- Assumptions recorded (not yet confirmed by the operator): REST only, no WebSocket; limiter state per
  host and per process, in memory; no proto, DB or consumer-surface change; kill switches default `true`.
- Data host verified (operator-supplied <https://docs.alpaca.markets/us/reference/stockbars>): all three
  `X-RateLimit-*` headers on 200/400/429, per-minute window, `Reset` in Unix epoch seconds.
- Operator decisions, second round: (5) both kill switches seed `true`; (6) order mutations retry on 429,
  bounded by the order-intent staleness threshold (`order_intent.go`: `max(broker.timeout_ms, IBKRRequestTimeout)` × `stale_multiplier`, 30s at defaults); (7) no quota reservation for
  interactive reads, they fail fast in an exhausted window.
- Unverified: that the Trading API hosts return `X-RateLimit-*` headers. Recon item.

## Session 2026-11-16T01:40Z — sdd-review product-spec

- Tree: ccr-47ce6aaf-i0ffis ≡ origin/main-dev@9f88562 plus this feature's docs-only commits. Deviation
  from `docs/sdd/tree-freshness.md`: the harness pins this session to the `ccr-*` branch, so the tree was
  not switched to `main-dev`; `origin/main-dev` is an ancestor of HEAD.
- First pass FAILED (config-key contract incomplete, three unchecked open questions, no paper-vs-live
  statement). Spec fixed: FR-8 reworded to the real staleness threshold, FR-10 added, Config Key Changes
  rewritten with readers / migration 050 / live mechanism, AC-15..AC-18 added. Second pass PASSED.
- Product spec approved. Status: draft → spec-ready.
- Warnings:
  - AC-7's bound ("no more than 10 of 15 in the first second" at 5 rps) is loose; tighten at design.
  - `services/xstockstrat-marketdata/CLAUDE.md` calls `backfill.rate_limit_rps` startup-read, but
    `main.go` reads it per request; the doc is corrected in this feature.
  - Config migration 050 is also named by features 341 and 343; the later merger renumbers and
    regenerates `scripts/config-wiring-stored.json`.
  - FR-2/FR-3 constants are fixed in code; design records why they are not config keys (F-07 adjacency).
- Overlap findings (WARN only, no FAIL):
  - `services/xstockstrat-marketdata/internal/alpaca/client.go` is also edited by 322
    (`fix-retired-surface-proto-cleanup`, `Paper` plumbing) and 323 (`fix-orphaned-code`, `AlpacaAsset`
    removal). Separate hunks; merge-conflict risk only.
  - `trading.broker.*` namespace shared with 321 (`fix-trading-config-plumbing`); different keys.
- Trading API hosts: rate-limit headers are not documented (`reference/postorder`); FR-5 covers it.
- Recommended design depth: full (two services, order-mutation path, overlap findings).

## Session 2026-11-16T02:30Z — sdd-review product-spec (warning loop, operator-requested)

- Operator asked to loop the review until every warning was addressed. Passes 3 to 5; pass 5 returned
  PASS with no warnings and no blockers. Status unchanged (`spec-ready`).
- Spec changes: FR-2 pins "Remaining 4 of 200 is low" and the cut-short-wait error; FR-3 adds
  add-only jitter, "Reset is used whenever it parses", and a fixed total-wait bound for callers with no
  deadline (60 to 300 s marketdata; below the FR-8 threshold in trading); FR-5 ignores a response when
  any of the three headers is unusable; FR-9 adds no instrument and maps a cut-short wait to `throttle`;
  new § Fixed Invariants records why the pacing constants are not config keys.
- Scenarios: AC-7, AC-8, AC-9, AC-12, AC-13 tightened; AC-19 (no-deadline bound), AC-20 (per-credential
  state), AC-21 (throttle outcome), AC-22 (rps 0) added. 22 scenarios.
- Shared files touched: `docs/roadmap/features/merge-order.md` gained a non-blocking 347 section (config
  seed 050 shared with 341/343/330; `alpaca/client.go` overlap with 322/323).
  `services/xstockstrat-marketdata/CLAUDE.md` row for `backfill.rate_limit_rps` corrected from "read at
  startup" to live per request (matches `cmd/server/main.go`).
- Correction: the order-retry bound is 30 s at defaults, not the 15 s first quoted to the operator
  (`IBKRRequestTimeout` is 10 s and enters the `max`).

## Session 2026-11-16T03:40Z — sdd-design (gate log)

- Phase 0 Recon: wrote recon.md (marketdata, trading, config; 40 existing business rules, none CHANGE).
- Trading API reference pages (`/v2/orders`, `/v2/account`, overview) document no rate-limit headers
  and no 429; only the Market Data reference does.
- Phase 1 round 1 done; register in debate.md (D-1..D-10 settled, R-1..R-3 locked, O-2/O-4/O-5/O-6/
  O-9/O-11 open). No Floor breach, no C-16 regression found.
- Round 1 gate, operator steers (2026-11-16): (8) trading fails fast on a wait that cannot fit;
  **marketdata keeps waiting to the request deadline** (fail-fast declined there); (9) a rate-limited
  `flattenAndHalt` submit halts the account first, then keeps retrying the flatten; (10) order mutations
  run detached from caller cancellation, still time-bounded; (11) trading retry budget is
  `max(T, S − 2T)` (20 s at defaults). Recorded as D-11..D-14, R-4..R-8 in debate.md.
- Round 2 done (D-15..D-18; O-14..O-24). Round 2 gate, operator steers: (12) accept the spread-skip
  rule (FR-2 amended); (13) fix rate-limited cancel (return Unavailable, no local CANCELED) and replace
  (no stored Rejected intent) in this feature; (14) bound the loops: per-cycle deadline in marketdata's
  warm-quote and bar-ingest loops, Alpaca-only per-call timeout in the fill poller; (15) run round 3.
  D-19..D-21, R-9..R-11.
- D-14 supersedes operator decision 7 for marketdata: in an exhausted window a detached quote or price
  fetch now holds for its full budget (2.5 s) before returning the warm subset, where a 429 used to fail
  in milliseconds. Time bounds are unchanged.
- Round 3 done (D-22..D-24; O-25..O-35). Round 3 gate, operator steers: (16) **approved** one new
  repository method `ReleasePendingIntent` (guarded DELETE of a PENDING intent row after a rate-limit
  refusal) — the first delete path on `trading.order_intents`; (17) the marketdata cycle deadline bounds
  only the Alpaca calls, DB writes keep the loop context (D-26 supersedes D-21); (18) bracket-leg
  cancels are bounded by `broker.timeout_ms`, no retry; (19) run round 4. D-25..D-27, R-14..R-16.
- To file at spec/execute (pre-existing, not fixed here): `ReplaceOrder` inserts its intent before
  `validateTIF`, so a TIF validation failure leaves the intent PENDING then UNKNOWN.
- Round 4 done (D-28, D-29, R-17; O-36..O-41 closed). Round 4 gate, operator steer (2026-11-16):
  "keep rounds until adversary verdict is sound. I sign off to override the rounds cap." The debate may
  run past the 5-round cap of `/sdd-design` full mode; rounds continue until the adversary returns a
  verdict with no blocking objection. Override recorded per P-04; the Floor rule (F-11) is untouched.
- Round 5 done: adversary verdict SOUND (no Floor breach, no blocking objection, no register violation,
  no C-16 regression). D-30, O-42. The operator's stop condition for the debate is met.

## Session 2026-11-16T05:40Z — sdd-design

- Phase 0 Recon: wrote recon.md (services: marketdata, trading, config; key reuse patterns: the single
  `do` chokepoint in each Alpaca client; the byte-identical-copy governance of `check-watcher-copies`).
- Phase 1 Grilling: 5 rounds (full; the operator waived the round cap and set "adversary verdict sound"
  as the stop condition; met at round 5). Chosen approach: a pure pacing core copied into both services
  behind each `do`; marketdata waits to the request deadline, trading fails fast inside a budget of
  `max(T, S − 2T)`; order mutations detached from caller cancellation; rate-limited cancel/replace
  release their intent; loops and per-call reads bounded. Rejected: a shared Go module, a cross-client
  credential registry, anchoring the deadline at the intent seam (R-1..R-17 in debate.md).
- Operator approved the design at the round 5 gate (2026-11-16).
- Product spec and acceptance.feature amended as approved: FR-2, FR-3, FR-8, FR-9 reworded; FR-11 added;
  fixed invariants listed; AC-2, 3, 7, 13, 17, 19, 20, 21 corrected; AC-23..AC-37 added (37 scenarios).
- Business rules (C-16): no existing rule changed; three extended (294 @AC-13, 295 @AC-14, 282 @AC-27).
- Constitution rules touched: C-01, C-05, C-07, C-08, C-10, C-13, C-14, C-15, C-16, C-18, P-03, P-04,
  P-06, F-01, F-04, F-06, F-07. Floor breaches: none.
- Status: spec-ready → design-approved.

### Open Threads (from design.md Open Risks)

- [ ] Trading pollers and reconciler always skip spreading — unit test at S8.
- [ ] Clamp row (T 10 s, ×1.5): budget plus re-read 20 s > threshold 15 s; T 1 s, ×3.0 leaves 1 s —
  budget table test at S10, documented at S9.
- [ ] Trading API rate-limit headers undocumented — FR-5 test at S8; real paper-host response recorded
  at the integration PR.
- [ ] File the pre-existing `ReplaceOrder` defect (intent inserted before `validateTIF`) at `/sdd-spec`.
- [ ] Config migration number re-derived at S11 and at the integration PR; regenerate
  `scripts/config-wiring-stored.json`.
- [ ] `ReleasePendingIntent` has no DB-level test — reviewed at S9; rule written into trading docs.
- [ ] AC-37's new `backfill.rate_limit_rps` description text is fixed in the implementation spec.

## Session 2026-11-16T06:10Z — branch sync before sdd-spec

- `/sdd-spec` halted at its tree-freshness preflight: `origin/main-dev` had moved 57 commits
  (9f88562 → 5730505) and merging it conflicted in `docs/roadmap/ledger/fails.md` (both sides appended).
- Merged `origin/main-dev` into `ccr-47ce6aaf-i0ffis`; the ledger conflict was resolved by the repo's
  allowlisted union rule (`scripts/merge-train-resolve.mjs`), base entry first. Merge commit c420b2a.
- main-dev now carries `050_ui_chart_history_bars` (feature 341), so this feature's config migration is
  **051**; product-spec.md, design.md and the merge-order note were updated.
- recon.md `path:line` evidence predates the merge for files main-dev touched (marketdata
  `internal/repository/marketdata_repo.go`, `internal/telemetry/otel.go`,
  `internal/service/telemetry_allowlist_test.go`, the marketdata `CLAUDE.md`; config
  `src/grpc/configServiceImpl.ts`; `scripts/config-wiring*.json`; `docs/patterns/config-governance.md`).
  `/sdd-spec` re-discovers and cites current lines.

## Session 2026-11-16T05:58Z — sdd-spec

- Tree: `ccr-47ce6aaf-i0ffis@4e594d1 ≡ origin/ccr-47ce6aaf-i0ffis`, which contains
  `origin/main-dev@5730505`. Same deviation from `docs/sdd/tree-freshness.md` as the earlier sessions:
  `origin/feature/alpaca-adaptive-rate-limit` does not exist yet and the artifacts live only on the
  harness branch, so the tree was not switched to `main-dev`.
- Generated implementation-spec.md with 12 steps in six atomic units (1+2 core, 3+4 marketdata client,
  5+6 marketdata loops, 7+8 trading client, 9+10 trading service, 11+12 config seed).
  Status → implementation-ready. All 37 scenarios are covered (checked mechanically against
  `acceptance.feature`).
- Discovery was inline (no `codebase-discovery` subagent could be spawned from this session); recon
  evidence was reused and every cited line re-read after the `main-dev` merge.
- Key codebase findings:
  - `trading.go` and both Alpaca clients were not moved by the `main-dev` merge; recon's line numbers
    for them still hold. `marketdata/internal/telemetry/otel.go` moved (`RecordVendorRequest` is now
    `:398-406`).
  - Last config migration is `050_ui_chart_history_bars`; this feature uses `051`. The seed column list
    now carries `updated_by` (050 pattern); a bool row stores `value_data` `'true'`.
  - `scripts/check-config-wiring.mjs` reads seeds only from `scripts/config-wiring-stored.json`, which
    needs Postgres, `psql` and `migrate` to regenerate. On this sandbox `psql` is present and `migrate`
    is not, so Step 11 may need the `scripts/Dockerfile.migrate` image.
  - `fakeReconciliationOrderIntentRepo` is the only intent-repo fake that implements every method
    explicitly; the other four embed the interface.
  - The marketdata Start loops read a concrete `*config.Watcher`; `config.MustSnapshotWatcher` exists in
    the marketdata module too, so AC-32 and AC-33 can drive one loop cycle.
- Spec-time decisions awaiting confirmation at `/sdd-review impl-spec` (full list in the spec's
  § "Spec-time decisions"): every service/test pair is an atomic unit; Step 11 is category `migration`
  (adds the DBA reviewer); `pace_test.go` is in-package so the copies stay byte-identical; both
  `export_test.go` files also expose the HTTP transport; the trading budget closure is the named method
  `alpacaRateLimitBudget`; the budget table test moved from Step 10 to Step 8; log messages, error
  formats and the three config descriptions are fixed in the spec.
- Finding against `design.md` § 7 test notes: it lists AC-2, AC-7, AC-20, AC-24 and AC-36 as the
  guards. AC-8, AC-9, AC-10 and AC-11 also describe behavior today's code already has. The spec labels
  all nine as guards and names a mutant for each.

### Open Threads (after sdd-spec)

- [x] AC-37's new `backfill.rate_limit_rps` description text is fixed in Step 11.
- [ ] File the pre-existing `ReplaceOrder` defect (intent inserted before `validateTIF`,
  `trading/internal/service/trading.go:1531` vs `:1575`). Not filed by `/sdd-spec`:
  `.claude/skills/sdd-qa/reference/defect-filing.md` requires the user to confirm the report first.
- [ ] Owner + config-team approval for the two new keys before the Step 11 unit merges.
- [ ] Re-derive the config migration number at Step 11 and at the integration PR.
- [ ] Record a real paper-host response (are `X-RateLimit-*` headers sent?) at the integration PR.
- [ ] The remaining design open risks are mapped to steps in the spec's § Step Dependencies.

## Session 2026-11-16T07:00Z — defect filed

- Operator confirmed filing the pre-existing `ReplaceOrder` defect (intent claimed before `validateTIF`):
  `docs/reports/2026-11-16-replace-order-tif-validation-after-intent-claim-defect.md` (status: open).
  Not fixed by this feature. Next: `/sdd-triage --from-report` on that file. The matching Open Thread
  above is done.

## Session 2026-11-16T08:10Z — sdd-review impl-spec (advisory; warning loop, operator-requested)

- Tree: ccr-47ce6aaf-i0ffis, contains origin/main-dev@5730505 (harness-pinned branch, as before).
- Pass 1: 2 failures, 9 warning groups, no Floor risk. Fixed in the spec:
  - F1 (C-05): marketdata kill-switch reader is now the named helper `alpacaAdaptiveRateLimit` with a
    snapshot-based test in `cmd/server/main_test.go` (Steps 3, 4).
  - F2: CI `check-config-wiring.mjs --final` runs on every step PR, so Steps 3 and 7 each add a
    temporary `read-unseeded` entry to `scripts/config-wiring.json` and Step 11 removes both.
  - W1–W9: atomic units reduced to 1+2, 5+6, 9+10; `ci.yml` cite; `GOWORK=off` coverage command;
    trading key test asserts the seeded value; test names `Test<Subject>_F347_AC<N>` with exact PASS
    counts; anchors and trading-domain notes; `grep` exit codes; Docker-based stored-set regeneration
    plus the heal dry-run; Step 11 six-file justification.
  - Moves: the `alpaca-integration.md` edit went from Step 3 to Step 5; the trading `CLAUDE.md` edits
    from Step 7 to Step 9.
- Pass 2: 0 failures, 1 warning (Step 11's stored-set key count matched 6 lines, not 4). Fixed.
- Pass 3: swept every Verification command and recomputed every count; nothing else found. Its only
  item was that the pass 2 fix had not been applied (the edit had aborted); it is applied now
  (`implementation-spec.md:795`), which is the condition the reviewer gave for "No failures, no warnings".
- Result: 0 failures, 0 warnings. Unresolved ✗ / ⚠ carried into execution: none.
- Overlap findings: no FAIL-level collision (migration 051, both keys and `internal/alpacapace/` are
  unclaimed). Seven same-file overlaps (322, 323, 311, 312, 321, 341) recorded in
  `docs/roadmap/features/merge-order.md`.

## Session 2026-11-16T08:40Z — branch sync before merging the docs PR

- `origin/main-dev` moved again (340, 343 merged); merged into `ccr-47ce6aaf-i0ffis` with no conflict.
- Feature 343 landed `051_ingest_backfill_self_serve_keys`, so this feature's config migration is now
  **052** (`052_alpaca_adaptive_rate_limit_keys`). product-spec.md, design.md, implementation-spec.md
  and the merge-order note were updated. The number is still re-derived at Step 11.
- main-dev also changed files the implementation spec cites by line:
  `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go`,
  `internal/fmp/fmp_client_test.go`, `internal/repository/marketdata_repo.go`,
  `scripts/config-wiring-stored.json`, `docs/patterns/config-governance.md`. The spec's line anchors in
  those files were NOT re-verified after this merge; `/sdd-execute` discovery must re-read them
  (Step 4, Step 6, Step 11).

## Session 2026-11-16T06:47Z — sdd-execute (sequential): boot, validation, re-spec

- Operator decisions (asked and answered this session): (20) run `/sdd-execute` in **sequential** mode,
  all 12 steps; (21) the step commits go to `feature/alpaca-adaptive-rate-limit`, which the operator
  authorized this cloud session to create and push (the harness pins it to `ccr-f38bde65-c8sy8s`
  otherwise); (22) Step 11 may start a throwaway Postgres 16 **only to generate**
  `scripts/config-wiring-stored.json` and the fresh heal dry-run — the migration itself is still verified
  offline; (23) re-spec Steps 5, 6 and 11 before executing.
- Tree: `feature/alpaca-adaptive-rate-limit@b34dc48 ≡ origin/main-dev` at branch creation.
- Validation (three `codebase-discovery` runs, all stamped with the tree above): every cited file and
  symbol exists. Steps 1-4, 7-10 and 12: no drift. Steps 5, 6: `marketdata_service_test.go` anchors from
  `fakeQuoteStore` down moved +37 lines. Step 11: stored-set lines +24; a feature 343 entry now tops the
  registered-keys log. `052` is still the next free config migration number.
- Re-spec (the sole sanctioned step-body edit, sequential-mode §5.3), no instruction changed:
  - Step 5: seven test call-site lines updated; "two production call sites" corrected to three
    (`marketdata_service.go:1387`, the call inside `ingestRecentBars`, was not counted).
  - Step 6: lines of the Start-loop comment, five fakes and the registry pattern updated.
  - Step 11: stored-set lines updated; the 347 registered-keys entry goes at the top of the log, above
    the 343 entry, still modelled on the 341 entry.
- Not re-spec'd, recorded here: `sweepIntentRepo` (`trading/internal/service/trading_telemetry_test.go:98`)
  also embeds `OrderIntentRepository` and is not in Step 9's implementer list. It compiles unchanged.
- Assumptions stated to the operator at the up-front confirm: checkpoints after Step 4 and Step 8 (no
  atomic unit is split); plain Postgres 16 is enough for the stored set (config migrations use no
  extension), CI's `config-wiring-stored` job is the cross-check; approvals (owner, config team, DBA)
  are obtained by the operator on the integration PR; the paper-host header check needs Alpaca
  credentials this sandbox does not hold and stays open.
- Tooling setup (steps 1-12): go1.27.0 ✓ · golangci-lint ⬇ v2.14.0 (built with go1.27.0) · uv ✓ ·
  ruff/pytest ✓ (uv) · pnpm ✓ 9.15.9 · Node 24 ✓ (`/opt/node24`, for Step 12) · `migrate` ⬇ v4.17.1 and
  local Postgres 16 binaries ✓ (Step 11 stored-set generation only).

### Step 1 — service: pacing core `internal/alpacapace` in both services, with copy governance [done]
- Atomic unit with Step 2. `pace.go` written in marketdata and copied byte for byte to trading; groups
  `go-alpacapace` and `go-alpacapace-test` added to `check-watcher-copies.py`; `.jscpd.json` ignore and
  the `dry-guard-rail.md` exemption added.
- Files modified: both `internal/alpacapace/pace.go`, `scripts/check-watcher-copies.py`, `.jscpd.json`,
  `docs/patterns/dry-guard-rail.md`
- Implementation note: the window keeps the header's raw `Reset` beside the clamped one, so "replace
  only when Reset advances" compares header values and a clamped 60-65 s reset is not re-replaced by
  every later response of the same window.
- Deviations: none

### Step 2 — test: core arithmetic and the copy gate [done]
- Atomic unit with Step 1. 18 in-package tests; one new pytest for the two groups.
- TDD (AC-1, 3, 5, 13, 19, 24 core arithmetic): red — with `pace.go` as zero-value stubs all 18 tests
  failed on assertions (`FAIL github.com/xstockstrat/marketdata/internal/alpacapace`), and the new
  pytest failed with `KeyError` (groups absent) → green — 18/18 pass with `-race` in both modules,
  coverage 100.0% of statements; pytest 6 passed; `golangci-lint` 0 issues in both services; ruff clean;
  `check-watcher-copies: all groups byte-identical`.
- Files modified: both `internal/alpacapace/pace_test.go`, `scripts/tests/test_check_watcher_copies.py`
- Deviations: none

### Step 3 — service: marketdata Alpaca client paces from headers and retries a 429 [done]
- `do` keeps today's body when `AdaptiveRateLimit` is false and otherwise calls `doPaced` (Reserve →
  static limiter → attempt → Observe → 429 retry). Seams `now`/`sleep`/`jitter`, one `newClient`
  helper for both constructors, the named reader `alpacaAdaptiveRateLimit`, docs, and one temporary
  `read-unseeded` entry in `scripts/config-wiring.json` (Step 11 removes it).
- Verification: build ok; existing `internal/alpaca` and `cmd/server` tests pass; `check-config-wiring
  --final` exit 0, `--doc-check` exit 0, `--declared-from` prints `PENDING … read-unseeded` (non-blocking
  at step time); `httpClient.Do` appears only in `do` and its attempt helper `sendAttempt`.
- TDD: paired with Step 4 (red captured there with these fields and seams present and the loop off).
- Files modified: `services/xstockstrat-marketdata/internal/alpaca/client.go`, `cmd/server/main.go`,
  `CLAUDE.md`, `docs/context-constitution.md`; `scripts/config-wiring.json`
- Interpretation recorded (spec was silent): the throttle WARN is emitted for every non-zero adaptive
  wait — a spread slot as well as a hold or a 429 wait — gated by `WarnOnce` with the wait's end as
  the window. `Reservation` does not say whether a wait is a slot or a hold, so the client cannot log
  holds only without widening the core API. Raised at the Step 4 checkpoint.
- Deviations: none

### Step 4 — test: marketdata client pacing, retry, telemetry and the FMP guard [done]
- 14 scenario tests plus the static-ceiling refusal case in `client_test.go` (fake clock, scripted
  `RoundTripper` that keeps the Alpaca host, WARN recorder), the FMP guard, and the kill-switch reader
  test in `main_test.go`. `export_test.go` exposes exactly four setters.
- TDD red (Step 3 fields and seams present, `do` a single attempt): FAIL — AC-1, AC-3, AC-4, AC-5,
  AC-6, AC-14, AC-19, AC-21, AC-22 and the static-ceiling refusal case, each on an assertion. Guards
  passed as designed ("red N/A — pins unchanged behavior"): AC-2, AC-7, AC-8, AC-9, AC-24, AC-11.
- Guard mutants run this session, each turning its test red: AC-2 key by credential only; AC-8 a
  missing header read as `Remaining 0`; AC-24 refuse a caller that cannot wait for its slot; AC-7 skip
  the static limiter when adaptive; AC-9 ignore the switch. AC-11's mutant (a retry in the FMP client)
  was not run: it needs an edit to FMP production code outside this step.
- TDD green: 15/15 scenario tests pass with `-race` (`F347_AC(1|…|24)` → 15 top-level PASS); the
  reader test passes (1); whole service `go test ./... -race` exit 0; coverage total 85.1% (>= 40%);
  `golangci-lint` 0 issues.
- Files modified: `services/xstockstrat-marketdata/internal/alpaca/export_test.go` (new),
  `internal/alpaca/client_test.go`, `internal/fmp/fmp_client_test.go`, `cmd/server/main_test.go`
- Deviations: none

### Checkpoint after Step 4 — operator decisions
- (24) Proceed to Steps 5+6, 7, 8.
- (25) Throttle WARN scope: **holds and 429 waits only**. Implemented as `Reservation.Hold` in the core
  (both copies) and a `throttled` argument on the marketdata client's `pause`; supersedes the
  "every non-zero wait" interpretation noted under Step 3. See the Deviation Log.
- TDD: red — `pace_test.go` did not compile (`got.Hold undefined`) and `F347_AC3` failed on
  "spreading logged a throttle WARN" → green — 19/19 core tests in both modules (coverage 100.0%),
  16/16 `F347` tests in marketdata, whole service `go test ./... -race` exit 0, lint 0 issues, copy
  gate clean.
- Files modified: both `internal/alpacapace/pace.go` and `pace_test.go`,
  `services/xstockstrat-marketdata/internal/alpaca/client.go`, `client_test.go`

### Step 5 — service: marketdata loops bound their Alpaca calls by the loop interval [done]
- Atomic unit with Step 6. Both Start loops create `fetchCtx` from the live interval; only the four
  vendor calls use it; a per-symbol guard and a later-timeframe guard start no fetch once it expired and
  count the symbols as errors. `alpaca-integration.md` gained the adaptive bullet and the two loop notes.
- Verification: build and vet ok; 17 `fetchCtx` lines; 17 write/tick sites still on `ctx`.
- Files modified: `services/xstockstrat-marketdata/internal/service/marketdata_service.go`,
  `docs/alpaca-integration.md`
- Addition not named by the spec: one WARN `bar ingest: cycle deadline passed, timeframe not fetched`
  when the later-timeframe guard fires (otherwise that skip is silent apart from the heartbeat).
- Deviations: none

### Step 6 — test: loop bounds [done]
- Atomic unit with Step 5. 11 existing call sites pass `context.Background()` twice; three new tests.
- TDD red (new signatures, bodies still on `ctx`): AC-33 "per-symbol bars requests in the cycle = 6,
  want exactly 1"; AC-32 "per-symbol quote requests in the cycle = 3, want 0"; the expired-fetch case
  "vendor calls after the cycle deadline: multi = 1" → green: `F347_AC3[23]` → 2 PASS, the direct case
  passes, whole service `go test ./... -race` exit 0, coverage total 85.1%, `golangci-lint` 0 issues.
- Files modified: `internal/service/marketdata_service_test.go`, `internal/service/bar_hold_test.go`
- Deviations: none

### Step 7 — service: trading Alpaca client paces, retries within the budget and refuses with `ErrRateLimited` [done]
- `broker.ErrRateLimited`; `ClientConfig.RateLimitBudget`; `do` keeps today's body when the budget is
  nil or non-positive and otherwise runs `doPaced` (fail fast, inclusive fit rule, mutations on
  `context.WithoutCancel`, per-attempt timeout `min(T, end − now)`, `GetBody` replay). Pure
  `rateLimitBudget` beside `computeStaleThreshold`; the method `alpacaRateLimitBudget` wired in
  `instantiateBrokerLocked`; one temporary `read-unseeded` entry in `scripts/config-wiring.json`.
- The WARN follows operator decision 25 (holds and 429 waits only), using `Reservation.Hold`.
- Verification: build ok; existing `internal/broker` tests pass with `-race`; `baseURL()` paper/live
  gate present; no diff in `ibkr.go` / `ibkr_session.go`; `golang.org/x/time` absent from `go.mod`;
  `check-config-wiring --final` exit 0 and `--doc-check` exit 0.
- TDD: paired with Step 8 (red captured there with these symbols present, the loop off and
  `rateLimitBudget` returning 0).
- Files modified: `services/xstockstrat-trading/internal/broker/broker.go`, `internal/broker/alpaca.go`,
  `internal/service/order_intent.go`, `internal/service/trading.go`; `scripts/config-wiring.json`
- Deviations: none

### Step 8 — test: trading client retry, budget, refusal and the budget table [done]
- 10 scenario tests in `alpaca_test.go` (fake clock, scripted `RoundTripper` recording method, host,
  path, body and clock time, WARN recorder), four extra client cases (one-timeout read sends exactly
  once; FR-5 degradation; caller cancel during a wait for a mutation and for a read; a 401 on a retry),
  `export_test.go` with exactly four setters, and `trading_rate_limit_test.go` with the two budget tests.
- TDD red (Step 7 symbols present, `do` a single attempt, `rateLimitBudget` returning 0): FAIL — AC-12,
  AC-13, AC-15, AC-16, AC-17, AC-18, AC-23, AC-27, the four extra cases, `TestRateLimitBudget` and
  `TestAlpacaRateLimitBudget_FollowsConfig`. Guards passed as designed: AC-10, AC-20. AC-10's mutant
  ("ignore the budget") was run and turned it red; AC-20's keying is pinned in `pace_test.go`.
- TDD green: `F347_AC(10|…|27)` → 10 top-level PASS; `RateLimitBudget` → 2 PASS; whole service
  `go test ./... -race` exit 0; coverage total 84.7% (>= 40%); `golangci-lint` 0 issues.
- Open risks closed by this step: pollers skip spreading (one-attempt test); FR-5 degradation on hosts
  that send no headers; the clamp and 1 s margin rows of the budget table.
- Files modified: `services/xstockstrat-trading/internal/broker/export_test.go` (new),
  `internal/broker/alpaca_test.go`, `internal/service/trading_rate_limit_test.go` (new)
- Deviations: none

### Checkpoint after Step 8 — operator decision
- (26) Proceed with Steps 9+10, then 11 and 12.

### Step 9 — service: trading handles the rate-limit outcome and bounds its Alpaca-only calls [done]
- Atomic unit with Step 10. `ReleasePendingIntent` (interface + guarded DELETE); `alpacaCallContext`
  at exactly three kinds of site (fill poller `GetOrder`, the not-cancelable re-read, both leg cancels;
  5 occurrences with the definition); `refuseRateLimitedMutation`; `CancelOrder` captures `prevIntent`,
  refuses on `ErrRateLimited` before any local write, and writes CANCELED + finalizes the intent before
  the leg block; `ReplaceOrder` refuses the same way; `flattenAndHalt` halts on the first rate-limited
  submit and keeps retrying. `isUncertainBrokerOutcome` is unchanged. Docs: the key row and the
  corrected `broker.timeout_ms` row, § Adaptive rate limit (budget table and outcomes a–g), `TRADING-8`,
  the TRADING-3 addition, and the reconciliation paragraph.
- Files modified: `services/xstockstrat-trading/internal/repository/order_intent_repo.go`,
  `internal/service/trading.go`, `CLAUDE.md`, `docs/context-constitution.md`, `docs/reconciliation.md`
- Open risk carried, unchanged: `ReleasePendingIntent`'s SQL has no DB-level test; it is one statement,
  `DELETE … WHERE intent_id = $1 AND state = $2 RETURNING intent_id`, for review.
- Deviations: none

### Step 10 — test: trading service rate-limit outcomes and bounds [done]
- Atomic unit with Step 9. Real-client harness (`newRateLimitHarness`: snapshot watcher, a real
  `broker.NewClient` against an `httptest` server built from `brokerCallTimeout` and
  `svc.alpacaRateLimitBudget`, `memIntentRepo`, `ctxCapturingDB`), a fake-broker harness, 11 scenario
  tests, `memIntentRepo.ReleasePendingIntent`, and the panic-convention method on
  `fakeReconciliationOrderIntentRepo`.
- TDD red, on the tree holding Steps 7-8: AC-36 "CancelOrder took 9.35s, want within 1 s"; AC-34 "tick
  took 9.75s, want within 100 ms"; AC-35 "CancelOrder took 19.55s / 20.17s" (both parents); AC-28 "halted
  at each submit = [false false false false]"; AC-29 and AC-30 "error = <nil>, want Unavailable …";
  AC-31 "code = Internal desc = broker replace failed". AC-26 and AC-27 already passed: **red captured
  at the Step 7+8 unit** (they are client behavior). AC-12 and AC-25 first failed on a test-side
  assertion only (the service sends `client_order_id` with its `xss-` prefix); with the assertion
  corrected they pass on the Step 7-8 tree for the same reason as AC-26/27.
- TDD green: `F347_AC(12|…|36)` → 11 top-level PASS with `-race`; whole service `go test ./... -race`
  exit 0; coverage total 84.8%; `golangci-lint` 0 issues; `check-config-wiring --final` and
  `--doc-check` exit 0.
- Blocker raised and resolved (operator decision 27, "Fix the two fixtures"): two pre-existing tests
  broke on nil fixture fields; one line added to each. See the Deviation Log.
- Files modified: `internal/service/trading_rate_limit_test.go`, `trading_flatten_rejection_test.go`,
  `trading_cancel_not_cancelable_test.go`, `trading_reconciliation_test.go`; by deviation
  `trading_telemetry_test.go`, `trading_bracket_test.go`
- Deviations: fixture edits in two files outside `**Files**` (Deviation Log)
