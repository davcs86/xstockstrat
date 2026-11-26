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
