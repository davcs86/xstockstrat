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
