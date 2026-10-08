# Context Log: proto-deprecated-field-removal-program

## 2026-09-19 — routed from today's triage (NOT implemented)

Defect 2 of `docs/reports/2026-09-18-deprecated-fields-in-rpc-contracts-defect.md` (the 33
`[deprecated = true]` proto fields) was **explicitly kept out** of the today's-triage bug PR and
routed here as a `draft` SDD story, with operator sign-off on scope.

**Why it is a program, not a today-fix:**
- Every removal trips `buf breaking` by design and needs the v-migration workflow.
- Approval is **2 owners + platform lead** per breaking proto change — a harness bug-fix session
  cannot supply the human approvers.
- The report's inventory is a *candidate* list, not verified-dead: `portfolio.proto:235 symbols` has
  a live reader (`live_loop.py:525`) and staging returns it populated — proof that per-field reader
  audits are mandatory.
- The enum-value cohort has stored numeric values → needs a data audit before anything is touched.

Count re-verified against `main-dev`: `grep -rn 'deprecated = true' packages/proto/*/v1/*.proto` → 33.

**Next:** `/sdd-design` to grill sequencing (safest cohort = the 12 already-ignored `user_id` body
fields), confirm BSR/external-consumer exposure, then `/sdd-spec`. No code was written for this
feature in the today's-triage session.

## Session 2026-09-19 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Verdict: **PASS WITH WARNINGS** (no blockers, no Floor breach).
- Criteria pass (spec-reviewer): inventory count (33) and constraints code-verified; warnings were formal-section gaps + 2 grounded citation errors.
- Fixes applied before advancing:
  - `live_loop.py:493` → `:525` (reader line shifted by feature 193's R2 edit; verified `_drain_watchlist` `wl.symbols` fallback) — product-spec.md, feature.md, context.md.
  - approval citation `docs/runbooks/approval-flow.md` (order approval) → root CLAUDE.md § Approval Flow + `docs/runbooks/proto-versioning.md` — product-spec.md, feature.md.
  - Added `## Consumer Surface(s)` (None — internal/platform-only, C-14), `## Out of Scope`, `## Open Questions` (BSR/external-consumer exposure) to product-spec.md.
  - Added `@AC-4` (enum-value reservation) to acceptance.feature — closes the constraint-2 enum-reservation coverage gap.
- Deferred to /sdd-design (per reviewer): no numbered `## Functional Requirements` / `@FR-N` tags (program has no FR-N; the numbered Hard constraints serve the role) — expand at design/spec.
- Overlap findings: NO FAIL-level collision. Only a rebase-only textual overlap with feature 032 (walk-forward-backtesting) on `analysis.proto` — region-disjoint (032 adds a new `RunSegmentedBacktest` message; 196 removes `ListStrategiesRequest.user_id`), different message, no field-number clash. Both `draft`. Re-run overlap at /sdd-spec (Mode B); no merge-order row required now.

## Session 2026-09-19 — sdd-design (steer at Round-2 gate)

- Rounds 1-2 (full) converged on Option 1 (park / deprecate-don't-delete) because in-place
  removal violates PROTO-2 + BSR + no procedure. No Floor breach.
- **User steer at the gate:** "Filter out the deprecated fields from the responses, not from the
  proto definitions." → a NEW approach (Option 4, response-edge omission): keep the proto fields
  (`[deprecated=true]`) intact, but stop **populating** them in outbound responses. Same pattern as
  feature 194/R1-D1 (strip dead `signal_params` keys at the read edge). Key advantage: NOT a proto
  change → not a `buf breaking` change → no v2, no BSR schema break, no 2-owner/platform-lead gate;
  implementable as a normal runtime change.
- Running Round 3 to pressure-test Option 4 against the recon reader-audit (which deprecated fields
  actually appear in responses, and whether omitting them silently breaks in-repo/external readers).

## Session 2026-09-19 — sdd-design (completion)

- Phase 0 Recon: wrote recon.md (services: analysis/config/indicators/ingest/marketdata/portfolio/
  trading + ui/agent; key reuse: deprecate-don't-delete PROTO-2, header-authoritative identity,
  timeframe_enum co-emission). Decisive facts: in-place removal violates PROTO-2 + no procedure + BSR
  external consumers; only ~12 of 33 are dead (10 user_id + is_paper + VALUE_TYPE_FLOAT_MAP).
- Phase 1 Grilling: 3 rounds (full). R1-R2 converged on park (Option 1); **user steered at R2 gate to
  response-edge omission** (keep proto fields, stop populating in responses — feature-194 pattern). R3
  pressure-tested it and caught the `barFromAlpaca` DB-coupling trap (omitting there corrupts the ohlcv
  store, breaks @AC-1/@AC-2/@AC-3).
- Chosen approach: response-edge omission. Per-field — KEEP Watchlist.symbols (live reader + mirror);
  EXCLUDE Bar.timeframe@barFromAlpaca (DB write-path); GATED Bar.timeframe@scanBars+stream.go:247 &
  BackfillJob.timeframe@servicer.py:149 (external-consumer confirmation gate); NO-OP the 10 dead
  request-only user_id + is_paper + operation + request timeframes; enum values OUT OF SCOPE.
- Constitution touched: C-10/C-14 (all producer paths + consumer surfaces), C-15 (@AC-1/@AC-4
  annotated out-of-scope not inverted; @AC-2/@AC-3 remain valid), C-16 (PRESERVE all; PROTO-2 kept
  intact so no structural CHANGE/sign-off), C-18 (reversibility tie-breaker), P-03/F-11 (no Floor breach).
- Status: spec-ready → design-approved. **Implementation steps GATED** (non-executable this session —
  external BSR-consumer proof required). Open Threads: (1) per-field consumer-confirmation gate must
  clear before any omission ships; (2) if the gate never clears, shipped outcome = zero code change
  (equivalent to park, acceptable — PROTO-2 already prevents number reuse).

## Session 2026-09-19 — sdd-review product-spec (re-run) + reconciliation

- Re-ran the AI review at operator request (status was design-approved). Overlap: **CLEAN** (the
  omission approach removed the prior 032 analysis.proto overlap; note: feature 188 reads
  Bar.open/high/low/close while 196 omits Bar.timeframe — disjoint fields).
- Criteria pass: **FAIL** — product-spec still framed removal+reserved (contradicts the approved
  omission design); @AC-1/@AC-4 asserted rejected behavior; no @FR-N traceability.
- **Addressed all blockers + actionable warnings:**
  - Rewrote product-spec.md to the response-edge-omission approach (Objective, Governance gates → no
    breaking-change approval, added a framing-update banner, per-field plan, Affected Services in
    registry names + Inventory labeled as proto modules, trading-domain no-op note).
  - Added numbered ## Functional Requirements FR-1..FR-6 (KEEP / omit-pure-edges-only / GATED+gate /
    proto-unchanged / request-only-no-op / enum-out-of-scope).
  - acceptance.feature: kept @AC-1..@AC-4 (append-only); annotated @AC-1/@AC-4 @out-of-scope
    @rejected-removal; tagged @AC-2→@FR-1, @AC-3→@FR-6; appended @AC-5(@FR-4)/@AC-6(@FR-3)/
    @AC-7(@FR-1)/@AC-8(@FR-2)/@AC-9(@FR-5). Every FR now covered by ≥1 @AC.
- Status unchanged (design-approved). Proceeding to /sdd-spec with the reconciled spec.

## Session 2026-09-19 — sdd-spec

- Generated implementation-spec.md with **7 steps**. Status → `implementation-ready`. All 7 steps
  carry `**Status**: blocked` — every one depends on Step 1 (the FR-3 consumer-confirmation gate),
  which cannot clear in a harness session (external BSR consumers cannot be enumerated). Faithful to
  design.md's "encode as gated steps, not runnable ones"; zero-ship if the gate never clears.
- Step layout: Step 1 = FR-3 gate (docs, records sign-off in context.md); Steps 2-3 = marketdata
  Bar.timeframe omission at the two pure edges + test; Steps 4-5 = ingest BackfillJob.timeframe
  omission + test; Step 6 = portfolio Watchlist.symbols KEEP guard; Step 7 = proto-integrity /
  enum-retention / request-only no-op verification.
- Scenario coverage (C-15): @AC-2/@AC-7→Step 6; @AC-3/@AC-5/@AC-9→Step 7; @AC-6→Step 5; @AC-8→Step 3.
  @AC-1/@AC-4 deliberately covered by no step (tagged @out-of-scope @rejected-removal).
- Key codebase findings (grep-verified this session, exact lines):
  - GATED omittable edges: `marketdata_repo.go:144` (scanBars `Timeframe: tf`, enum co-emit `:153`);
    `stream.go:247` (`Timeframe: streamBarTimeframe`, enum co-emit `:255` = deprecated TIMEFRAME_1MIN,
    accepted Open Risk); `ingest servicer.py:149` (`timeframe=row[...]`, enum co-emit `:152`).
  - EXCLUDE (feeds persistence, NOT omittable): `alpaca/client.go:142` `barFromAlpaca` → `InsertBars`
    (`marketdata_repo.go:71` reads `b.Timeframe`) → `ohlcv.timeframe` column; `QueryBars` filters
    `WHERE symbol=$1 AND timeframe=$2` (`:100`). Omitting here corrupts the store (@AC-8).
  - KEEP readers confirmed live: `portfolio_service.go:1691` (`AddWatchlistSymbols` cap from
    `existing.Symbols`); `analysis live_loop.py:525` (`wl.symbols` legacy-row fallback).
  - No migrations, no config keys, no new env vars/ports (proto-only feature; recon confirmed).
- Reviewers snapshot written to feature.md: Proto Reviewer, Platform Lead, marketdata/ingest/portfolio
  owners.

### Open Threads (carried)

- **The FR-3 gate is the sole blocker.** `/sdd-execute` must hold at Step 1 until: (1) every named
  consumer (analysis GetBars reader, `xstockstrat-ui` backfills page, agent) is grep-confirmed reading
  `timeframe_enum` not the string; (2) the BSR deprecation window is formally closed; (3) sign-off is
  recorded here. Until then, Steps 2-7 stay `blocked` and nothing ships. Zero code change if the gate
  never clears is an accepted, design-recorded park-equivalent outcome — not a spec defect.

## Session 2026-09-19 — sdd-review impl-spec (advisory)

- Result: **0 failures, 3 warnings** (PASS WITH WARNINGS; advisory — did not block). No Floor risk.
  Overlap: CLEAN (no in-flight feature touches 196's marketdata/ingest producer edges). 7/7 steps
  grounded; EXCLUDE (barFromAlpaca) and KEEP (Watchlist.symbols) fences + C-08 pairing verified.
- Warnings — resolution:
  - Step 5 `**Files**` named a directory (B2 exact-path) — [x] fixed: now `tests/test_backfill_jobs.py`.
  - Step 1 evidence cited a stale UI line (`page.tsx:37-38,112`) — [x] fixed: real `timeframeEnum`
    bind is `page.tsx:138`.
  - Steps 3 & 6 report service-wide coverage (changed edges sit in CI-excluded `repository/`,`alpaca/`
    packages) — [x] accepted (disclosed in-spec; acceptable, no change).
- No unresolved items carried into execution. Note: execution itself remains blocked on the FR-3
  external-consumer gate (Step 1) — unchanged by this review.

---

## Session 2026-09-26 — sdd-review impl-spec (advisory)

- Result: 0 failures, 5 advisory warnings (C-01/C-15) + 1 prominent NOTE. No Floor breach. Overlap: one soft, disjoint-region file overlap with feature 211 on `internal/repository/marketdata_repo.go` (196 = `scanBars` read edge; 211 = dividend upsert + cache invalidation) — rebase-only, and MOOT here since both land sequentially on the single branch `claude/pending-roadmap-features-9z01mn`.
- **NOTE — premise reconciliation (surface to user).** The approved design (`design.md`) is **response-edge omission, NOT proto field removal + `reserved`**. Reviewer verified: `.proto` files untouched (`marketdata.proto:76`, `ingest.proto:75` deprecated fields still defined), zero `reserved` statements repo-wide, `buf breaking` asserts NO break. Therefore this is **not a breaking proto change** and the "2 owners + platform lead" breaking-proto gate is **NOT triggered** by the design as specced. The `feature.md` **Type** header ("breaking-change program — governance-gated") is stale relative to the approved non-breaking design. Left `feature.md` Type unchanged pending user decision on whether to re-label; the impl-spec/design are internally consistent (non-breaking).
- Items carried into execution:
  - Step 1: [x] `backfills/page.tsx:138`→`:151` corrected; added concrete `path:line` for the analysis `timeframe_enum` reader (`servicer.py:1151`, `live_loop.py:575,642`, `screener.py:224`) and the agent bar/backfill tools (`client.py:1686,:1811`) — the governance-crux gate is now mechanically verifiable.
  - Steps 2/4/6: [ ] systematic line-number drift (all cited symbols RESOLVE; lines stale ~2–15). `/sdd-execute`'s mandatory codebase discovery re-grounds every citation at execute time — the spec line numbers are advisory anchors, not load-bearing. No F-04 breach.
  - C-15: [x] `@AC-1`/`@AC-4` uncovered-by-design carve-out CONFIRMED legitimate — `acceptance.feature:12,19` carry `@out-of-scope @rejected-removal`.

---

## Session 2026-09-26 — sdd-execute (sequential): Step 1 in-repo reader audit (half a) complete; feature PARKED

Per the operator decision at the sequential-run checkpoint ("do the audit half, then park"), the
**in-repo** half of the Step 1 FR-3 consumer-confirmation gate was executed. No code changed; Steps
2–7 remain `blocked`, and Step 1 remains `blocked` pending the **external** half (BSR-consumer
enumeration + Proto Reviewer + Platform Lead sign-off), which cannot be discharged autonomously.

### In-repo reader audit — RESULT: no internal consumer reads either gated deprecated STRING field

Gated fields: `Bar.timeframe` (marketdata, string) and `BackfillJob.timeframe` (ingest, string).
Replacement enum: `timeframe_enum`.

- **analysis** (`services/xstockstrat-analysis/app`): `grep '\.timeframe\b'` minus `_enum` → **zero** bare-string reads. Callers bind the enum: `app/handlers/servicer.py:1151`, `app/engine/live_loop.py:575,642`, `app/services/screener.py:224` (all `timeframe_enum=common_pb2.Timeframe.TIMEFRAME_1DAY`). Documented at `app/docs/warmup.md:54`. ✓ safe to omit `Bar.timeframe`.
- **agent** (`services/xstockstrat-agent/app`): the only `.timeframe` read is `client.py:742` `common_pb2.Timeframe.Name(g.timeframe)` where `g` ∈ `resp.coverage_gaps` — i.e. `CoverageGap.timeframe`, a **Timeframe ENUM** field (its int is fed to `Timeframe.Name()`), **not** the gated `Bar.timeframe`/`BackfillJob.timeframe` string. Agent SENDS `timeframe_enum` in bar/backfill requests (`client.py:1686,1811`). ✓ no deprecated-string consumer.
- **xstockstrat-ui backfills page** (`src/app/insights/backfills/page.tsx`): all `timeframe` usages are the **enum** delete-form selector (`Timeframe.TIMEFRAME_UNSPECIFIED` option `:468`, `delTimeframe` `:187`) and the create request `timeframeEnum` (`:151`) — no read of the deprecated `BackfillJob.timeframe` string for display. ✓

**Conclusion**: the internal-consumer precondition for omitting `Bar.timeframe` (@ scanBars/stream) and `BackfillJob.timeframe` (@ job_row_to_proto) is **satisfied**. A human owner need only complete the external half.

### Remaining to clear Step 1 (external half — human, not autonomous)
1. Announce the deprecation window (features 053/080/143) **closed** to BSR consumers per `docs/runbooks/proto-versioning.md`.
2. Record **Proto Reviewer + Platform Lead** sign-off in this context.md.
Only then may Steps 2–7 move off `blocked`. Until then 196 ships **zero code change** (the design's accepted park-equivalent outcome — `design.md:84–86`).

**Sequential run**: parked 196, advanced to feature 213. No 196 files other than this context.md changed.

---

## Session 2026-10-08 — sdd-execute (sequential, operator-authorized autonomous run)

**Operator decisions this session (AskUserQuestion, recorded verbatim):**
- FR-3 gate: **"Sign off, no ext consumers"** — the repo owner, acting as **Proto Reviewer + Platform
  Lead**, attests that no external consumer reads the `buf.build/xstockstrat/contracts` BSR module and
  declares the feature-053/080/143 deprecation window for `Bar.timeframe` / `BackfillJob.timeframe`
  (string) **closed**. This discharges the external half of Step 1.
- Execution mode: **fully autonomous** — the operator's reply stands in for the §5.1b/§5.4
  confirmations and the checkpoint gates (checkpoints are still reported, not gated).

### Step 1 — FR-3 consumer-confirmation gate [done]
- In-repo half re-run against `main-dev` @ `a988b1d6` (the 2026-09-26 audit predates features 211–224):
  - analysis / agent / ingest Python: `grep -rnE '\.timeframe\b' services/*/app --include=*.py | grep -v _enum`
    → only `agent/app/client.py:772` (`CoverageGap.timeframe`, a `Timeframe` **enum** field) and an
    ingest docstring. No read of the gated strings.
  - Go: every `.Timeframe`/`GetTimeframe()` hit is a **request** field (`req.Timeframe`, out of scope
    FR-5) or `InsertBars`' write of source bars (`marketdata_repo.go:73`, EXCLUDE edge).
  - UI: no `.timeframe` read anywhere in `services/xstockstrat-ui/src`; backfills page binds
    `timeframeEnum` (`page.tsx:151`).
- External half: discharged by the operator sign-off above.
- Visible side-effect (not a contract break): the agent's `query_bars` tool serializes bars with
  `MessageToDict`, so its per-bar `"timeframe"` key disappears while `"timeframe_enum"` stays. No agent
  test or strat-lab skill reads that key.
- Files modified: `feature.md` (Development Branch assigned, Type re-labelled to the approved
  non-breaking design — closes the 2026-09-26 review NOTE), `implementation-spec.md` (Step 1 → done,
  Steps 2–7 → pending), `status.md` (→ in-progress), `context.md`.
- Deviations: none.

### Steps 2–3 — marketdata `Bar.timeframe` omission + tests [done]
- `scanBars` (shared by `QueryBars`/`QueryRecentBars`/`QueryBarsBatch`) and the stream `dispatch` no
  longer set the deprecated string; `TimeframeEnum` unchanged. The two service paths that return
  `barFromAlpaca` bars directly now clear it after persistence (D-1). `barFromAlpaca` and `InsertBars`
  untouched (EXCLUDE).
- TDD red (before the change): `TestDispatchBarCarries1MinEnum` got "1m";
  `TestScanBars_OmitsDeprecatedTimeframeString` got "1d"; `TestBatchGetBars_ColdPathOmitsDeprecatedTimeframe`
  got "1d"; `TestTruncateBars_OmitsDeprecatedTimeframe` got "1d" (both branches). Green after.
- Verification: `go test ./... -race` all ok; CI-scoped coverage **70.9%** (≥40%); `golangci-lint run`
  → 0 issues.
- Files modified: `services/xstockstrat-marketdata/internal/{repository/marketdata_repo.go,repository/marketdata_repo_test.go,alpaca/stream.go,alpaca/stream_test.go,service/marketdata_service.go,service/marketdata_service_test.go}`
- Deviations: D-1, D-2, D-3, D-4 (Deviation Log). Steps committed together so no commit is red.

### Steps 4–5 — ingest `BackfillJob.timeframe` omission + tests [done]
- `job_row_to_proto` drops the `timeframe=` keyword; `timeframe_enum` unchanged. Request-side string
  handling untouched (FR-5). Covers all three read paths (Get/List/Cancel) since they share the mapper.
- TDD red: 5/6 `TestJobRowTimeframeEnum` cases failed (got the stored string); the `""` case passed
  trivially. Green after: `pytest --cov=app` 308 passed, **79.99%**; `ruff check` / `ruff format --check` clean.
- Files modified: `services/xstockstrat-ingest/app/handlers/servicer.py`, `services/xstockstrat-ingest/tests/test_ingest_servicer.py`
- Deviations: D-5 (test home).

### Step 6 — KEEP guard for `Watchlist.symbols` [done]
- Added `TestWatchlistSymbolsMirror_KeptForCapAndResponses_Feature196` (service) and
  `TestBindingSymbols_MirrorsBindings_Feature196` (repository). No production code changed.
- TDD red by mutation (reverted, `git diff` empty): cap computed without `existing.Symbols` → add "D"
  returned `<nil>` instead of InvalidArgument; `bindingSymbols` emptied → repo guard FAIL. Green after
  restore. Full suite `-race` ok, CI-scoped coverage **54.4%**, `golangci-lint` 0 issues.
- Files modified: `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go`,
  `services/xstockstrat-portfolio/internal/repository/watchlist_repo_test.go`
- Deviations: D-6.

### Step 7 — proto integrity / enum retention / request-only no-op [done]
- `git diff origin/main-dev -- packages/proto/` empty (no `.proto`, no generated-stub change); `buf lint`
  OK; `buf breaking --against main-dev` → no change (buf 1.72.0 installed via `go install`, D-4 style).
- Deprecated enum members (`TIMEFRAME_1MIN/_15MIN/_1HOUR`, `ENVIRONMENT_DEV`, `VALUE_TYPE_FLOAT_MAP`)
  still defined + `[deprecated = true]`; 38 `deprecated = true` occurrences (33 at triage + later features; none removed).
- Request-only: trading identity is header-authoritative (`propagation.go:36` `UserID: first(md.Get("x-user-id"))`).
- TDD: N/A (verification only).

### Integration (ALL-DONE)
- C-16 promotion: @AC-8 → `services/xstockstrat-marketdata/acceptance/proto-deprecated-field-removal-program.feature`;
  @AC-6 → ingest suite; @AC-2/@AC-7 → portfolio suite; @AC-3/@AC-5/@AC-9 → `docs/sdd/business-rules/platform.feature`.
  @AC-1/@AC-4 not promoted (`@out-of-scope @rejected-removal`).
- Teardown (context drift, by hand — `/context-forge:context-constitution` is not available in this
  session): `services/xstockstrat-marketdata/CLAUDE.md` (stream bars "carry the canonical `1m`
  timeframe" → labelled via `timeframe_enum`, string not populated) and
  `services/xstockstrat-marketdata/docs/context-constitution.md` MARKETDATA-1 (string written back onto
  the **source** bar for `InsertBars`, never returned). Re-read `packages/proto/docs/context-constitution.md`
  PROTO-2 + the `timeframe` naming note: still true (fields remain defined). Ingest/portfolio CLAUDE.md
  do not describe the changed fields.
- Merge-order: 196 has no row in `merge-order.md`.

## Session 2026-10-08 — sdd-execute
**Steps this session**: 1–7
**Progress**: 7 done / 7 total
**Stopped at**: all complete
**Next**: merge the integration PR; then `/promote`.
