# Context Log: fix-gapsonly-backfill-is

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-25 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-25-gaps-only-backfill-blind-to-interior-holes-defect.md` (GitHub Issues disabled): GAPS_ONLY backfill is blind to interior holes and reports COMPLETED
- Severity: SEV-2
- Routed to SDD path (Track C) — operator chose SEV-2 / dev over a production hotfix (strategies fail closed on a missing SMA200; FULL backfill is a working manual remediation)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-marketdata, xstockstrat-ingest
- Root cause hypothesis: GetCoverage returns only (earliest, latest, count); ComputeGaps derives head/tail gaps only (timeframe.go:82-99)
- Recommended design depth: full → `/sdd-design fix-gapsonly-backfill-is` (rationale: ≥2 affected services plus GAPS_ONLY consumer surfaces in ui/agent — escalate-to-full signal)
- Development branch: feature/fix-gapsonly-backfill-is
- Remediation already applied out-of-band on homelab staging (2026-11-25): FULL + overwrite backfill of all 381 watchlist symbols, 2025-11-20..2026-11-25; sma200-UNSPECIFIED queue rows fell 27 → 8 (the remaining 8 have no vendor data).

## Session 2026-11-26 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict PASS WITH WARNINGS (0 fails, 0 floor breaches).
- Warnings:
  - Criterion 2/8 (FR-2 vs AC-2): FR-2 is disjunctive (non-COMPLETED terminal state OR reports still-missing sessions), and AC-2's first Then is hedged and never names the terminal status; the second Then does not say where the missing range appears (`get_backfill_status` field vs job result). **Deferred to design** — that choice decides whether the strat-lab `backtest` skill must change.
  - Criterion 8 (AC-3): "requested 0 bars from the vendor" was not observable through a named surface. **Resolved here**: AC-3 now asserts `get_backfill_status reports bars_processed 0 for the job` (`BackfillJob.bars_processed`, ingest proto).
  - Criterion 8: no scenario covers the FR-2 carve-out for sessions the vendor legitimately has no bar for (halted / not-yet-listed). **Deferred to design**: add a scenario once the decision is recorded in design.md so the exception cannot mask a false COMPLETED.
  - Criterion 11: UI/agent behavior for a non-COMPLETED or partial-missing status is "no code change expected". **Deferred to design**: confirm the UI renders the chosen status (strat-lab skill update already conditioned in the spec).
  - C-14/C-15: AC-1/AC-2 use fixed 2025/2026 windows and real tickers; AC-1 depends on an unpinned trading-session calendar. Acceptable for a regression guard; **design must pin the holiday-calendar source** so "every trading session" is deterministic.
- Overlap findings: none (overlap verdict PASS, no collisions).
- Recommended design depth: full (2 code-changing services, marketdata + ingest, plus GAPS_ONLY consumer surfaces in ui/agent; possible additive proto change to `GetDataCoverage`).

### OPERATOR DECISIONS (binding, recorded 2026-11-26)

- Operator 2026-11-25: SEV-2, environment dev (main-dev) -> Track C (not a production hotfix); strategies fail closed on a missing SMA200 and a FULL backfill is a working manual remediation.
- Root cause evidence: services/xstockstrat-marketdata/internal/timeframe/timeframe.go ComputeGaps derives only head/tail gaps from (earliest, latest, count) — 'interior holes out of scope'; ingest GAPS_ONLY planner (services/xstockstrat-ingest/app/handlers/servicer.py _plan_work_ranges) consumes cov.gaps. Consumers relying on GAPS_ONLY: xstockstrat-ui 'Backfill missing data' (feature 343, non-admin), agent-scheduled backfills (feature 054 default).
- Observed on homelab staging: SCHW/IDXX/~19 symbols missing 2026-04-01..2026-09-25; remediated out-of-band 2026-11-25 with FULL+overwrite backfill (8 jobs, ~96k bars).

## Session 2026-11-26 — sdd-batch design gate (round 2)

`/sdd-design fix-gapsonly-backfill-is` (full) halted at its approval gate after round 2 (gate policy: halt). design.md is not written and status.md is unchanged. The register is `debate.md` (D-1..D-10, R-1..R-9, O-1..O-9).

## Open Threads

- **Approach (round-2 synthesis).** marketdata `GetDataCoverage` reports head, interior and tail 1d gaps via a new `timeframe.ComputeSessionGaps`. Bars come from one `MIN/MAX/COUNT + array_agg(time)` query, gaps are bounded at the last completed session, and one-off NYSE closures are added to `marketsession.isHoliday` (D-1, D-5). The ingest GAPS_ONLY planner coalesces each symbol's gaps into units no wider than `backfill.chunk_window_days` (D-6). A new `_verify_gaps_only` step re-reads coverage after `_run_chunks` on both the fresh and resume paths. `gaps[1:]` count as missing because of the separation invariant. `gaps[0]` counts as missing only if one store probe over the 365 days before it finds bars (D-10). Still-missing symbols get the new outcome `BACKFILL_SYMBOL_OUTCOME_INCOMPLETE = 4` and the job ends PARTIAL (D-2). A verify RPC failure records FAILED instead, which is retryable. The resume marker is the reserved `symbol_results["gaps_only"]` key (D-3, D-8). Resume rebuilds the time range NULL-safely (D-7). An INCOMPLETE-only PARTIAL sends no notify alert; the ledger payload gains an additive `incomplete_symbols` field (D-9). The UI helper `backtestBackfill.ts` maps an INCOMPLETE-only PARTIAL to the no-vendor-data state, which keeps `@AC-13 @feature-343` (D-4). Agent and strat-lab docs are synced in the same PR.
- **Strongest open objection: O-1 (blocking).** The head-gap carve-out has a wider residual than the proposal stated. An unfilled `gaps[0]` ends COMPLETED whenever the store has no bar in the 365 days before it. That happens when the symbol was not yet listed, when it was never fetched before, or when the request starts inside a hole longer than 365 days. The operator must either accept exactly this wording here or choose walk-back-to-2000 probing. Non-blocking threads also need operator records:
  - O-6: K = 365 as a fixed invariant (F-07).
  - O-7: in-flight pre-deploy jobs resume unverified, a one-time residual.
  - O-8: worst-case full-history scans, doubled by verify, against the `@AC-1 @feature-153` budget.
  - O-9: the exact coalescing boundary, and whether `chunk_max_bars` still splits inside merged units.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.**
  - EXTEND (no operator decision covers these yet): `AC-1@feature-364`, `AC-2@feature-364`, `AC-13@feature-343`, `AC-9@feature-343`, `AC-11@feature-352`, `AC-14@feature-352`.
  - PRESERVE: `AC-3@feature-364`, `AC-4@feature-343`, `AC-23@feature-352`, `AC-24@feature-352`, `AC-1@feature-153`.
  - CHANGE: none.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis. This round takes the proposal's design, which rests on D-1 to D-5, and folds in the adversary's two code-verified corrections. I spot-checked both in servicer.py. `_dt_to_ts(None)` raises, and `range_start`/`range_end` are persisted as `_ts_to_dt(request.range.*)`, which is `None` for an unset bound (`:569-570`). `_plan_work_ranges` emits one unit per `cov.gaps` entry (`:807-810`), and each unit is chunked separately (`:829-832`).\n\n**1. marketdata (D-1, D-5).**\n- Add `timeframe.ComputeSessionGaps` in `internal/timeframe/timeframe.go`, beside `ComputeGaps` (`:77,84`).\n- For `1d`, use one query in `marketdata_repo.go:243-247`: `MIN/MAX/COUNT + array_agg(time ORDER BY time)`, with the same predicate as today.\n- Bound gaps at `marketsession.Reference(now)` with live=false.\n- Merge runs of missing sessions. `TestComputeSessionGaps` pins the invariant that two consecutive gaps are always separated by at least one stored session.\n- Add the closure table to `packages/proto/marketsession/marketsession.go:74` `isHoliday`.\n\n**2. ingest planner: coalesce GAPS_ONLY gaps per symbol (new; answers the adversary's C-18 chunk-explosion point).**\n- In `_plan_work_ranges` (`servicer.py:807-810`), merge each symbol's consecutive gaps into one unit while the merged span (first gap start to last gap end) stays within `self._cfg.backfill_chunk_window_days` (default 90, ingest `CLAUDE.md:159`). Then emit `([sym], merged_start, merged_end)`.\n- `overwrite=false` makes re-fetching the stored sessions between gaps harmless.\n- No durable `@AC` pins the \"one unit per gap\" shape (grep of `*.feature` for GAPS_ONLY found none).\n- RED pytest: about 40 scattered one-session gaps in a year produce at most about `ceil(365/90)` units for the symbol.\n- The fresh-path planner still calls `GetDataCoverage` with `range=request.range` raw (`:803`).\n\n**3. ingest verify: `_verify_gaps_only(job_id, symbols, time_range, state, meta)` (new method in `servicer.py`).**\n- **When it runs.** Between `_run_chunks` and `_finalize_backfill`, on both the fresh path (`:865-866`) and the resume path (`:964-972`). It is skipped when `job_id in self._canceled_jobs` (`:876`).\n- **Which symbols.** Only symbols that had planned units and whose merged outcome is not SKIPPED (keeps `@AC-23 @feature-352`).\n- **Coverage call.** Re-call `GetDataCoverage` with the planner's call shape (`:801-806`).\n- **Missing gaps.** `gaps[1:]` are missing by construction, because of the separation invariant.\n- **Head gap.** `gaps[0]` is missing only if one probe `GetDataCoverage(range=[gaps[0].start − 365d, gaps[0].start))` returns `bars_total > 0`. Otherwise it is the head carve-out. The probe uses no comparison against earliest/latest, so it does not reintroduce R-3.\n- **Still-missing symbols.** Write `{outcome: INCOMPLETE, reason: \"missing sessions YYYY-MM-DD..YYYY-MM-DD[; …]\"}` under the verify key and add the symbol to `state[\"incomplete_symbols\"]`.\n- **Verify or probe RPC failure.** Record FAILED with reason `coverage verify failed: <err>` and add the symbol to `failed_symbols`, giving a retryable PARTIAL (consistent with R-6).\n- **Finalize order** (`:881-886`):\n  1. FAILED (`chunks_failed>0 && chunks_done==0`)\n  2. PARTIAL (failed symbols or chunks)\n  3. PARTIAL (`incomplete_symbols`)\n  4. COMPLETED\n- CANCELED keeps its early return. The FR-3 empty-plan path (`:835-853`) is unchanged.\n- **Precedence** (`:310-314`): EMPTY 1, SKIPPED 2, INCOMPLETE 3, FAILED 4 (D-2).\n\n**4. Resume marker (D-3; answers O-3) and NULL-safe range rebuild (new fix for the adversary's blocking resume crash).**\n- Add `_GAPS_ONLY_VERIFY_KEY = \"gaps_only\"` beside `_FUNDAMENTALS_RESULTS_KEY` (`:308`).\n- **Fresh run.** Persist `symbol_results={\"gaps_only\": {}}` in the `update_job` at `:856`. Pass the same dict as the `symbol_results=` seed to `_run_chunks` (`:988`, copied at `:1004`), so the chunk writes at `:1082-1088` do not erase the marker.\n- **Merge.** The value is always `{symbol: entry}`, so `_merged_symbol_results` (`:320-326`) needs no special case.\n- **Resume.** `_resume_job` runs verify when `\"gaps_only\"` is present.\n  - It rebuilds a `common_pb2.TimeRange` that sets `start` and `end` only when `row[\"range_start\"]` / `row[\"range_end\"]` are non-NULL, each through `_dt_to_ts` (`:302`).\n  - This mirrors the fresh path's raw `request.range`, so marketdata's 2000-01-01 floor applies the same way (`marketdata_service.go:521-524`).\n  - RED pytest: resume a GAPS_ONLY job with `range_start=None` (and one with `range_end=None`). It must not raise and must finalize.\n- **Idempotence.** Verify overwrites the key wholesale.\n- **No re-drive.** A PARTIAL caused only by INCOMPLETE has every chunk COMPLETED, so `list_jobs_with_incomplete_chunks` never re-drives it.\n- The broader re-finalize finding (ingest `docs/context-constitution-findings.md:30`) stays out of scope.\n\n**5. Alerts and ledger (answers O-4, plus the adversary's observability point).**\n- A PARTIAL caused only by INCOMPLETE sends no notify alert. The `:917-924` alert is gated on `failed_symbols or chunks_failed`.\n- The `ingest.backfill.completed` event payload (`:911-916`) gains an additive `incomplete_symbols` list. This is JSON only, with no proto change, and the webhook payload is untouched (O-5 stays closed).\n- Log a WARN with the missing session ranges.\n\n**6. UI (D-4; O-2 closed, BFF is a passthrough at `insightsBff.ts:89-93`, `useBackfills.ts:33`).**\n- The change is limited to `src/lib/backtestBackfill.ts`.\n- `BackfillJobLike` (`:20`) gains `symbolResults?: {outcome}[]`.\n- The PARTIAL branch (`:90`) first checks `chunksFailed === 0`, at least one INCOMPLETE entry and no FAILED entry. If so, it returns `{state: 'ready', text: 'Backfill finished: vendor has no bars for some sessions of <SYM>'}`. The text is distinct from the retry message at `:97-100`.\n- `page.tsx` is unchanged. `handleRerun` sets `filledGapKey`, which renders `noVendorDataMessage` (`:1319-1320`) and hides \"Backfill missing data\" (`:1322`). That is the `@AC-13 @feature-343` flow.\n- Acceptance additions:\n  - an `@AC-9` Examples row (or sibling scenario) pinning the discriminator;\n  - an `@AC-13` variant whose Given is an INCOMPLETE-only PARTIAL;\n  - the existing `@AC-9` fixture keeps no INCOMPLETE entries.\n- Tests: vitest, plus an e2e mock using C-12 fixtures.\n\n**7. Agent and strat-lab.**\n- `incomplete` surfaces through MessageToDict (`client.py:2169-2172`).\n- Same-PR doc sync: `tools.py` docstrings, `docs/runbooks/mcp-tools.md`, and the agent `CLAUDE.md`, including the `get_backfill_status` outcome list (`empty`/`skipped`/`failed` plus `incomplete`). Also `plugins/strat-lab` `SKILL.md:218` and `reference/backfill.md:18`.\n- New agent `@AC` extending `@AC-14 @feature-352`. `@AC-11 @feature-352` is reclassified as EXTEND.\n\n**Build order.**\n1. RED `TestComputeSessionGaps`, including the separation invariant.\n2. The closure table.\n3. Repo and service, with a service test.\n4. Proto enum `BACKFILL_SYMBOL_OUTCOME_INCOMPLETE = 4` (`common.proto:156`) and buf-gen.\n5. Ingest: coalescing planner, verify, probe, marker, NULL-safe resume, precedence, finalize, alert gate and ledger payload. RED pytest for:\n   - AC-1/2/3;\n   - coalescing bound;\n   - resume with NULL bounds;\n   - head-probe hit and miss;\n   - verify-RPC failure;\n   - cancel during verify.\n6. UI helper, vitest, e2e and acceptance rows.\n7. Agent docs, strat-lab and the agent `@AC`.\n\n**Operator records required before approval (`context.md`).**\n- (a) The exact O-1 residual wording below.\n- (b) K = 365 as a fixed invariant (F-07 convention, as in marketdata `CLAUDE.md` § \"Adaptive rate limit — fixed invariants\").\n- (c) In-flight GAPS_ONLY jobs created before deploy carry no marker and resume unverified: a one-time residual.",
    "open_objections": [
      {
        "text": "O-1 (still open). The residual the proposal stated was narrower than what the carve-out actually does (P-03). The accurate wording is: an unfilled head gap (gaps[0]) is treated as the pre-listing carve-out, and the job ends COMPLETED, whenever the store has no bar in the 365 days before it. That covers three cases: the symbol was not yet listed, it was never fetched before (for example a first GAPS_ONLY run where only recent bars are stored and the vendor returns EMPTY or a short head), or the request starts inside a hole longer than 365 days. The operator must accept exactly this wording in context.md, or the walk-back-to-2000 classifier must be adopted instead.",
        "blocking": true
      },
      {
        "text": "K = 365 is a code constant. It needs the operator's approval as a fixed invariant, recorded in context.md and in the ingest CLAUDE.md (F-07 convention, as in marketdata CLAUDE.md § Adaptive rate limit — fixed invariants). Proposing it is not enough.",
        "blocking": false
      },
      {
        "text": "GAPS_ONLY jobs in flight at deploy time have no 'gaps_only' marker, so a resume after the deploy skips verify. Record this as an operator-accepted one-time residual in context.md.",
        "blocking": false
      },
      {
        "text": "The worst-case scan size is understated. On an agent call with no start bound, the planner and verify (and on resume, the rebuilt range) run over 2000-01-01..end (marketdata_service.go:521-524). With array_agg that returns the symbol's full stored history, so verify doubles the planner's scan and its chunk locks. Replace 'about 252 timestamps' in the design's Assumptions with the real bound, and either measure it against the @AC-1 @feature-153 budget or record it as accepted.",
        "blocking": false
      },
      {
        "text": "The next proposer must confirm the coalescing rule's exact boundary: a merged span <= chunk_window_days, measured from the first gap start to the last gap end, with the window read from config. They must also confirm that plan_chunks still splits by chunk_max_bars inside the merged unit.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1@feature-364",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2@feature-364",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3@feature-364",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-13@feature-343",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-9@feature-343",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4@feature-343",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-23@feature-352",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-24@feature-352",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-11@feature-352",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-14@feature-352",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-1@feature-153",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Keeping one planner unit per gap. Once D-1 surfaces interior gaps, a thinly traded symbol with N scattered holes (the IEX feed, alpaca.feed=iex at internal/alpaca/client.go:43) plans N chunks, persisted rows and BackfillBars RPCs on every GAPS_ONLY run, and the vendor can never fill them. That repeats for up to 50 symbols per agent job. It lost to per-symbol coalescing within chunk_window_days.",
      "Converting the persisted range_start/range_end with _dt_to_ts unconditionally on resume. FromDatetime(None) raises when a bound is NULL. NULL bounds are real: agent one-sided ranges persist as None (servicer.py:569-570). The job would be left RUNNING and unverified, the R-4 failure mode. It lost to rebuilding a TimeRange that sets only the non-NULL bounds.",
      "Classifying the head gap from the vendor's chunk answer (carve-out when the chunk succeeded). It needs no RPC and no K, but it returns COMPLETED for the case where the request starts inside a hole, which the store probe catches.",
      "Walking back in 365-day probes to the 2000 floor. It closes O-1 fully but costs up to about 26 calls per symbol per run for recently listed symbols (C-18). It stays the fallback if the operator refuses the restated O-1 residual.",
      "Sending a notify alert for an INCOMPLETE-only PARTIAL. An unfillable hole is a vendor fact that would fire on every retry. It lost to no alert plus an additive incomplete_symbols field in the ledger event payload and a WARN log.",
      "Reusing the existing 'Backfill partial: … returned no data for part of the range' text for the INCOMPLETE-only case. That text offers a retry, while the INCOMPLETE case leads to Re-run and then no-vendor-data. Near-identical text for opposite actions is a UX hazard, so a distinct 'vendor has no bars for some sessions' text is used.",
      "A BFF change to expose symbol_results. Not needed: getBackfillStatus is a passthrough (insightsBff.ts:89-93) and BackfillJob field 16 already reaches the browser."
    ],
    "open_risks": [
      "The O-1 residual depends on the operator accepting the restated wording. If refused, walk-back probing adds per-run cost for recently listed symbols.",
      "Coalescing re-fetches stored sessions between gaps. That is harmless under overwrite=false, but adds vendor bandwidth and rate-limit pressure on dense-hole symbols.",
      "IEX-feed holes that can never be filled leave those symbols as INCOMPLETE/PARTIAL on every GAPS_ONLY run. The UI shows 'no vendor data' for them, which is correct but persistent.",
      "Full-history array_agg scans for unset-start agent ranges are doubled by verify. The payload and the chunk-lock cost are unmeasured against the @AC-1 @feature-153 budget.",
      "A probe into pre-004 1-day chunks locks more chunks than one into 30-day chunks. Not measured.",
      "The hand-maintained closure table in marketsession. A missed or future one-off closure becomes a permanent INCOMPLETE for every symbol covering it, and no CI check notices.",
      "Pre-2022 Juneteenth is over-applied (marketsession.go:82). It hides real sessions in admin windows reaching 2021 or earlier.",
      "If the vendor publishes the last completed session late, that session reads INCOMPLETE until the next run.",
      "An EMPTY symbol with stored bars in the 365 days before its first gap now becomes INCOMPLETE. It is assumed that no @AC-24 @feature-352 scenario uses GAPS_ONLY with prior history. To re-check in spec.",
      "The /insights/strategies/[id] GAPS_ONLY action (page.tsx:547) does not use backfillJobMessage, so it shows an INCOMPLETE-only PARTIAL as plain PARTIAL. Verified by grep only."
    ],
    "constitution_rules_touched": [
      "C-04",
      "C-11",
      "C-12",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "F-01",
      "F-06",
      "F-07",
      "PLAT-N1",
      "strat-lab same-PR sync (docs/patterns/strat-lab-plugin.md)"
    ],
    "rationale": "I spot-checked the adversary's blocking claims in servicer.py, and both code-level claims hold:\n- `TriggerBackfill` persists `range_start`/`range_end` as `_ts_to_dt(request.range.*)`, which returns None for an unset bound (`:296-299`, `:569-570`).\n- `_dt_to_ts` calls `FromDatetime` with no None guard (`:302-305`), so the proposal's resume conversion would raise on agent one-sided ranges.\n- `_plan_work_ranges` appends one unit per `cov.gaps` entry (`:807-810`), and each unit is planned into chunks separately (`:829-832`). Once D-1 adds interior gaps, chunk counts scale with hole count.\n\nBoth fixes are folded into the approach as new decisions:\n- The NULL-safe TimeRange rebuild honors D-3/R-4, keeping resumed jobs verified.\n- Per-symbol gap coalescing within `chunk_window_days` contradicts no D-n. \"Planner unchanged\" was a round-1 approach note, not a settled decision. A grep of `*.feature` found no durable AC pinning the one-unit-per-gap shape.\n\nObjections closed:\n- O-2: `insightsBff.ts` is a passthrough and the adversary did not contest it.\n- O-3: the marker shape, the seed into `_run_chunks`, and the no-re-drive argument are concrete.\n- O-4: no alert, plus the adversary's additive ledger field.\n- O-5: the webhook scenarios key only on status.\n\nO-1 stays blocking. The proposal itself says it cannot close the gap without operator acceptance, and the adversary showed the residual wording was too narrow (P-03). The synthesis carries the corrected wording for the operator.\n\nBusiness-rule changes:\n- `@AC-13 @feature-343` moves from PRESERVE to EXTEND. Its behavior is preserved (D-4), but a new Given variant (the INCOMPLETE-only PARTIAL) is added.\n- `@AC-11 @feature-352` is EXTEND, because the outcome vocabulary grows.\n- No operator decision sanctions a CHANGE, so none is used.\n\nRegister check:\n- The approach respects D-1 to D-5.\n- The head probe compares no timestamps against earliest/latest, so R-3 is not reintroduced.\n- `covered_ranges` is untouched (R-5).\n- EMPTY and FAILED are not reused for missing sessions (R-6). The verify-RPC-failure FAILED is an RPC error, not missing data.\n- No closed O-n is re-raised.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The GAPS_ONLY planner coalesces each symbol's consecutive coverage gaps into one work unit while the merged span (first gap start to last gap end) stays within backfill.chunk_window_days. This bounds chunks per symbol at about the FULL-mode count. Re-fetching the stored sessions between gaps is harmless under overwrite=false.",
          "evidence": "servicer.py:807-810 (one unit per gap), :829-832 (per-unit chunking); alpaca.feed=iex default at internal/alpaca/client.go:43; ingest CLAUDE.md:159; no *.feature pins the per-gap unit shape"
        },
        {
          "text": "Resume verify rebuilds a common.v1.TimeRange that sets start/end only for non-NULL persisted range_start/range_end, mirroring the fresh path's raw request.range. A RED pytest covers a resume with a NULL bound.",
          "evidence": "servicer.py:296-305 (_ts_to_dt returns None; _dt_to_ts has no None guard), :569-570 (persisted range bounds), agent app/client.py:2151-2158 (one-sided ranges)"
        },
        {
          "text": "The resume marker is the reserved symbol_results key 'gaps_only', valued {symbol: entry}. It is persisted as {} at plan time and passed as the _run_chunks symbol_results seed. INCOMPLETE ranks 3 in _OUTCOME_PRECEDENCE, between SKIPPED 2 and FAILED 4.",
          "evidence": "servicer.py:308,310-326,856,988,1004,1082-1088"
        },
        {
          "text": "An INCOMPLETE-only PARTIAL sends no notify alert. The ingest.backfill.completed ledger payload gains an additive incomplete_symbols list, and the webhook payload is unchanged.",
          "evidence": "servicer.py:905-924"
        },
        {
          "text": "The head gap (gaps[0]) is classified by one GetDataCoverage store probe over [gaps[0].start - 365d, gaps[0].start), judged on bars_total > 0. gaps[1:] are missing by the separation invariant pinned in TestComputeSessionGaps. A verify or probe RPC failure records FAILED (retryable PARTIAL), not INCOMPLETE.",
          "evidence": "proposal r2 §2; timeframe.go:77,84; servicer.py:335-346; @AC-1 @feature-153 400-day envelope"
        }
      ],
      "new_rejected": [
        {
          "text": "One planner work unit per coverage gap under GAPS_ONLY once interior gaps are reported",
          "why": "Chunks, persisted rows and RPCs scale with hole count and repeat on every run for vendor-unfillable IEX holes (C-18)"
        },
        {
          "text": "Converting persisted range bounds with _dt_to_ts unconditionally on resume",
          "why": "Raises on the NULL bounds that one-sided agent ranges produce, leaving the job RUNNING and unverified (the R-4 failure mode)"
        },
        {
          "text": "Notify alert for an INCOMPLETE-only PARTIAL",
          "why": "Fires on every retry of a vendor-unfillable hole; the ledger field and WARN log carry the signal"
        }
      ],
      "new_objections": [
        {
          "text": "K = 365 needs operator approval as a fixed invariant, recorded in context.md and ingest CLAUDE.md (F-07 convention).",
          "blocking": false
        },
        {
          "text": "GAPS_ONLY jobs in flight at deploy have no marker and resume unverified. Record this as an operator-accepted one-time residual.",
          "blocking": false
        },
        {
          "text": "The worst-case scan for unset-start ranges is the symbol's full history (2000 floor), doubled by verify. Restate the Assumptions and measure against, or accept within, the @AC-1 @feature-153 budget.",
          "blocking": false
        },
        {
          "text": "Confirm the exact coalescing boundary rule and that plan_chunks still applies chunk_max_bars inside merged units.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-2",
          "how": "insightsBff.ts:89-93 returns getBackfillStatus unchanged and useBackfills.ts:33 passes the proto BackfillJob through, so symbolResults (field 16) reaches backtestBackfill.ts with no BFF change. The adversary did not contest this."
        },
        {
          "id": "O-3",
          "how": "The marker is 'gaps_only': {symbol: entry}, persisted at :856 and seeded into _run_chunks (:988,:1004) so chunk writes keep it. It merges with no special case. An INCOMPLETE-only PARTIAL has all chunks COMPLETED and is never re-driven. The broader findings:30 issue is out of scope. The NULL-bound resume crash is fixed by the new range-rebuild decision."
        },
        {
          "id": "O-4",
          "how": "No notify alert for an INCOMPLETE-only PARTIAL (the alert stays gated on failed_symbols or chunks_failed). The ledger event gains an incomplete_symbols field, plus a WARN log."
        },
        {
          "id": "O-5",
          "how": "webhook-fanout-callback.feature:50,103 and notify :47-51 key only on status. No scenario requires a non-empty failed_symbols for PARTIAL."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-26 — sdd-design

- **Phase 0 Recon.** Wrote `recon.md`.
  - Services: marketdata and ingest change code; ui and agent are consumer surfaces.
  - Key reuse patterns: the `marketsession` calendar, and the existing `GetDataCoverageResponse.gaps = 7`.
- **Phase 1 Grilling.** 2 rounds (full).
  - Chosen approach: session-aware 1d gaps in marketdata, plus per-symbol gap coalescing in the ingest planner. After `_run_chunks`, a GAPS_ONLY verify pass marks still-missing symbols with the new outcome `BACKFILL_SYMBOL_OUTCOME_INCOMPLETE = 4`, and the job ends PARTIAL. The verify pass also runs on resume.
  - The UI maps an INCOMPLETE-only PARTIAL to the no-vendor-data state. The agent and strat-lab docs are synced in the same PR.
  - Rejected: R-1..R-9 (see `design.md`).
- **Constitution rules touched:** C-04, C-11, C-12, C-14, C-15, C-16, C-18, P-02, P-03, F-01, F-06, F-07, PLAT-N1, and the strat-lab same-PR sync.
  - Floor breaches: none.
  - Business-rule CHANGEs: none (EXTEND/PRESERVE only).
- **Status:** spec-ready → design-approved. The operator approved at the design gate after round 2.

### OPERATOR DECISIONS (binding, recorded 2026-11-26, design gate)

- **O-1 / K.** The operator's verbatim answer was "Expand it to 730 days". The head-gap carve-out lookback K is **730 days**, not 365. This aligns with `ingest.backfill.self_serve_max_range_days = 730` and supersedes the 365d in D-10.
  - K=730 is a fixed invariant (F-07 convention, as in marketdata `CLAUDE.md` "Adaptive rate limit — fixed invariants"), not a config key. Record it in the ingest `CLAUDE.md` in the implementing PR.
- **Accepted residual (verbatim):** "An unfilled head gap (gaps[0]) is treated as the pre-listing carve-out, and the job ends COMPLETED, whenever the store has no bar in the 730 days before it. This covers three cases: the symbol was not yet listed; it was never fetched before (e.g. a first GAPS_ONLY run where only recent bars are stored and the vendor returns EMPTY or a short head); or the request starts inside a hole longer than 730 days."
- **One-time residual accepted (O-7):** GAPS_ONLY jobs created before deploy carry no verify marker and resume unverified.
- **Scope widening accepted.** The operator accepted:
  - the non-breaking proto enum value `BACKFILL_SYMBOL_OUTCOME_INCOMPLETE = 4` in `common.proto`, with 1 service-owner approval;
  - the ingest verify pass, the INCOMPLETE outcome and the coalescing planner;
  - the UI `backtestBackfill.ts` INCOMPLETE-only PARTIAL discriminator;
  - the agent and strat-lab doc sync.

  Update `product-spec.md` Fix Scope and Proto Contract to match at `/sdd-spec`.

### Open Threads

Each thread names its target step.

- O-8: on unset-start ranges, the planner, verify and resume scan the symbol's full history (2000 floor), and verify doubles it. Restate the bound and measure it against, or accept it within, the `@AC-1 @feature-153` budget. Do the same for pre-004 1-day chunk locks. → `/sdd-spec`
- O-9: confirm the exact coalescing boundary (merged span ≤ `chunk_window_days`, measured from the first gap start to the last gap end, read from config), and that `chunk_max_bars` still splits inside merged units. → `/sdd-spec`, ingest planner step
- Record K=730 as a fixed invariant in the ingest `CLAUDE.md`. → ingest verify step
- Coalescing re-fetches the stored sessions between gaps (extra vendor bandwidth and rate-limit pressure on symbols with dense holes). → ingest planner step (observe)
- IEX holes the vendor cannot fill stay INCOMPLETE/PARTIAL on every GAPS_ONLY run, and the vendor may publish the last session late. → runbook / strat-lab sync step (document)
- The `marketsession` closure table is maintained by hand and has no CI check. Pre-2022 Juneteenth is over-applied (`marketsession.go:82`). → closure-table step (decide fix or accept)
- An EMPTY symbol with stored bars in the 730 days before its first gap now becomes INCOMPLETE. Re-check that no `@AC-24 @feature-352` scenario uses GAPS_ONLY with prior history. → `/sdd-spec`
- The `/insights/strategies/[id]` GAPS_ONLY action (`page.tsx:547`) does not use `backfillJobMessage`, so it shows an INCOMPLETE-only PARTIAL as a plain PARTIAL. Decide whether it is in scope. → `/sdd-spec`
- The analysis readiness hot path calls `GetDataCoverage` over a 10-day window. Check the `array_agg` latency. → marketdata repo/service step

## Session 2026-11-26 — sdd-spec

- Generated `implementation-spec.md` with 19 steps. Status: design-approved → implementation-ready. Spec tree: `feature/fix-gapsonly-backfill-is@3c9982d0`.
- Updated `product-spec.md` Fix Scope and added a Proto Contract section, as the operator decision required. Added `@AC-4` (head carve-out, K=730), `@AC-5` (UI INCOMPLETE-only PARTIAL) and `@AC-6` (agent `incomplete` outcome) to `acceptance.feature`. Every `@AC-1..6` maps to a step's **Covers** line.
- Atomic units (`**Lands with**`):
  - 3+4 and 5+6 (the test references a new symbol);
  - 7+8 (proto + proto-gen);
  - 11+12: verify breaks the existing `test_gaps_only_plans_from_coverage_gaps` (`tests/test_ingest_servicer.py:1100-1127`, `assert_awaited_once` at `:1126`);
  - 13+14 (the test patches the new `list_job_symbols`).
- Key codebase findings:
  - `plan_chunks` drops `range_end <= range_start` (`backfill_chunks.py:52`). Session gaps therefore use `End = DayStart(last missing) + 12h` (noon New York). This keeps a one-session gap non-empty, and the UTC date of each bound equals the session date, so ingest formats `reason` dates without a tz database.
  - `chunk_max_bars` only batches symbols (`backfill_chunks.py:58-61`). A single-symbol merged unit of at most one window is one chunk. This closes O-9.
  - `job_row_to_proto` already rebuilds the range NULL-safely (`servicer.py:368-374`). Resume verify reuses `job_row_to_proto(row).range` instead of a new converter (D-7/R-8).
  - `/insights/strategies/[id]` renders only "Backfill started — job <id>" and no job status (`page.tsx:539-557`), so it is out of scope.
  - `@AC-24 @feature-352` is a fundamentals backfill (agent `delisted-symbol-handling.feature:24-29`), so it has no GAPS_ONLY conflict.
  - No exhaustive `Record`/switch over `BackfillSymbolOutcome` exists in any consumer, so the proto unit needs no extra parity edit.
  - `marketsession` is also consumed by portfolio and trading. Step 1 verifies both builds.
  - The ui `package.json` has no `typecheck` script, so UI steps use `pnpm exec tsc --noEmit`.

### Decisions

- Juneteenth before 2022 is **fixed** (rule gated on `y >= 2022`), not accepted. The calendar is now the gap oracle back to 2000.
- One-off NYSE closures since 2000 are added to `marketsession`. The maintenance rule is a constraint comment on the table, plus the marketdata `CLAUDE.md`.
- 1d coverage uses a new repo method `GetDailyCoverage` behind a `dailyCoverageReader` service seam. `GetCoverage` and `ComputeGaps` stay for 15m/1h.
- On resume, verify reads the planned symbols through a new repo function `list_job_symbols` (`SELECT DISTINCT unnest(symbols)` over the job's chunks). This keeps the design's "symbols that had planned units" rule.

### Open Threads

- **O-8, recorded as accepted at spec, not measured.** The 1d query keeps the identical predicate, so it locks the same chunks. The payload is ≤ ~6.8k timestamps for an unset start. Verify doubles the scan and adds one 730-day probe. That probe can exceed the 400-day `@AC-1 @feature-153` envelope only over legacy pre-`004` 1-day chunks. Measurement is a post-deploy dev smoke (Step 6 note). → `/sdd-review impl-spec`: confirm operator acceptance.
- **Session completing mid-job.** When `range.end` is unset, verify may report a session that completed after planning as missing. This is folded into the accepted "late last session" risk, with no mechanism added. → `/sdd-review impl-spec`.

## Session 2026-11-26 — sdd-review impl-spec

- Result: 0 failures, 9 warnings, 0 floor breaches (advisory; lifecycle unchanged, still `implementation-ready`). Overlap: WARN (file-level collisions only, no FAIL-class collision).
- Addressed (edited `implementation-spec.md`, each claim re-verified):
  - [x] Step 16: named the coverage threshold. `vitest.config.ts` enforces lines/functions/statements ≥ 40% scoped to `src/lib/**`. Playwright has no threshold.
  - [x] Steps 1–2: stated that CI has no golangci-lint job for `packages/proto` (`ci.yml:352-358`, service matrix only). `gofmt` + `go vet` are the lint gate.
  - [x] Step 11: defined `head_start = _ts_to_dt(cov.gaps[0].start)`. Stated that probing an interior `gaps[0]` is intended, because the stored bars before it make the probe hit.
  - [x] Steps 4, 6: `export GOWORK=off` so it reaches every `go` command in the chain.
- Still open (announce at each `/sdd-execute` checkpoint, P-03):
  - [ ] O-8 query load: the extra verify scan and the 730-day probe may exceed the 400-day `@AC-1 @feature-153` lock budget on legacy pre-`004` 1-day chunks. This is accepted, not measured. **Operator must confirm the acceptance.** Reviewer suggestion, not adopted without the operator: make the Step 6 dev smoke check an explicit gate before `/promote`.
  - [ ] Mid-job session close: a job with no range end that runs past 16:00 New York can have verify report that day's session as missing. The job then ends with a spurious PARTIAL/`incomplete`, and the strat-lab text tells agents not to re-trigger it. This is filed under the accepted late-published-session risk. **Operator must confirm.**
  - [ ] Step 17 RED: Step 17 is red-green, but its RED evidence is Step 19's doc-parity assertion, which runs later. Record that RED output at Step 19 (P-06/C-08).
  - [ ] Step 9 / O-9 (C-18, observe only): coalescing re-fetches stored sessions between gaps, which adds vendor bandwidth on symbols with dense holes. This is noted for reviewers; no change.
  - [ ] Step 1: widening the shared `marketsession` calendar changes portfolio offline valuation and trading behavior on historical dates. Pre-2022 June 19 becomes a trading day, and the one-off closures become non-trading days. This is intentional; portfolio and trading reviewers should be aware.
  - [ ] Merge order: `docs/roadmap/features/merge-order.md` has no 364 entry. Add a non-blocking entry covering `marketdata_service.go` (317, 322), `common.proto` (322, different messages), `INVENTORY.md` (308, 325, 345), ingest `servicer.py`/tests (309, 313, 322), agent `tools.py`/`client.py` (309, 310, 314, 322, 327, 328, 345) and `docs/runbooks/mcp-tools.md` (docs-only). This is outside this review's write scope. → before the integration PR.
- Overlap findings: no migration, config-key or proto-field-number collision. The additive `BACKFILL_SYMBOL_OUTCOME_INCOMPLETE = 4` is touched by no in-flight feature. The file-level collisions are listed above.

## Session 2026-11-26 — operator pre-execute decisions (main session)

- OPERATOR DECISION ('Gate (a), accept (b)'): (a) O-8 query load — the Step 6 dev smoke check is a REQUIRED gate before promotion: measure the verify scan + 730-day head probe lock cost on real data (incl. legacy pre-004 1-day chunks) against the @AC-1 @feature-153 400-day envelope before /promote. (b) Mid-job session close (no range end, running past 16:00 America/New_York → spurious PARTIAL/incomplete) is ACCEPTED under the late-published-session risk.
- Execution mode: /sdd-batch-execute SEQUENTIAL (mode-entry confirmation 'Agree: all three', 2026-11-26). Before the integration PR, add the non-blocking merge-order.md entry for 364 (overlaps 317/322/308/325/345, ingest servicer.py, agent tools.py/client.py).

## Session 2026-11-26 — sdd-execute sequential (sdd-batch-execute)

- Up-front confirmation: the operator approved the plan with this record (binding, verbatim):
  `{"mainDev":"34f68c57f6cf34a265f17ee6ac0d625ccb9146a7","dev":"1da1f150bc48216c1371adefc1bb435a2745b7b3","specHash":"775eb1989c0b352669e2947ed7426661b3322891","directive":"conditional","pending":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19],"mismatches":[{"n":1,"detail":"Line-number drift only; the substance matches. In packages/proto/marketsession/marketsession.go, the Juneteenth entry `observed(date(y, time.June, 19))` is at :82, not :81. isHoliday spans :74-94, not :74-92. Reference's doc comment is at :64-65 and the func at :66-72. Header :1-2 still says \"Early closes and one-off closures are not modelled.\" The consumer cites (delisting.go:12,128,162-163; offline_valuation.go:133-212; offline_pnl.go:49; trading go.mod:10,47) all match. No test file exists in the package."},{"n":3,"detail":"Line-number drift only. In services/xstockstrat-marketdata/internal/timeframe/timeframe.go, `type Gap` is at :76-79, not :77-80. The ComputeGaps doc is at :82-83 (the 'interior holes out of scope' text is at :83) and the func is at :84-101, not :82-99. Imports :6-11 (fmt, time, commonv1) match."},{"n":4,"detail":"In timeframe_test.go, TestComputeGaps spans :97-135, not :97-137. The import block is :3-8 and already includes commonv1, not just testing/time at :3-5. Step 4's code may already have commonv1 in scope."},{"n":9,"detail":"Minor drift: `window_days = self._cfg.backfill_chunk_window_days` is at servicer.py:824, not :823. _plan_work_ranges :787-812, the GetDataCoverage call :801-806, watcher.py:129-130 (default 90) and plan_chunks :35-71 all match."},{"n":18,"detail":"Minor drift: the get_backfill_status outcome table in docs/runbooks/mcp-tools.md has its header near :1123 and the empty/skipped/failed rows at :1125-1127. The cited range :1120-1126 leaves out the `failed` row at :1127. The `### get_backfill_status` heading at :1095 and the trigger_backfill delisted note at :1028 match."}]}`
- Merged main-dev `34f68c57` into the dev branch (`d45732f6`). The resolver kept ours for this feature's own files; ledger-guard was clean.
- Re-spec commits (directive `conditional`, Codebase Evidence line cites only):
  - `7d98c798` respec(fix-gapsonly-backfill-is): align steps 1,3,4,9,18 with current codebase
- Tooling detection: go1.27 ✓ · golangci-lint ✗ v2.5.0/go1.25 (install pinned v2.14.0 with `GOTOOLCHAIN=go1.27.0` at the first Go lint step) · uv ✓ · python 3.13 ✓ · node v22 on PATH, v24 at `/opt/node24` · pnpm ✓ 9.15.9 · buf ✗ (Docker codegen path; daemon not running, start `dockerd` at Step 8) · Playwright browsers ✓ `/opt/pw-browsers`.
- Status → `in-progress`.

```sdd-batch-setup
{"mainDev":"34f68c57f6cf34a265f17ee6ac0d625ccb9146a7","date":"2026-11-26"}
```

## Session 2026-11-26 — sdd-execute sequential, steps 1+2

- OPERATOR DECISION (binding, 2026-11-26): blocker on Step 1 resolved with **A** — fold Step 2 into Step 1 as the atomic unit `steps 1+2`; run each Step 1 Verification line from the repo root in its own subshell. Recorded in the Deviation Log.

### Step 1 — service: one-off NYSE closures and the post-2021 Juneteenth rule in `marketsession` [done]
- Added the unexported `closures` table (10 NYSE one-off closure dates since 2000, with the maintenance constraint comment), checked first in `isHoliday`; the Juneteenth rule now applies only for `y >= 2022`; header no longer claims one-off closures are unmodelled. No exported signature changed. Part of the unit `steps 1+2`.
- TDD (unit 1+2): red: `IsTradingDay(2025-01-09) = true, want false` and `IsTradingDay(2021-06-18) = false, want true` (plus the other closure rows and `PrevTradingDay(2025-01-10) = 2025-01-09, want 2025-01-08`), `exit=1` → green: 2 tests PASS, `ok github.com/xstockstrat/contracts/marketsession`; portfolio `ok github.com/xstockstrat/portfolio/internal/service`; trading builds; `gofmt -l` empty. No coverage threshold applies (package not in a CI coverage job).
- Files modified: `packages/proto/marketsession/marketsession.go`
- Deviations: folded with Step 2; Verification lines run in per-line subshells from the repo root (Deviation Log).

### Step 2 — test: `marketsession` closure and Juneteenth cases [done]
- Created the table test of `IsTradingDay` over the closure dates, 2022-06-20, 2021-06-18, 2025-01-10 and 2025-12-25, plus `PrevTradingDay(2025-01-10) == 2025-01-08`. Part of the unit `steps 1+2`.
- Files modified: `packages/proto/marketsession/marketsession_test.go`
- Deviations: folded into Step 1 (Deviation Log).
- Note: per `packages/proto/CLAUDE.md`, no CI job runs `go test` inside `packages/proto/`, so this test runs locally only; CI coverage of the closure dates comes via Step 4's `TestComputeSessionGaps` closure row (as the spec states).

## Session 2026-11-26 — sdd-execute sequential, steps 3+4

- Tooling: golangci-lint ⬇ v2.14.0 (built with go1.27.0, `GOTOOLCHAIN=go1.27.0 go install` into `$HOME/go/bin`); the Verification blocks ran unchanged with `$HOME/go/bin` first on `PATH`, because `/usr/local/bin/golangci-lint` is the stale v2.5.0/go1.25.

### Step 3 — service: `timeframe.ComputeSessionGaps` (head, interior and tail 1d gaps) [done]
- Added `ComputeSessionGaps(reqStart, reqEnd, stored, now)`: walks NY days from the first day-start ≥ `reqStart` up to `reqEnd` and the last countable session (`Reference(now)`, or the previous trading day while live), treats unstored `IsTradingDay` days as missing, and merges runs that only a stored session ends into `Gap{DayStart(first), DayStart(last)+12h}`. `ComputeGaps` is unchanged; its doc now names it the 15m/1h path. Part of the unit `steps 3+4`.
- TDD (unit 3+4, AC-1/AC-3): red: `undefined: ComputeSessionGaps` (build failed, `exit=1`) → green: Step 3 Verification `ok …/internal/timeframe`, `0 issues.`, `exit=0`; Step 4 Verification all packages `ok`, `total: (statements) 87.5%` (≥ 40%), `0 issues.`, `exit=0`; `-v` run shows all 8 `TestComputeSessionGaps` subtests PASS.
- Files modified: `services/xstockstrat-marketdata/internal/timeframe/timeframe.go`
- Deviations: none

### Step 4 — test: `TestComputeSessionGaps` (separation invariant, interior hole, full coverage, calendar) [done]
- Added `TestComputeSessionGaps` with `now` = 2026-11-26 18:00Z and subtests AC-1 interior hole, AC-3 fully covered, head and tail, separation invariant (weekend/Juneteenth/observed-July-4 merges plus a stored-session-between check), calendar (2025-01-09, 2025-12-25), live bound, reversed range, no bars. Part of the unit `steps 3+4`.
- The inline `stored` helper `weekdayStamps` lists every weekday (a superset of trading days) minus the excluded dates, so the calendar subtest fails if a closure or holiday were treated as a trading day; single consumer, stays inline (C-13).
- Files modified: `services/xstockstrat-marketdata/internal/timeframe/timeframe_test.go`
- Deviations: none

## Session 2026-11-26 — sdd-execute sequential, steps 5+6

- Tooling: go1.27 ✓ · golangci-lint ✓ v2.14.0 (`$HOME/go/bin`, first on `PATH`; `/usr/local/bin` is the stale v2.5.0). Config-key wiring gate: N/A (no config key touched).

### Step 5 — service: 1d `GetDataCoverage` reads stored session times and reports session gaps [done]
- Added repo `GetDailyCoverage` (one query: `MIN/MAX/COUNT + COALESCE(array_agg(time ORDER BY time), '{}')`, same predicate as `GetCoverage` with `timeframe='1d'`), the `dailyCoverageReader` seam + `dailyCoverage` field (assigned in the `if repo != nil` block), and the 1d branch in `GetDataCoverage` that fills `Gaps` from `timeframe.ComputeSessionGaps(start, end, times, time.Now())`; 15m/1h keep `GetCoverage` + `ComputeGaps`; `CoveredRanges` unchanged (R-5). marketdata `CLAUDE.md` names session-aware 1d gaps and the closure-table maintenance rule. Part of the unit `steps 5+6`.
- TDD (unit 5+6, AC-1/AC-3): red: `unknown field dailyCoverage in struct literal of type MarketDataService` (build failed, `exit=1`) → green: Step 5 Verification `ok …/internal/service`, `0 issues.`, `exit=0`; Step 6 Verification all packages `ok`, `total: (statements) 87.5%` (≥ 40%), `0 issues.`, `exit=0`; `-v` shows `TestGetDataCoverageDaily` PASS over its 4 subtests.
- Files modified: `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go`, `services/xstockstrat-marketdata/internal/service/marketdata_service.go`, `services/xstockstrat-marketdata/CLAUDE.md`
- Deviations: none

### Step 6 — test: service-level `GetDataCoverage` with a stubbed daily coverage reader [done]
- Created `TestGetDataCoverageDaily` with an inline `stubDailyCoverage` (records symbol/start/end) over a 2026-01-02..2026-11-20 window: AC-1 interior hole (one gap `[DayStart(2026-04-01), DayStart(2026-09-25)+12h]`, bars/earliest/latest from the stub, one covered range), AC-3 full coverage (no gaps), unset start floors at 2000-01-01 UTC, and a reader error wrapped as `get coverage:`. Part of the unit `steps 5+6`.
- Files modified: `services/xstockstrat-marketdata/internal/service/coverage_test.go`
- Deviations: none
- Note: the repo SQL (`array_agg` scan into `[]time.Time`) has no offline test (needs a DB); the Step 6 dev smoke remains the required pre-promotion gate (operator decision (a)).

## Session 2026-11-26 — sdd-execute sequential, steps 7+8

- OPERATOR DECISION (binding, 2026-11-26): blocker on Step 7 resolved with **A**. Keep Step 8's ingest import assertion and give it the conftest's import path (`sys.path.insert(0, 'tests'); import conftest`). Recorded in the Deviation Log.
- Tooling: buf ✗ on host → the pinned `xstockstrat-codegen` image (`dockerd` started, image rebuilt from cache) · go1.27 ✓ · uv ✓ (`uv sync --extra dev` in ingest) · config-key wiring gate N/A (no config key touched).

### Step 7 — proto: `BACKFILL_SYMBOL_OUTCOME_INCOMPLETE = 4` [done]
- Appended `BACKFILL_SYMBOL_OUTCOME_INCOMPLETE = 4` after FAILED. The `BackfillSymbolResult` comment now also says that for INCOMPLETE, `reason` holds the still-missing session ranges (2 lines). Part of the unit `steps 7+8`.
- TDD: N/A (proto). Verification `buf lint && buf breaking` against the main checkout's `feature/fix-gapsonly-backfill-is`: `exit=0`, no findings.
- Files modified: `packages/proto/common/v1/common.proto`
- Deviations: ran in the codegen container (CI-equivalent fallback, Deviation Log).

### Step 8 — proto-gen: regenerate stubs [done]
- `buf-gen.sh` changed only the `common/v1` stubs: Go `common.pb.go`, Python `common_pb2.py`, TS `common.ts`/`common_pb.ts` and their four `dist/` files. marketdata `go build ./...` passes and ingest asserts `BACKFILL_SYMBOL_OUTCOME_INCOMPLETE == 4`. A second `buf-gen.sh` left the gen diff byte-identical. Part of the unit `steps 7+8`.
- TDD: N/A (proto-gen). Verification `exit=0`.
- Files modified: `packages/proto/gen/go/common/v1/common.pb.go`, `packages/proto/gen/python/common/v1/common_pb2.py`, `packages/proto/gen/ts/common/v1/common.ts`, `packages/proto/gen/ts/common/v1/common_pb.ts`, `packages/proto/gen/ts/dist/common/v1/common.{d.ts,js}`, `packages/proto/gen/ts/dist/common/v1/common_pb.{d.ts,js}`
- Deviations: ingest assertion gets the conftest import path (operator A); codegen ran in the container (Deviation Log).

## Session 2026-11-26 — operator standing authorization: adjacent folds (main session)

- OPERATOR DECISION (blocker:9, verbatim choice 'A: fold Steps 9+10'): fold Step 10 into Step 9 as the atomic unit 'steps 9+10' — write Step 10's tests first and capture RED (40 units > 5), implement the per-symbol coalescing in _plan_work_ranges, GREEN with both Verification blocks, one commit, fold logged in the Deviation Log.
- STANDING AUTHORIZATION (verbatim choice 'Yes, auto-fold adjacent'), anchor `auth-364-adjacent-folds-2026-11-26`: for the rest of this feature's /sdd-batch-execute run, foldPolicy 'adjacent' is authorized — a step that cannot pass its own Verification because the immediately following step(s) repair it (adjacent, one consumer surface, unit ≤ 4) is folded per sdd-execute/reference/atomic-units.md without halting, with a Deviation Log entry; any other gap still halts for the operator. Scope: 364 only.

## Session 2026-11-26 — sdd-execute sequential, steps 9+10

- Operator decision A (recorded above): Step 10 folded into Step 9 as the unit `steps 9+10`; logged in the Deviation Log.
- Tooling: uv ✓ (`uv sync --extra dev` in ingest; the venv resolves python 3.12, allowed by `requires-python >=3.12`) · ruff ✓ · pytest ✓. Config-key wiring gate: N/A (the product spec declares no config key; `backfill.chunk_window_days` is only read).

### Step 9 — service: GAPS_ONLY planner coalesces each symbol's gaps within `chunk_window_days` [done]
- The `_plan_work_ranges` GAPS_ONLY branch merges a symbol's sorted gaps into one unit while `gap_end - unit_start <= timedelta(days=self._cfg.backfill_chunk_window_days)`; a longer single gap stays its own unit. `GetDataCoverage` call shape unchanged; docstring states the bound. Part of the unit `steps 9+10`.
- TDD (unit 9+10, AC-1/O-9): red: `AssertionError: assert 40 <= 5` in `test_gaps_only_coalesces_scattered_gaps_within_window` (`1 failed, 2 passed`, `exit=1`) → green: Step 9 Verification `3 passed, 171 deselected`, `exit=0`; Step 10 Verification `607 passed`, `Required test coverage of 40% reached. Total coverage: 87.22%`, `exit=0`.
- Observe-only (C-18): coalescing re-fetches stored sessions between gaps (extra vendor bandwidth on dense-hole symbols); no mechanism added.
- Files modified: `services/xstockstrat-ingest/app/handlers/servicer.py`
- Deviations: folded with Step 10 (Deviation Log).

### Step 10 — test: coalescing bound and one chunk per merged unit (O-9) [done]
- Added `test_gaps_only_coalesces_scattered_gaps_within_window` (40 one-session gaps every 9 days from 2025-11-20 → ≤ 5 units, each ≤ 90 days, covering every gap, one `plan_chunks` chunk per unit) and `test_gaps_only_long_gap_stays_its_own_unit` (2026-04-01..2026-09-25 plus 2026-10-15 → 2 units; `plan_chunks` splits the long one into 2). A real `GetDataCoverageResponse` is built by the inline `_gaps_only_req` helper (single consumer, C-13). Part of the unit `steps 9+10`.
- Files modified: `services/xstockstrat-ingest/tests/test_ingest_servicer.py`
- Deviations: folded into Step 9 (Deviation Log).

## Session 2026-11-26 — sdd-execute sequential, steps 11+12

- Planned atomic unit `steps 11+12` (`**Lands with**`). Tooling: uv ✓ (`uv sync --extra dev` in ingest) · ruff ✓ · pytest ✓. Config-key wiring gate: N/A (no config key touched; K = 730 is a code invariant).
- Discovery: every Codebase Evidence symbol found; line cites drift by ~+9 after Step 9 (e.g. `_execute_backfill` plan-time `update_job` now `:865`, `_finalize_backfill` `:877`); substance unchanged.

### Step 11 — service: fresh-path GAPS_ONLY verify, INCOMPLETE outcome, widened finalize gate [done]
- Added `_GAPS_ONLY_VERIFY_KEY`, `_SYMBOL_INCOMPLETE`, `_HEAD_PROBE_DAYS = 730` (constraint comment) and precedence EMPTY 1 / SKIPPED 2 / INCOMPLETE 3 / FAILED 4; new `_verify_gaps_only` (cancel checks, SKIPPED skip, `gaps[1:]` missing, 730-day head probe, RPC error → FAILED + `failed_symbols`, wholesale `gaps_only` write + persist, WARN log); GAPS_ONLY `_execute_backfill` seeds the marker at plan time and into `_run_chunks`, then verifies; `_finalize_backfill` adds the INCOMPLETE → PARTIAL branch, `incomplete_symbols` in the completed payload, and alerts only on failed symbols/chunks. Ingest `CLAUDE.md` documents verify, K = 730 (fixed invariant, O-1 residual verbatim in substance) and the O-7 residual. Part of the unit `steps 11+12`.
- TDD (unit 11+12, AC-1/2/3/4): AC-2 red: `assert 3 == 5` (final status COMPLETED, want PARTIAL), 9 failed / 609 passed, `exit=1` → green: `All checks passed!`, `58 files already formatted`, `618 passed`, `Required test coverage of 40% reached. Total coverage: 87.41%`, `exit=0`.
- Files modified: `services/xstockstrat-ingest/app/handlers/servicer.py`, `services/xstockstrat-ingest/CLAUDE.md`
- Deviations: none

### Step 12 — test: verify pass — AC-1/2/3/4, head probe, RPC failure, cancel, SKIPPED, alert gate [done]
- `test_gaps_only_plans_from_coverage_gaps` now uses real `GetDataCoverageResponse` plan/verify values, asserts `await_count == 2` and a final COMPLETED. New `TestGapsOnlyVerify` (inline per-symbol coverage fake, single consumer, C-13; reuses `_job_row`): AC-1 SCHW, AC-2 IDXX (stored INCOMPLETE reason, merged read, no alert, `incomplete_symbols == ["IDXX"]`), AC-3 RLI (one coverage call, no BackfillBars, `bars_processed` 0), AC-4 NEWCO probe miss/hit with the exact 730-day probe range, interior-after-carved-head, verify RPC failure (WARNING alert), cancel during verify (only the RUNNING status write; BBB never verified), SKIPPED PSKY not verified, precedence EMPTY+INCOMPLETE → INCOMPLETE and FAILED+INCOMPLETE → FAILED. Part of the unit `steps 11+12`.
- Files modified: `services/xstockstrat-ingest/tests/test_ingest_servicer.py`
- Deviations: none
- Note: `_assert_results_invariant` (feature 352 helper) merges by `max(outcome)`, which would rank INCOMPLETE (4) above FAILED (3); none of its callers store INCOMPLETE, so it is untouched (out of scope).

## Session 2026-11-26 — sdd-execute sequential, steps 13+14

- Planned atomic unit `steps 13+14` (`**Lands with**`). Tooling: uv ✓ (`uv sync --extra dev` in ingest) · ruff ✓ · pytest ✓. Config-key wiring gate: N/A (no config key touched).
- Discovery: every Codebase Evidence symbol found; `_resume_job` at `servicer.py:1043-1076` before this unit (drift after Steps 9–12), `job_row_to_proto` NULL-safe range rebuild at `:374-380`; substance unchanged.

### Step 13 — service: resume path runs verify, with a NULL-safe range rebuild [done]
- Added repo `list_job_symbols` (`SELECT DISTINCT unnest(symbols) AS symbol … WHERE job_id = $1::uuid ORDER BY symbol`). `_resume_job` calls `_verify_gaps_only(job_id, list_job_symbols(...), job_row_to_proto(row).range, tf_enum, state, meta)` after `_run_chunks` when the `gaps_only` marker is in `state["symbol_results"]`; unmarked jobs resume as before (O-7). Part of the unit `steps 13+14`.
- TDD (unit 13+14, AC-2): red (pre-unit tree): 4 failed, `AttributeError: … backfill_chunks … has no attribute 'list_job_symbols'`; red (repo fn only, resume unchanged): `IndexError: list index out of range` at `calls[0]` in the NULL-start/NULL-end tests — resume issued no verify `GetDataCoverage` (so (a) would end COMPLETED), `2 failed, 620 passed`, `exit=1` → green: `All checks passed!`, `58 files already formatted`, `622 passed`, `Required test coverage of 40% reached. Total coverage: 87.72%`, `exit=0`.
- Files modified: `services/xstockstrat-ingest/app/handlers/servicer.py`, `services/xstockstrat-ingest/app/repositories/backfill_chunks.py`
- Deviations: none

### Step 14 — test: resume verify with NULL bounds; `list_job_symbols` [done]
- Added `TestChunkRepo.test_list_job_symbols` (SQL has `DISTINCT unnest(symbols)`, passes `job_id`) and `TestGapsOnlyResumeVerify`: (a) NULL start → verify request has no `start`, `end` = 2026-11-25, probe hit → PARTIAL + stored INCOMPLETE `missing sessions 2026-04-01..2026-09-25`; (b) NULL end → no `end`, COMPLETED; (c) no marker → `GetDataCoverage` never awaited. Reuses `_job_row` and Step 12's `TestGapsOnlyVerify._coverage`/`_cov`/`_HOLE` (C-13). Part of the unit `steps 13+14`.
- Files modified: `services/xstockstrat-ingest/tests/test_ingest_servicer.py`, `services/xstockstrat-ingest/tests/test_backfill_chunks.py`
- Deviations: none

## Session 2026-11-26 — merge-order open item resolved (main session)

- RESOLVED (open item "add a non-blocking merge-order.md entry for 364 before the integration PR"): intentionally NOT added. `docs/roadmap/features/merge-order.md` § Coverage note lists only hard ordering constraints and says ordinary textual overlap "is intentionally not listed"; and /sdd-batch-execute preflight item 5 treats any row naming this feature with Resolved != Yes as a merge-order block. 364's overlaps (317/322 marketdata_service.go, 322 common.proto, 308/325/345 INVENTORY.md, ingest servicer.py and agent tools.py/client.py peers) are rebase-only — no shared migration NNN, proto field number or config key — so no row is warranted. Whichever lands second rebases.
- Operator checkpoint:13 decision (verbatim 'Proceed'): continue to Steps 15–19 (UI, agent, docs) and the integration PR.

## Session 2026-11-26 — sdd-execute sequential, steps 15+16

- OPERATOR DECISION (binding, 2026-11-26): blocker on Step 15 resolved with **A** — the main checkout was detached at `origin/feature/fix-gapsonly-backfill-is` (9f6f3bae), so the linked `@xstockstrat/proto` dist carries Step 8's `BackfillSymbolOutcome.INCOMPLETE = 4`; Steps 15+16 run as the adjacent-fold unit (standing authorization `auth-364-adjacent-folds-2026-11-26`), RED from vitest row (a), GREEN from both Verification blocks. Logged in the Deviation Log.
- Tooling: node v22 + pnpm 9.15.9 ✓ (linked main-checkout `node_modules`, no install) · Playwright Chromium ✓ `/opt/pw-browsers` · host `pnpm dev` warmup ✗ (10 s timeout) → Playwright under `CI=1` (CI-equivalent fallback, Deviation Log). Config-key wiring gate: N/A (no config key touched).

### Step 15 — service: UI maps an INCOMPLETE-only PARTIAL to the vendor-has-no-bars state [done]
- `BackfillJobLike` gains `symbolResults?: { outcome: BackfillSymbolOutcome }[]` (value import from `common_pb`); the PARTIAL case first returns `{ state: 'ready', text: 'Backfill finished: vendor has no bars for some sessions of <SYM>' }` when no chunk failed and `symbolResults` has an INCOMPLETE and no FAILED entry; the existing PARTIAL texts are unchanged; `page.tsx` unchanged. Part of the unit `steps 15+16`.
- TDD (unit 15+16, AC-5): red: vitest row `@AC-5 partial with only INCOMPLETE symbols` — `AssertionError: expected { state: 'partial', …(1) } to deeply equal { state: 'ready', …(1) }`, `Tests 1 failed | 747 passed` → green: Step 15 Verification `exit=0`; Step 16 Verification `Tests 748 passed | 2 skipped (750)`, `Lines : 82.13%` (≥ 40%), Playwright `7 passed (1.8m)` incl. the new `@AC-5 an INCOMPLETE-only partial …` and `@AC-13`, `exit=0`.
- Files modified: `services/xstockstrat-ui/src/lib/backtestBackfill.ts`
- Deviations: folded with Step 16 (Deviation Log).

### Step 16 — test: vitest discriminator rows and a Playwright INCOMPLETE-only scenario [done]
- Added the fixture `incompleteSymbolResult(symbol, reason?)` (numeric `BackfillSymbolOutcome.INCOMPLETE`, two consumers, C-12) and its INVENTORY entry; vitest rows (a) INCOMPLETE-only → ready text, (b) INCOMPLETE + FAILED → "returned no data" partial, (c) INCOMPLETE with 2/3 chunks → chunk-failed text; Playwright `@AC-5` INCOMPLETE-only PARTIAL → status text, Re-run, then `No vendor data for` and no backfill action. Part of the unit `steps 15+16`.
- Files modified: `services/xstockstrat-ui/src/lib/backtestBackfill.test.ts`, `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts`, `services/xstockstrat-ui/e2e/fixtures/backfillJobs.ts`, `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`
- Deviations: folded into Step 15; Verification grep line run from the repo root and Playwright under `CI=1` (Deviation Log).
- Note: the new Playwright title reuses the `@AC-5` tag that feature 343's re-run test already carries in this describe; the grep `@AC-5|@AC-13|@AC-4` selects both.

## Session 2026-11-26 — sdd-execute sequential, step 17

- Tooling: uv ✓ (`uv sync --extra dev` in agent) · ruff ✓ · pytest ✓. Config-key wiring gate: N/A (no config key touched).
- Discovery: `get_backfill_status` docstring `tools.py:1775-1778`, `_backfill_job_to_dict` docstring `client.py:2175`, agent `CLAUDE.md:35` and `common.proto:161` `BACKFILL_SYMBOL_OUTCOME_INCOMPLETE = 4` all confirmed on the dev branch.

### Step 17 — service: agent `get_backfill_status` docstrings and `CLAUDE.md` name the `incomplete` outcome [done]
- The `get_backfill_status` docstring (the MCP tool description) lists `"incomplete"`: a GAPS_ONLY bars job verified that sessions in the range are still missing; `reason` lists `missing sessions YYYY-MM-DD..YYYY-MM-DD[; …]`; the symbol is not in `failed_symbols`; the job ends PARTIAL. The `_backfill_job_to_dict` docstring reads `empty|skipped|failed|incomplete` (wrapped to two lines for E501). Agent `CLAUDE.md` names `incomplete` (feature 364) with the same meaning. No behavior change; the projection already derives `incomplete` from the enum name.
- TDD (interim; durable RED/GREEN at Step 19): red: uncommitted probe `'"incomplete"' in` the `get_backfill_status` catalog description → `AssertionError`, `1 failed`, `exit=1` → green: probe `1 passed`, `exit=0`; Step 17 Verification `All checks passed!`, `79 files already formatted`, `87 passed`, `exit=0` (this command has no coverage threshold; Step 19 runs `--cov-fail-under=40`).
- Files modified: `services/xstockstrat-agent/app/tools.py`, `services/xstockstrat-agent/app/client.py`, `services/xstockstrat-agent/CLAUDE.md`
- Deviations: RED captured now with an uncommitted probe (Deviation Log).

## Session 2026-11-26 — sdd-execute sequential, step 18

- Tooling: none needed (docs; grep, plus `python3` for the strat-lab validator). Config-key wiring gate: N/A (no config key touched).
- Discovery: `mcp-tools.md` delisted note `:1028-1030` and outcome table `:1123-1127`, `historical-backfill.md:357-359`, strat-lab `SKILL.md:222-224` and `reference/backfill.md:59-62` all confirmed on the dev branch; `incomplete` was absent as an outcome before the edit.

### Step 18 — docs: runbook and strat-lab `backtest` skill sync for `incomplete` [done]
- `mcp-tools.md`: an `incomplete` row in the `get_backfill_status` outcome table (gaps_only bars only; reason names the ranges; job `PARTIAL`; not in `failed_symbols`; no alert; 730-day head-gap exemption) and one sentence under `trigger_backfill` that `gaps_only` now fills interior holes. `historical-backfill.md` Gaps-only bullet: session-aware interior gaps, an unfillable range ends `PARTIAL` with `incomplete` symbols, plus the two accepted residuals (IEX holes recur; late last session). strat-lab `SKILL.md` and `reference/backfill.md`: `incomplete` = vendor has no bars, do not re-trigger the same range; an `incomplete`-only `PARTIAL` is data-final. `gaps_only` kept in all three files.
- TDD: N/A (docs). Verification: grep lists `incomplete` in all four files; `gaps_only` counts SKILL.md 2 / backfill.md 2 / mcp-tools.md 4; `exit=0`. Extra check: `plugins/strat-lab/scripts/validate.py --self-test` and the plain run `passed all checks`, `exit=0`.
- Files modified: `docs/runbooks/mcp-tools.md`, `docs/runbooks/historical-backfill.md`, `plugins/strat-lab/skills/backtest/SKILL.md`, `plugins/strat-lab/skills/backtest/reference/backfill.md`
- Deviations: none
- Note: the strat-lab `plugin.json` version (`.claude-plugin/` and `.cursor-plugin/`) was not bumped; it is outside this step's **Files**.

## Session 2026-11-26 — sdd-execute sequential, step 19

- OPERATOR DECISION (binding, 2026-11-26, verbatim choice 'Bump to 0.5.1'): Step 19's commit also bumps the strat-lab plugin version 0.5.0 → 0.5.1 in both `plugin.json` files (byte-identical) and runs `python3 plugins/strat-lab/scripts/validate.py` in Verification. Logged as an out-of-scope, operator-sanctioned change in the Deviation Log.
- Tooling: uv ✓ (`uv sync --extra dev` in agent) · ruff ✓ 0.16.9 · pytest ✓ · python3 (validator) ✓. Config-key wiring gate: step-time N/A (no config key touched); `--final` (last step) `exit=0`, only two unrelated baseline `REPORTED:` lines (analysis `fundsignal_loop.py`, trading `trading.go`, `readers-disagree`).
- Discovery: `_symbol_results_job` `test_client.py:755`, `_SYMBOL_RESULTS` `:781`, `test_single_job_symbol_results_outcomes_and_reasons` `:788`, descriptor guard `:828`; `_REPO` `test_tools_endpoint.py:15`, `_catalog()` `:78`, `test_docs_and_skill_parity_with_self_serve_backfill` `:112-135` — all confirmed on the dev branch.

### Step 19 — test: agent projects `incomplete` and docs stay in parity [done]
- Added `test_incomplete_outcome_projects_with_its_ranges` (inline PARTIAL `BackfillJob` with an IDXX INCOMPLETE result → `{"symbol": "IDXX", "outcome": "incomplete", "reason": "missing sessions 2026-04-01..2026-09-25"}`, IDXX not in `failed_symbols`; characterization, passes since Step 8) and `test_docs_and_skill_parity_with_incomplete_outcome` (`incomplete` in the `get_backfill_status` description, the runbook `### get_backfill_status` section and `reference/backfill.md`; `` `incomplete` `` in `SKILL.md`). Inline protos, single consumer (C-13).
- TDD (AC-6; also the durable RED for Step 17): red: Verification on the pre-Step-17 `tools.py`/`mcp-tools.md`/`SKILL.md`/`backfill.md` (checked out from `c7f53489`, then restored) → `AssertionError: get_backfill_status description`, `1 failed, 826 passed`, `exit=1`; projection test red N/A — no behavior change; characterization test added → green on HEAD: `All checks passed!`, `79 files already formatted`, `827 passed`, `Required test coverage of 40% reached. Total coverage: 88.47%`, `exit=0`; validator `passed all checks`, `exit=0`.
- Files modified: `services/xstockstrat-agent/tests/test_client.py`, `services/xstockstrat-agent/tests/test_tools_endpoint.py`, `plugins/strat-lab/.claude-plugin/plugin.json`, `plugins/strat-lab/.cursor-plugin/plugin.json`
- Deviations: RED against the pre-Step-17/18 surfaces with a backticked SKILL.md token; plugin version bump (operator-sanctioned) — both in the Deviation Log.
- Status → `code-completed` (all 19 steps done). No insights.md entry: nothing generalizes beyond the existing doc-parity pattern.

## Session 2026-11-26 — sdd-batch-execute promotion plan (awaiting operator confirm)

```sdd-batch-promotion-plan
## Promotion plan — fix-gapsonly-backfill-is (feature 364)

Source: docs/roadmap/features/364-fix-gapsonly-backfill-is/acceptance.feature (6 scenarios, AC-1..AC-6). I read the working-tree copy, not origin/feature/fix-gapsonly-backfill-is. The AC-4..AC-6 additions from /sdd-spec are present in it. The caller should confirm the branch copy is identical.

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| AC-1 | services/xstockstrat-ingest/acceptance/fix-gapsonly-backfill-is.feature | CREATE | NEW | GAPS_ONLY logic lives in ingest (servicer.py, backfill_chunks.py). |
| AC-2 | services/xstockstrat-ingest/acceptance/fix-gapsonly-backfill-is.feature | CREATE | NEW | Job status and result are ingest-owned. |
| AC-3 | services/xstockstrat-ingest/acceptance/fix-gapsonly-backfill-is.feature | CREATE | NEW | The Then asserts job bars_processed, which ingest owns. |
| AC-4 | services/xstockstrat-ingest/acceptance/fix-gapsonly-backfill-is.feature | CREATE | NEW | Head-gap carve-out (K=730d). |
| AC-5 | services/xstockstrat-ui/acceptance/fix-gapsonly-backfill-is.feature | CREATE | NEW | The Then asserts Backtests card text. Its last clause partly overlaps feature 343 AC-13 (see Notes). |
| AC-6 | services/xstockstrat-agent/acceptance/fix-gapsonly-backfill-is.feature | CREATE | NEW | The Then asserts the get_backfill_status tool result, which the agent owns. |

### Ready-to-write blocks
--- /home/user/xstockstrat/services/xstockstrat-ingest/acceptance/fix-gapsonly-backfill-is.feature (CREATE) ---
# Promoted from docs/roadmap/features/364-fix-gapsonly-backfill-is/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-364` tag.
# Durable business rules xstockstrat-ingest already guarantees — a rule enters only by promotion from
# a reviewed feature acceptance.feature, never by hand-authoring.

Feature: fix-gapsonly-backfill-is (ingest)
  GAPS_ONLY backfill detects interior holes and never reports COMPLETED while sessions remain missing.
  "Trading session" = a US-equity regular trading day (weekday, not a US exchange holiday).

  @AC-1 @FR-1 @regression @feature-364
  Scenario: A GAPS_ONLY backfill fills an interior hole in daily bars
    Given SCHW has daily bars from 2025-11-20 to 2026-03-31 and from 2026-09-28 to 2026-11-25
    And SCHW has no daily bars from 2026-04-01 to 2026-09-25
    When a GAPS_ONLY daily-bar backfill runs for SCHW from 2025-11-20 to 2026-11-25
    Then the job ends COMPLETED
    And SCHW has a daily bar for every trading session from 2025-11-20 to 2026-11-25

  @AC-2 @FR-2 @regression @feature-364
  Scenario: A GAPS_ONLY backfill that cannot fill an interior hole does not report COMPLETED
    Given IDXX has daily bars from 2025-11-20 to 2026-03-31 and from 2026-09-28 to 2026-11-25
    And IDXX has no daily bars from 2026-04-01 to 2026-09-25
    And the vendor returns no bars for IDXX from 2026-04-01 to 2026-09-25
    When a GAPS_ONLY daily-bar backfill runs for IDXX from 2025-11-20 to 2026-11-25
    Then get_backfill_status does not report the job as COMPLETED with no missing sessions
    And the job's result identifies 2026-04-01 to 2026-09-25 as still missing for IDXX

  @AC-3 @FR-3 @feature-364
  Scenario: A GAPS_ONLY backfill over a fully covered range fetches nothing
    Given RLI has a daily bar for every trading session from 2025-11-20 to 2026-11-25
    When a GAPS_ONLY daily-bar backfill runs for RLI from 2025-11-20 to 2026-11-25
    Then the job ends COMPLETED
    And get_backfill_status reports bars_processed 0 for the job

  @AC-4 @FR-2 @feature-364
  Scenario: A GAPS_ONLY backfill whose only unfilled range is a head gap with no earlier bars completes
    Given NEWCO has daily bars from 2026-06-01 to 2026-11-25 and no daily bar in the 730 days before 2026-06-01
    And the vendor returns no bars for NEWCO before 2026-06-01
    When a GAPS_ONLY daily-bar backfill runs for NEWCO from 2025-11-20 to 2026-11-25
    Then the job ends COMPLETED
    And get_backfill_status lists no "incomplete" outcome for NEWCO

--- /home/user/xstockstrat/services/xstockstrat-ui/acceptance/fix-gapsonly-backfill-is.feature (CREATE) ---
# Promoted from docs/roadmap/features/364-fix-gapsonly-backfill-is/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-364` tag.
# Durable business rules xstockstrat-ui already guarantees — a rule enters only by promotion from
# a reviewed feature acceptance.feature, never by hand-authoring.

Feature: fix-gapsonly-backfill-is (ui)
  How the Backtests card presents a GAPS_ONLY backfill that finished with an unfillable interior hole.

  @AC-5 @FR-2 @feature-364
  Scenario: The Backtests card reports an unfillable interior hole as vendor data missing, not as a retryable partial
    Given the backfill for "LYFT" triggered from the Backtests card ended PARTIAL with every chunk completed
    And its only per-symbol result is "LYFT" with outcome "incomplete"
    When the Backtests card is shown
    Then it shows "Backfill finished: vendor has no bars for some sessions of LYFT"
    And it offers "Re-run backtest"
    And when "Re-run backtest" returns insufficient data with the same gap, the card shows "No vendor data for" that gap and no "Backfill missing data" action

--- /home/user/xstockstrat/services/xstockstrat-agent/acceptance/fix-gapsonly-backfill-is.feature (CREATE) ---
# Promoted from docs/roadmap/features/364-fix-gapsonly-backfill-is/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-364` tag.
# Durable business rules xstockstrat-agent already guarantees — a rule enters only by promotion from
# a reviewed feature acceptance.feature, never by hand-authoring.

Feature: fix-gapsonly-backfill-is (agent)
  What the get_backfill_status MCP tool reports for a GAPS_ONLY backfill with still-missing sessions.

  @AC-6 @FR-2 @feature-364
  Scenario: get_backfill_status reports the still-missing sessions as an incomplete outcome
    Given a GAPS_ONLY daily-bar backfill for IDXX ended PARTIAL because 2026-04-01 to 2026-09-25 is still missing
    When get_backfill_status is called for the job
    Then the result lists "IDXX" with outcome "incomplete" and a reason containing "2026-04-01..2026-09-25"
    And "IDXX" is not in failed_symbols

### Notes / ambiguities / conflicts
- Dedup: grep of every services/*/acceptance/*.feature for `feature-364` and `GAPS_ONLY` found no existing matches, so there are no DUP or CONFLICT cases. All three target files are new. Ingest, ui and agent already have an `acceptance/` directory, so none needs to be created.
- Attribution:
  - AC-1 to AC-4 go to ingest, where the GAPS_ONLY job logic lives: services/xstockstrat-ingest/app/handlers/servicer.py and app/repositories/backfill_chunks.py.
  - AC-3 and AC-4 mention get_backfill_status in the Then, but the asserted subject is the ingest job outcome and bars_processed. I kept both in ingest and did not duplicate them in agent.
  - AC-5 goes to ui because the Then asserts card text.
  - AC-6 goes to agent because the Then asserts the MCP tool's result shape (outcome "incomplete", failed_symbols). This extends the symbol_results contract from feature 352 (services/xstockstrat-agent/CLAUDE.md).
  - Marketdata is named in the feature's Reviewers table but owns no scenario's observable subject.
- Possible OVERLAP, flagged for human consolidation: the last clause of AC-5 ("No vendor data for <gap>", no "Backfill missing data" action) restates part of feature 343 AC-13 (services/xstockstrat-ui/acceptance/backtest-inline-backfill.feature, lines 90-95). AC-5's first two clauses ("Backfill finished: vendor has no bars...", "Re-run backtest") are not covered there. I judged the scenario NEW and promoted it whole, since splitting would break the verbatim rule. I did not touch 343 AC-13.
- AC-4 and AC-5 are tagged @FR-2 only, as in the source. No @regression tag is added where the source lacks one.
- Tag order: I kept the source tags and appended @feature-364, per the provenance rule. AC numbers are unchanged.

### Coverage check
- Source scenarios: 6. Planned (NEW+DUP+OVERLAP): 6 (NEW 6, DUP 0, OVERLAP 0, CONFLICT 0). Ingest gets 4 (AC-1..4), ui gets 1 (AC-5) and agent gets 1 (AC-6), which totals 6. No scenario was skipped.
```

## Session 2026-11-27 (CI: feature status automation)

- Promotion PR #1633 merged to main
- Feature promoted and committed: 5eeca9c8d00bc549c14dcd852862574d806b0fd2
- Status updated: `code-completed` → `launched`
- Launched date: 2026-11-27
