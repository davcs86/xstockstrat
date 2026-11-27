# Design: fix-gapsonly-backfill-is

**Created**: 2026-11-26
**Rounds**: 2 (full; termination: approved, with open risks accepted by the operator at the gate)
**Approved by**: user (operator) @ 2026-11-26, at the design gate, Floor clear
**Grounded in**: recon.md
**Debate register**: debate.md (D-1..D-10, R-1..R-9, O-1..O-9)

---

## Chosen Approach

The fix has two parts. Marketdata reports every missing daily session as a gap, including interior
holes. Ingest then fills those gaps and checks afterwards that they were filled. A GAPS_ONLY job
never ends COMPLETED while a requested session is still missing in the store, except for the head-gap
carve-out the operator accepted (§3 below).

**Operator override of the register.** D-10 records the head-gap probe lookback K as 365 days. The
operator decided on 2026-11-26 (design gate, O-1, answer "Expand it to 730 days") that **K = 730
days**, matching `ingest.backfill.self_serve_max_range_days = 730`. Every "365d" in D-10 and the
round-2 synthesis reads as 730d. K is a fixed code invariant, not a config key (F-07 convention, as in
the marketdata `CLAUDE.md` § "Adaptive rate limit — fixed invariants"). It is to be recorded in the
ingest `CLAUDE.md` in the same PR.

### 1. marketdata: session-aware gaps (D-1, D-5)

- Add the pure function `timeframe.ComputeSessionGaps` beside `ComputeGaps` and `type Gap`
  (recon.md:31-33, `internal/timeframe/timeframe.go:77,84`). Today `ComputeGaps` can only express
  head and tail gaps (recon.md:32).
- The 1d coverage read becomes one query: `MIN/MAX/COUNT + array_agg(time ORDER BY time)`, with the
  same predicate as today (recon.md:34, `marketdata_repo.go:243-247`). It is wired into
  `MarketDataService.GetDataCoverage` at the existing `ComputeGaps` call site (recon.md:26-30).
- Gaps are bounded at the last completed session (`marketsession.Reference(now)`, live=false). Runs
  of consecutive missing sessions are merged.
- `TestComputeSessionGaps` pins the **separation invariant**: two consecutive reported gaps always
  have at least one stored session between them. This extends the existing `TestComputeGaps`
  (recon.md:41).
- The trading-session oracle is the shared `marketsession` package (recon.md:36-40, 105). The
  one-off NYSE closures since 2000 are added to `isHoliday` (`marketsession.go:74`). No second
  calendar is built. This pins the calendar the review asked for (recon.md:150).
- The wire shape is unchanged. `GetDataCoverageResponse.gaps = 7` already carries N gaps
  (recon.md:106, 139), and `covered_ranges` is not rewritten (R-5, recon.md:153). 15m/1h stay
  permissive (recon.md:157).

### 2. ingest planner: coalesce gaps per symbol (D-6)

- `_plan_work_ranges` today emits one `([sym], gs, ge)` unit per `cov.gaps` entry (recon.md:45-48,
  `servicer.py:807-810`), and each unit is chunked on its own (`:829-832`).
- Under GAPS_ONLY it now merges each symbol's consecutive gaps into one unit, as long as the merged
  span (first gap start to last gap end) stays within `backfill.chunk_window_days` (default 90,
  read from config: recon.md:67, 141). The planner then emits `([sym], merged_start, merged_end)`.
  `overwrite=false` makes re-fetching the stored sessions between gaps harmless.
- The planner still calls `GetDataCoverage` with `range=request.range` unchanged (`:801-806`).
- RED pytest: about 40 scattered one-session gaps in a year yield at most about `ceil(365/90)` units
  for the symbol.
- O-9 is carried to `/sdd-spec` and must be confirmed there: the exact boundary rule, and whether
  `plan_chunks` still splits by `chunk_max_bars` inside a merged unit.

### 3. ingest verify: `_verify_gaps_only` (D-2, D-3, D-10)

**When it runs.** The new method runs between `_run_chunks` and `_finalize_backfill`, on both the
fresh path and the resume path (recon.md:49-59). It is skipped for canceled jobs. It covers only
symbols that had planned units and whose merged outcome is not SKIPPED, which keeps
`@AC-23 @feature-352`.

**What it checks.** It re-calls `GetDataCoverage` with the planner's call shape (recon.md:110):

- `gaps[1:]` are missing by construction, because of the separation invariant.
- `gaps[0]` counts as missing only when one store probe,
  `GetDataCoverage(range=[gaps[0].start − 730d, gaps[0].start))`, returns `bars_total > 0`.
  Otherwise `gaps[0]` is the head (pre-listing) carve-out. The probe compares no timestamps against
  earliest/latest, so R-3 is not reintroduced.

**Outcomes.**

- **Still-missing symbol.** The symbol gets
  `{outcome: BACKFILL_SYMBOL_OUTCOME_INCOMPLETE, reason: "missing sessions YYYY-MM-DD..YYYY-MM-DD[; …]"}`
  under the verify key, and is added to `state["incomplete_symbols"]`. The missing range is carried
  in the free-text `reason` because `BackfillSymbolResult` has no range field (recon.md:111-112).
- **Verify or probe RPC failure.** The symbol records FAILED with reason
  `coverage verify failed: <err>`, which gives a retryable PARTIAL. This is an RPC error, not
  missing data, so it does not conflict with R-6.

**Proto.** Add the non-breaking enum value `BACKFILL_SYMBOL_OUTCOME_INCOMPLETE = 4` to
`common.proto` (recon.md:111, `common.proto:156-164`). This needs 1 service-owner approval, which the
operator accepted on 2026-11-26. Then run buf-gen.

**Merge precedence** (`_merged_symbol_results`, recon.md:62): EMPTY 1, SKIPPED 2, INCOMPLETE 3,
FAILED 4.

**Finalize** (`_finalize_backfill`, recon.md:52-56; this widens the status gate per the trap at
recon.md:154). Checks run in this order:

1. FAILED, when `chunks_failed > 0 and chunks_done == 0`.
2. PARTIAL, when any symbol or chunk failed.
3. PARTIAL, when `incomplete_symbols` is non-empty.
4. COMPLETED otherwise.

CANCELED keeps its early return. The FR-3 empty-plan early-COMPLETED path is unchanged
(recon.md:51), so a fully covered range still requests 0 bars (AC-3).

### 4. Resume marker and NULL-safe range rebuild (D-3, D-7, D-8)

- **Marker.** Add the reserved key `_GAPS_ONLY_VERIFY_KEY = "gaps_only"` beside
  `_FUNDAMENTALS_RESULTS_KEY` (recon.md:61). Its value is always `{symbol: entry}`, so it merges with
  no special case.
- **Fresh run.** The marker is persisted as `{"gaps_only": {}}` in the plan-time `update_job`. The
  same dict is passed as the `_run_chunks` `symbol_results=` seed, so the chunk writes do not erase
  the marker.
- **Resume.** `_resume_job` runs verify whenever the marker is present.
- **NULL-safe range rebuild.** Resume builds a `common.v1.TimeRange` that sets `start`/`end` only
  from non-NULL `range_start`/`range_end`, each through `_dt_to_ts`. One-sided agent ranges persist a
  NULL bound, and `_dt_to_ts(None)` raises (R-8). This mirrors the fresh path's raw `request.range`,
  so marketdata's 2000-01-01 floor applies the same way.
  - RED pytest: resume with `range_start=None`, and again with `range_end=None`. Neither may raise,
    and both must finalize.
- **No re-drive.** Verify overwrites the key wholesale. An INCOMPLETE-only PARTIAL has every chunk
  COMPLETED, so it is never re-driven.
- **Out of scope.** The broader re-finalize finding (ingest `docs/context-constitution-findings.md:30`)
  stays out of scope.

### 5. Alerts and ledger (D-9)

- An INCOMPLETE-only PARTIAL sends no notify alert. The PARTIAL alert (recon.md:57) stays gated on
  `failed_symbols or chunks_failed`.
- The `ingest.backfill.completed` ledger payload gains an additive `incomplete_symbols` list. This is
  JSON only, with no proto change.
- A WARN log lists the missing session ranges.
- The webhook payload is unchanged. Its scenarios key only on status (O-5 closed; blind spot at
  recon.md:135).

### 6. Consumer surface: xstockstrat-ui (D-4, C-14)

- The BFF is a passthrough (O-2 closed), so `symbolResults` (BackfillJob field 16) already reaches
  the browser.
- **Helper change.** Only `src/lib/backtestBackfill.ts` changes (recon.md:77-78):
  - `BackfillJobLike` gains `symbolResults?: {outcome}[]`.
  - The PARTIAL branch first checks for an INCOMPLETE-only PARTIAL: `chunksFailed === 0`, at least
    one INCOMPLETE entry, and no FAILED entry.
  - In that case it returns `{state: 'ready', text: 'Backfill finished: vendor has no bars for some sessions of <SYM>'}`.
    This text is deliberately distinct from the retry text.
- **`page.tsx` is unchanged** (recon.md:74-75). Re-run leads to `noVendorDataMessage` and hides
  "Backfill missing data". That is the `@AC-13 @feature-343` flow.
- **Tests.** vitest in `backtestBackfill.test.ts`, plus a Playwright mock using C-12 fixtures in
  `e2e/fixtures/` and `INVENTORY.md` (recon.md:81-84).

### 7. Consumer surface: xstockstrat-agent and strat-lab

- `incomplete` surfaces automatically through MessageToDict and the enum-derived outcome names
  (recon.md:91).
- Same-PR doc sync (recon.md:155; the strat-lab rule in `docs/patterns/strat-lab-plugin.md`):
  - `tools.py` docstrings;
  - `docs/runbooks/mcp-tools.md`;
  - the agent `CLAUDE.md`, whose `get_backfill_status` outcome list becomes
    `empty`/`skipped`/`failed`/`incomplete`;
  - `plugins/strat-lab/skills/backtest/SKILL.md:218` and `reference/backfill.md:18` (recon.md:95).
- The doc-sync contract test (recon.md:94) stays green.

### Build order

1. RED `TestComputeSessionGaps`, including the separation invariant.
2. The closure table in `marketsession`.
3. Repo and service, with a service-level `GetDataCoverage` test (none exists, recon.md:159).
4. Proto enum and buf-gen.
5. Ingest: coalescing planner, verify, 730-day probe, marker, NULL-safe resume, precedence,
   finalize, alert gate and ledger payload. Add RED pytest for:
   - AC-1, AC-2 and AC-3;
   - the coalescing bound;
   - resume with NULL bounds;
   - head-probe hit and miss;
   - verify-RPC failure;
   - cancel during verify.
6. UI helper, vitest, e2e and acceptance rows.
7. Agent docs, strat-lab and the agent `@AC`.

### Scope widening accepted by the operator (2026-11-26)

The operator accepted the wider scope, so `product-spec.md` Fix Scope and Proto Contract are to be
updated at `/sdd-spec`. The accepted additions:

- the non-breaking proto enum value (1 service-owner approval);
- the ingest verify pass, the INCOMPLETE outcome and the coalescing planner;
- the UI INCOMPLETE-only discriminator;
- the agent and strat-lab doc sync.

## Rejected Alternatives

- `R-1` A `count < expected` deficit gate before the per-time read — rejected because duplicate or
  mis-calendared rows inflate the count and hide holes, and the pre-open probe always shows a deficit,
  so the gate saves nothing.
- `R-2` A request flag `include_interior_gaps` — rejected because it needs a proto change and an
  approval gate for a negligible saving.
- `R-3` Ingest classifying head and tail gaps by comparing raw timestamps to the window's
  earliest/latest — rejected because window-relative classification gives a false COMPLETED, the
  UTC/NY boundary misclassifies, and it puts calendar logic in Python.
- `R-4` Leaving resumed GAPS_ONLY jobs unverified — rejected because it reproduces
  COMPLETED-while-missing across deploy restarts.
- `R-5` Rewriting `covered_ranges` — rejected because it has no consumer (How-to-Act #3).
- `R-6` Reusing EMPTY or FAILED for still-missing sessions — rejected because it collides with
  `@AC-24 @feature-352`, or conflates fetch errors with missing data.
- `R-7` One planner work unit per coverage gap under GAPS_ONLY once interior gaps are reported —
  rejected because chunks, persisted rows and RPCs scale with the hole count and repeat on every run
  for vendor-unfillable IEX holes (C-18).
- `R-8` Converting persisted range bounds with `_dt_to_ts` unconditionally on resume — rejected
  because it raises on the NULL bounds that one-sided agent ranges produce, leaving the job RUNNING
  and unverified (the R-4 failure mode).
- `R-9` A notify alert for an INCOMPLETE-only PARTIAL — rejected because it would fire on every retry
  of a vendor-unfillable hole. The ledger field and the WARN log carry the signal instead.

## Open Risks

- [ ] **O-1 accepted residual (operator, 2026-11-26, verbatim):** "An unfilled head gap (gaps[0]) is
  treated as the pre-listing carve-out, and the job ends COMPLETED, whenever the store has no bar in
  the 730 days before it. This covers three cases: the symbol was not yet listed; it was never fetched
  before (e.g. a first GAPS_ONLY run where only recent bars are stored and the vendor returns EMPTY or
  a short head); or the request starts inside a hole longer than 730 days." Pinned by a head-probe
  hit/miss pytest — to be addressed at the ingest verify step.
- [ ] **O-6:** K = 730 is a fixed invariant (operator, 2026-11-26), not a config key. Record it in the
  ingest `CLAUDE.md` — to be addressed at the ingest verify step / PR.
- [ ] **O-7 (one-time residual, operator-accepted):** GAPS_ONLY jobs created before the deploy carry
  no `gaps_only` marker and resume unverified — no code action; note it in the PR description.
- [ ] **O-8:** On an unset-start range, the planner, verify and resume scan the symbol's full stored
  history (2000 floor) via `array_agg`, and verify doubles that scan and its chunk locks. This is
  unmeasured against `@AC-1 @feature-153` — to be addressed at `/sdd-spec`: restate the bound and
  either measure it or record it as accepted.
- [ ] **O-9:** Confirm the exact coalescing boundary, and that `chunk_max_bars` still splits inside
  merged units — to be addressed at `/sdd-spec` (planner step).
- [ ] Coalescing re-fetches stored sessions between gaps. This adds vendor bandwidth and rate-limit
  pressure on symbols with dense holes — to be addressed at the ingest planner step (observe only).
- [ ] Vendor-unfillable IEX-feed holes leave those symbols INCOMPLETE/PARTIAL on every GAPS_ONLY
  run. The UI shows "no vendor data" for them, which is correct but persistent — accepted; document it
  in the strat-lab/runbook sync step.
- [ ] A probe into pre-004 1-day chunks locks more chunks than a probe into 30-day chunks. Not
  measured — to be addressed with O-8 at `/sdd-spec`.
- [ ] The closure table in `marketsession` is maintained by hand. A missed or future one-off closure
  becomes a permanent INCOMPLETE for every symbol covering it, and no CI check notices — to be
  addressed at the closure-table step (document the maintenance rule).
- [ ] Juneteenth is applied before 2022, when it was not yet a market holiday (`marketsession.go:82`).
  That hides real sessions in admin windows reaching 2021 or earlier — to be addressed at the
  closure-table step (decide fix vs accept at spec).
- [ ] If the vendor publishes the last completed session late, that session reads INCOMPLETE until
  the next run — accepted; to be noted in the runbook sync.
- [ ] An EMPTY symbol with stored bars in the 730 days before its first gap now becomes INCOMPLETE.
  The design assumes no `@AC-24 @feature-352` scenario uses GAPS_ONLY with prior history — to be
  re-checked at `/sdd-spec`.
- [ ] The `/insights/strategies/[id]` GAPS_ONLY action (`page.tsx:547`, recon.md:80) does not use
  `backfillJobMessage`, so it shows an INCOMPLETE-only PARTIAL as a plain PARTIAL. Verified by grep
  only — to be addressed at `/sdd-spec` (decide whether it is in scope).
- [ ] The analysis readiness probes call `GetDataCoverage` on a hot path and rely on it being a
  cheap metadata read (recon.md:97-100, 151). `array_agg` over their 10-day window is small, but
  this is unmeasured — to be addressed at the marketdata repo/service step (latency check).

## Constitution Rules Touched

- `C-04` — honored by: the work stays inside the existing ingest → marketdata edges. No new
  inter-service edge is added (recon.md:142).
- `C-11` — honored by: the design-phase assumptions and the operator decisions (K = 730, the O-1
  residual, the wider scope) are recorded in context.md.
- `C-12` — honored by: the UI e2e mock uses fixtures in `e2e/fixtures/` and is catalogued in
  `INVENTORY.md`.
- `C-14` — honored by: the change reaches both consumer surfaces. On the `/trader` position detail,
  `backtestBackfill.ts` maps an INCOMPLETE-only PARTIAL to the no-vendor-data state. In the agent,
  `get_backfill_status` reports the `incomplete` outcome and the docs and strat-lab skill are synced.
- `C-15` — honored by: AC-1, AC-2 and AC-3 map to RED tests, and the new `@AC` rows (the UI `@AC-9`
  discriminator, the `@AC-13` variant, the agent `@AC` extending `@AC-14 @feature-352`, and the head
  carve-out scenario) are added.
- `C-16` — honored by: see Business Rules Touched. There is no CHANGE.
- `C-18` — honored by: per-symbol coalescing (D-6/R-7) bounds chunks and RPCs. The scan cost is
  carried as O-8.
- `P-02` — honored by: the proposer and the adversary were mediated through the synthesized state
  only.
- `P-03` — honored by: the O-1 residual is stated in its full, accurate width and was accepted
  verbatim. Unmeasured costs are listed as open risks, not claimed.
- `F-01` — honored (Floor).
- `F-06` — honored (Floor).
- `F-07` — honored (Floor): K = 730 is a fixed invariant documented in the ingest `CLAUDE.md`, not a
  hardcoded config-like value. No new config key is added.
- `PLAT-N1` — honored by: each verify, probe or RPC failure is recorded as FAILED, which gives a
  retryable PARTIAL. A failed check never yields a silent COMPLETED.
- strat-lab same-PR sync (`docs/patterns/strat-lab-plugin.md`) — honored by: the `get_backfill_status`
  shape change updates the `backtest` skill in the same PR.

## Business Rules Touched (C-16)

- EXTEND `@AC-1 @feature-364` (interior hole is fetched) — new case: the interior session gaps
  reported by `ComputeSessionGaps` are planned and fetched under GAPS_ONLY.
- EXTEND `@AC-2 @feature-364` (never COMPLETED while sessions are missing) — new case: the terminal
  status is PARTIAL, with an `incomplete` symbol outcome whose reason names the missing ranges. A
  head carve-out scenario is added for the O-1 residual.
- PRESERVE `@AC-3 @feature-364` (fully covered range fetches nothing) — not regressed by: the
  FR-3 empty-plan early-COMPLETED path is unchanged, and `bars_processed` stays 0.
- EXTEND `@AC-9 @FR-5 @feature-343` "A partial or canceled backfill says so and can be retried"
  (`services/xstockstrat-ui/acceptance/backtest-inline-backfill.feature`) — new case: an
  INCOMPLETE-only PARTIAL gets a distinct message. The existing fixture keeps no INCOMPLETE entries.
- EXTEND `@AC-13 @FR-5 @feature-343` "A gap the vendor cannot fill is reported instead of offering
  the backfill again" — new case: the Given is an INCOMPLETE-only PARTIAL. The guarantee itself is
  preserved (D-4).
- PRESERVE `@AC-4 @FR-4 @feature-343` "A completed backfill offers a re-run and does not run it" —
  not regressed by: COMPLETED still means the data is ready, and is now stricter.
- PRESERVE `@AC-23 @FR-7 @feature-352` "An unresolvable flagged symbol is skipped in a bars
  backfill" — not regressed by: verify skips SKIPPED symbols, and INCOMPLETE ranks above SKIPPED
  only for symbols that verify actually checked.
- PRESERVE `@AC-24 @FR-9 @feature-352` "A symbol with no data in range is reported empty" — not
  regressed by: EMPTY stays distinct from INCOMPLETE (R-6). The prior-history edge case is an open
  risk to re-check at spec.
- EXTEND `@AC-11 @FR-7 @feature-352` "An unresolvable flagged symbol is skipped and the job
  completes" — new case: the outcome vocabulary grows to include `incomplete`.
- EXTEND `@AC-14 @FR-9 @FR-11 @feature-352` "The job status carries the per-symbol reason"
  (`services/xstockstrat-agent/acceptance/delisted-symbol-handling.feature`) — new case: the agent
  `@AC` adds an `incomplete` outcome whose reason carries the missing session ranges.
- PRESERVE `@AC-1 @regression @feature-153` "A 400-day bars query over the ohlcv hypertable locks
  few enough chunks to succeed" — not regressed by: the 730-day probe and the verify scan stay inside
  the same symbol/timeframe/window predicate. Measurement is carried as O-8.
- No CHANGE lines, so no operator sign-off is needed for C-16. The scope widening and K = 730 are
  operator decisions recorded 2026-11-26 (context.md), but they alter no existing guarantee.

## Rounds

- Round 1 (2026-11-26, /sdd-batch): +5 D, +6 R, +5 O. Progress: yes.
- Round 2 (2026-11-26, /sdd-batch): +5 D, +3 R, 4 O closed, +4 O. Progress: yes.
- **Termination: approved** at the operator design gate after round 2, the full-mode minimum. The
  Floor is clear.
  - The blocking O-1 was resolved by the operator accepting the residual wording, with K raised to
    730 days.
  - O-6 (K as a fixed invariant) and O-7 (the one-time in-flight residual) were resolved by operator
    decision.
  - O-8 and O-9 are carried to `/sdd-spec` as open risks.
  - There were no reopen petitions.
