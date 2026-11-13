# Context Log: fix-analysis-per-symbol-isolation

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - `docs/reports/2026-10-21-analysis-opportunities-row-gather-no-per-symbol-isolation-defect.md` — one candidate's non-RpcError aborts the whole per-user opportunities compute (SEV-2)
  - `docs/reports/2026-10-21-analysis-readiness-gather-no-per-symbol-isolation-defect.md` — EvaluateReadiness fails entirely when one symbol's readiness compute raises (SEV-2)
  - `docs/reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md` — a genuine indicators outage loses whole readiness batches and heal rows (SEV-3)
- Cluster rationale: all three are the same isolation-scope defect (per-symbol work inside a fan-out whose only handler is outside the per-symbol unit) in one service, the sibling of feature 245's screener fix.
- Severity: SEV-2 (highest of the cluster)
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (3 regression scenarios), context.md; report sidecars stamped `triaged`
- Affected services (from reports): xstockstrat-analysis
- Root cause hypothesis: isolation scope; feature 185 deliberately lets FormulaExecutionError propagate (servicer.py:5829) — contract decision is Open Question 1
- Recommended design depth: quick → `/sdd-design fix-analysis-per-symbol-isolation quick` (rationale: SEV-2, single service, no proto/migration/config)
- Development branch: feature/fix-analysis-per-symbol-isolation

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); OQ1 contract reversal baked into AC-1; AC-3 spans kick/materializer/heal paths; fetch_failed race (OQ3) has no scenario
- Overlap findings: WARN: xstockstrat-analysis shared with 309, 313, 327, 323, 329
- Recommended design depth: full (analysis servicer overlaps 309/313/327; OQ1 reverses feature-185 abort contract)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

- `/sdd-design fix-analysis-per-symbol-isolation` (full debate, run by `/sdd-batch`) is at its approval gate after round 2. Gate policy: halt. design.md is not written and status.md is unchanged. The debate register is `debate.md` in this directory.

### Open Threads

- **Approach.** D-1 to D-7 stand. Per-symbol isolation sits at the callers (EvaluateReadiness, kick, materializer, `_compute_opportunities`, heal) and catches `except Exception` only. A degraded readiness row reuses the `bar_epoch=-1` sentinel. Opportunity faults are classified by `_is_transient_formula_error`. Round 2 (D-8) rebuilds that predicate on the typed `SandboxExitReason` carried on `FormulaExecutionError.exit_reason`, never on error text. Transient means `grpc.RpcError` or `exit_reason == TIMEOUT`. D-9 adds one field in indicators: the deadline-refusal response (indicators `servicer.py:349-359`) now sets `exit_reason=TIMEOUT`, so a load-driven refusal can be healed. D-10 accepts the readiness-side 300 s re-kick, bounded at k components × pairs spawns while a client polls. No proto change.
- **Strongest open objection (blocking): O-1.** Changing feature-289 @AC-10 (`opportunity-compute-robustness.feature:108`) and @AC-13 (`readiness-caching-poll-discipline.feature:94`) needs C-16 operator sign-off, recorded here. The pinning tests at `services/xstockstrat-analysis/tests/test_unreadable_formula.py:671,691` are rewritten in the same PR.
- **Non-blocking objections still open.**
  - O-6: design.md must state the MEMORY_EXCEEDED classification. Synthesis recommends transient, at the cost of re-healing a deterministic memory hog every cycle.
  - O-7: a non-held `evaluation_failed` row keeps its act controls (`page.tsx:513-526`). Either gate it via `provenance.includes('evaluation_failed')` or record a C-14 follow-up.
  - O-8: record the indicators one-field change as an in-scope cross-service touch, with an indicators test.
- **Closed in round 2:** O-2 (by D-8/D-9), O-3 (by D-10), O-4 (narrowed into O-7), O-5.
- **Floor status:** no Floor breaches.
- **Uncovered @AC changes** (none is covered by an operator decision yet):
  - CHANGE: feature-289 @AC-10, feature-289 @AC-13, 308 @AC-2 (wording amended), 308 @AC-3 (outcome split by site)
  - EXTEND: feature-289 @AC-9 / @AC-26, feature-181 @AC-2
  - PRESERVE: feature-289 @AC-4 / feature-185 @AC-4, feature-185 @AC-1, @AC-9, @AC-8 / feature-289 @AC-21, 308 @AC-1
- **Path note:** the batch task named the feature dir as `docs/roadmap/features/docs/roadmap/features/308-…`, a doubled prefix. The real directory `docs/roadmap/features/308-fix-analysis-per-symbol-isolation/` was used.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis. D-1 to D-7 stand unchanged. Round 2 changes only how D-3's predicate is built: it now classifies on the typed `exit_reason` enum instead of English text. I checked each adversary claim against the code.\n\n1. Typed timeout classification (replaces the r2 text-prefix pin; stays inside D-3's scope)\n- Add `exit_reason: int = 0` to `FormulaExecutionError` (`services/xstockstrat-analysis/app/services/evaluator.py:113-118`).\n  - `_decode_formula_output` passes `resp.exit_reason` on both raises (`evaluator.py:140-145`).\n  - The `ValueError` decode path (`:145`) and the post-decode contract raises (`:553`, `:560`) carry the response's own value (SUCCESS) or 0. They therefore stay terminal.\n- `_is_transient_formula_error(exc)` is True for:\n  - `grpc.RpcError`\n  - a `FormulaExecutionError` whose `exit_reason == SANDBOX_EXIT_REASON_TIMEOUT` (`packages/proto/indicators/v1/indicators.proto:104`)\n- No proto change: field `exit_reason = 8` already exists (`indicators.proto:97`), and indicators already sets it (`services/xstockstrat-indicators/app/handlers/servicer.py:415-417`).\n- Dropped from the r2 proposal (C-18): the `_SANDBOX_TIMEOUT_PREFIX` constant, the PLAT-* entry, and the comment at indicators `sandbox.py:781`.\n\n2. Deadline-refusal producer, closing the R-2 hole\n- The indicators deadline refusal (`servicer.py:349-359`, \"request deadline leaves Nms …\") returns `success=False` with no `exit_reason` set, so the value is UNSPECIFIED. This failure is load-driven: the limiter queue uses up the deadline.\n- Fix: set `exit_reason=indicators_pb2.SANDBOX_EXIT_REASON_TIMEOUT` on that one response. This is a one-field indicators change.\n  - No runtime consumer branches on `exit_reason`. It is only displayed: agent `tools.py:1688` and analysis `fundamentals_scoring.py:64`.\n  - The only visible effect is that `test_formula` shows TIMEOUT instead of UNSPECIFIED for a refused run.\n  - Indicators telemetry (`record_sandbox_execution`) is never reached on that early return, so metrics do not change.\n- Analysis does not guess from \"UNSPECIFIED + success=False\". The adversary showed the sandbox `other` arm also maps to UNSPECIFIED (`servicer.py:381-382,416`), so that heuristic would over-heal.\n- Touched services: xstockstrat-analysis (code) and xstockstrat-indicators (one response field, plus a test asserting `exit_reason == TIMEOUT` on the refusal). Analysis CI now catches a regression through an analysis test that builds the error via `_decode_formula_output(SimpleNamespace(success=False, error=..., exit_reason=TIMEOUT))`. Hand-built messages are not allowed, because `str(e)` is `\"formula X failed: ...\"` (`evaluator.py:115`).\n\n3. MEMORY_EXCEEDED\n- Synthesis recommendation: classify `SANDBOX_EXIT_REASON_MEMORY_EXCEEDED` as transient (healable `unavailable`).\n- Reason: under the cgroup watchdog the OOM killer \"kills the largest child, which may be a legitimate concurrent formula\" (indicators CLAUDE.md § Memory watchdog). Making it terminal would recreate the R-2 harm, a row stale for about 24 h.\n- Cost: a formula that is always too memory-hungry gets re-healed each heal cycle, bounded by `sandbox.max_concurrent`.\n- The proposer must state this decision explicitly in design.md (open objection below).\n\n4. Readiness re-kick asymmetry (closes O-3)\n- Accepted as recorded in r2, with the bound corrected: k components × pairs `ExecuteFormula` spawns per 300 s cooldown, only while a client polls, capped by `sandbox.max_concurrent` and `_readiness_materializer_bars_sem` / `_bars_fetch_sem`.\n\n5. Spec and signal follow-through (closes O-5)\n- Spec @AC-2 and @AC-3 replacement text as in the r2 proposal.\n- Correct the lost-signal statement to: \"No alert covered `recompute{outcome=failed}`, `EvaluateReadiness` UNKNOWN, or the kick/materializer WARNs before or after this change. `alert-rules.yaml:127-147` is the live-loop heartbeat only, so the loss is log and metric visibility only.\"\n- The C-14 follow-up names its target series concretely: a counter `analysis.isolation.degraded{site}` (or `outcome=degraded` on the existing recompute counter, after checking the telemetry label allowlist test) plus a Loki/Prom alert on a sustained rate. A span attribute is not alertable.\n\n6. UI (O-4 narrowed, still open)\n- Verified: `_empty_readiness` yields `total_conditions: 0` (`evaluator.py:1162-1170`), and `readinessState` maps 0/0 to `'nodata'`, not `'quiet'` (`services/xstockstrat-ui/src/lib/readinessRollup.ts:27`).\n- New finding: the row header gates only `fundUnavailable`, `unreadable && !held` and `muted` (`services/xstockstrat-ui/src/app/insights/opportunities/page.tsx:513-526`). A non-held `evaluation_failed` row therefore falls through to `OPPORTUNITY_ACTION[UNSPECIFIED]` and keeps the act controls, where a `formula_unreadable` row gets a non-actionable cue.\n- Smallest fix consistent with D-4: in `page.tsx`, derive `evalFailed = o.provenance.includes('evaluation_failed')` and treat it like `unreadable` in the header/act gate. This needs no proto change. The alternative is a recorded C-14 follow-up. The proposer must choose and justify.\n\n7. O-1 (blocking, unchanged)\n- C-16 operator sign-off to CHANGE feature-289 @AC-10 (`opportunity-compute-robustness.feature:108`) and @AC-13 (`readiness-caching-poll-discipline.feature:94`), recorded in context.md, using the r2 replacement wording.\n- The pinning tests `test_opportunity_recompute_timeout_fails_and_keeps_stored_rows` and `test_evaluate_readiness_timeout_raises_not_converted_to_marker` (`services/xstockstrat-analysis/tests/test_unreadable_formula.py:671,691`) are rewritten in the same PR. This corrects recon's claim that no test pinned the contract.\n\nBuild order:\n1. `FormulaExecutionError.exit_reason` + predicate + the indicators refusal field + paired tests\n2. marker plumbing\n3. readiness callers\n4. `_compute_opportunities`\n5. heal\n6. UI gate, if chosen\n7. regression, `CancelledError` and CHANGE-characterization tests, the service CLAUDE.md sentence, and the three -1 invariant texts\n\nAll of this lands in one PR.",
    "open_objections": [
      {
        "text": "O-1 (unchanged): C-16 operator sign-off to CHANGE feature-289 @AC-10 and @AC-13 must be recorded in context.md. The pinning tests at tests/test_unreadable_formula.py:671,691 are rewritten in the same PR.",
        "blocking": true
      },
      {
        "text": "State the MEMORY_EXCEEDED classification explicitly in design.md. Synthesis recommends transient, because the cgroup OOM may kill a legitimate concurrent formula and terminal would recreate the R-2 harm. Record the cost: a deterministic memory hog is re-healed each cycle.",
        "blocking": false
      },
      {
        "text": "O-4 narrowed: a non-held evaluation_failed row falls through page.tsx:513-526 to OPPORTUNITY_ACTION[UNSPECIFIED] and keeps the act controls, unlike formula_unreadable. Either gate it in page.tsx via provenance.includes('evaluation_failed'), with no proto change, or record a C-14 follow-up with the user-facing risk stated.",
        "blocking": false
      },
      {
        "text": "The indicators deadline-refusal response (indicators servicer.py:349-359) setting exit_reason=TIMEOUT is a cross-service change inside an analysis bug fix. Record it in context.md as an in-scope touch, with an indicators test asserting the field.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-10 (feature-289, opportunity-compute-robustness.feature)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-13 (feature-289, readiness-caching-poll-discipline.feature)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 (feature-289) / feature-185 @AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-185 @AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-185 @AC-9",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-185 @AC-8 / feature-289 @AC-21",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-289 @AC-9 / @AC-26",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-181 @AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "308 @AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "308 @AC-2 (wording amended)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "308 @AC-3 (outcome split by site: kick/materializer cache -1 sentinel; heal skips cache write + WARN tally)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Matching on the timeout message prefix with paired literal tests, a PLAT note and an indicators comment (proposal r2). It rebuilds a closed enum out of English text (C-04 intent). Analysis CI cannot catch an indicators reword. As written it never matches, because str(e) is 'formula X failed: ...' (evaluator.py:115).",
      "Keeping the text match and adding the deadline-refusal literal as a second string. That gives two English strings coupling two services, and a reword on either side silently routes load faults to terminal (R-2 harm).",
      "In analysis, treating success=False with UNSPECIFIED exit_reason as transient. The sandbox 'other' arm also maps to UNSPECIFIED (indicators servicer.py:381-382,416), so this over-heals non-load faults.",
      "A terminal readiness verdict in readiness_json for deterministic faults. It adds a new verdict and classifier branch for no correctness gain; the bounded 300 s re-kick is accepted instead."
    ],
    "open_risks": [
      "Until the C-14 follow-up lands, a sustained per-symbol degraded rate is visible only in WARN logs and span attributes, and no alert covered these signals before or after the change.",
      "If MEMORY_EXCEEDED is classified transient, a formula that always runs out of memory is re-healed every heal cycle and costs sandbox spawns under sandbox.max_concurrent.",
      "The gather-level isolated(...) backstop can still drop a candidate on a row-assembly bug, deleting its stored row for one cycle.",
      "Overloading the -1 readiness sentinel may mislead future readers if any of the three invariant texts is missed.",
      "Adding exit_reason=TIMEOUT to the indicators deadline refusal changes what agent test_formula displays for a refused run (TIMEOUT instead of UNSPECIFIED)."
    ],
    "constitution_rules_touched": [
      "C-04",
      "C-11",
      "C-14",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "DRY guard rail (docs/patterns/dry-guard-rail.md)",
      "PLAT-N1"
    ],
    "rationale": "I checked the adversary's three blocking O-2 claims in the code, and all three hold:\n- ExecuteFormulaResponse already carries SandboxExitReason with TIMEOUT=2 (indicators.proto:97,104), and indicators sets it at servicer.py:415-417.\n- The deadline refusal at indicators servicer.py:349-359 returns success=False with no exit_reason. It is a second producer of a load-driven timeout, so the proposal's \"only producer\" assumption is false.\n- FormulaExecutionError builds str(e) as \"formula X failed: ...\" (evaluator.py:115), so a \"starts with\" check against the message would never match in production.\n\nCarrying the typed enum on the exception resolves all three with less code than the proposal. It also removes the cross-service text coupling, which closes O-2. Setting TIMEOUT on the refusal is the only way to classify that response without a text or UNSPECIFIED heuristic. It has no branching consumers (grep: display-only in agent tools.py:1688 and analysis fundamentals_scoring.py:64). This is an implementation detail inside D-3's settled intent (\"indicators timeout → healable\"), so no REOPEN is needed.\n\nO-3 closes with the corrected k×pairs bound. O-5 closes once the alert-coverage statement is corrected and the follow-up series is named. O-4 is not closed: page.tsx:513-526 shows that a non-held evaluation_failed row keeps the act controls, unlike formula_unreadable, so it is narrowed to a concrete choice. O-1 stays blocking and only the operator can resolve it.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "D-8: _is_transient_formula_error classifies on the typed SandboxExitReason enum carried on FormulaExecutionError.exit_reason (set from resp.exit_reason in _decode_formula_output), never on error text. Transient means RpcError or exit_reason == TIMEOUT.",
          "evidence": "indicators.proto:97,104; indicators servicer.py:415-417; analysis evaluator.py:115,140-145"
        },
        {
          "text": "D-9: The indicators deadline-refusal response sets exit_reason=SANDBOX_EXIT_REASON_TIMEOUT, so the load-driven refusal is classified as healable. Analysis does not infer transience from UNSPECIFIED.",
          "evidence": "indicators servicer.py:349-359 (no exit_reason), :381-382,416 ('other' also maps to UNSPECIFIED); exit_reason has display-only consumers (agent tools.py:1688, analysis fundamentals_scoring.py:64)"
        },
        {
          "text": "D-10: The readiness-side bar_epoch=-1 re-kick for deterministic faults is accepted, bounded at k components × pairs spawns per 300 s cooldown while polled, under the sandbox and bars semaphores. No terminal readiness verdict is added.",
          "evidence": "readiness.py:27; service CLAUDE.md _READINESS_UNKNOWN_RETRY_SECONDS; adversary r2 O-3 correction"
        }
      ],
      "new_rejected": [
        {
          "text": "R-6: Classifying formula timeouts by matching the error-message text (prefix constant, paired literal tests, PLAT note)",
          "why": "The proto already models the value set as an enum (C-04 intent); str(e) never starts with the sandbox text (evaluator.py:115); misses the deadline-refusal producer; analysis CI cannot catch an indicators reword"
        },
        {
          "text": "R-7: Treating success=False with UNSPECIFIED exit_reason as transient",
          "why": "The sandbox 'other' arm also maps to UNSPECIFIED (indicators servicer.py:381-382,416), so non-load faults would be over-healed"
        }
      ],
      "new_objections": [
        {
          "text": "O-6: State the MEMORY_EXCEEDED classification in design.md (synthesis recommends transient, because the cgroup OOM may kill a legitimate concurrent formula) and record the re-heal cost for a deterministic memory hog.",
          "blocking": false
        },
        {
          "text": "O-7: A non-held evaluation_failed row keeps the act controls and the UNSPECIFIED action badge (page.tsx:513-526), unlike formula_unreadable. Gate it via provenance.includes('evaluation_failed') or record a C-14 follow-up with the risk stated.",
          "blocking": false
        },
        {
          "text": "O-8: Record the one-field indicators change (exit_reason=TIMEOUT on the deadline refusal) as an in-scope cross-service touch in context.md, with an indicators test asserting it.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-2",
          "how": "The text coupling is removed: classification uses the typed exit_reason enum (D-8), and the deadline refusal is tagged TIMEOUT (D-9). An analysis-side test builds the error through _decode_formula_output."
        },
        {
          "id": "O-3",
          "how": "The asymmetry is accepted with a corrected bound (k components × pairs per 300 s while polled); recorded as D-10."
        },
        {
          "id": "O-5",
          "how": "Replacement text for spec @AC-2/@AC-3 supplied; the lost-signal statement is corrected to 'no alert covered these signals before or after'; the C-14 follow-up names a concrete alertable counter."
        },
        {
          "id": "O-4",
          "how": "0/0 → 'nodata' (not 'quiet') is verified at readinessRollup.ts:27 and evaluator.py:1162-1170. The remaining act-control gap is split out as O-7."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-batch design gate (round 3)

- `/sdd-design fix-analysis-per-symbol-isolation` (full debate, run by `/sdd-batch`) is at its approval gate after round 3. Gate policy: halt. design.md is not written and status.md is unchanged. The debate register is `debate.md` in this directory.

### Open Threads

- **Approach.** D-1 to D-10 stand, and round 3 adds D-11 to D-13.
  - Classification follows D-8. `FormulaExecutionError` gains `exit_reason`, which `_decode_formula_output` reads directly from `resp.exit_reason` (no `getattr` default; D-13). `_is_transient_formula_error` is True only for `grpc.RpcError` or `exit_reason == TIMEOUT`.
  - **MEMORY_EXCEEDED is terminal `evaluation_failed`.** The proposal's transient reading was corrected back to D-8 and rejected as R-8. Two of the three indicators producers are deterministic per formula (watchdog `sandbox.py:763-773,799-800`; RLIMIT marker `:810-811`). Only `-SIGKILL` plus a rise in oom_kill (`:812-813`) can hit a bystander. Stated cost: a rare cgroup-OOM bystander row stays stale until the next recompute.
  - **In-scope cross-service touch (D-9).** The indicators deadline refusal (`servicer.py:352-359`) sets `exit_reason=SANDBOX_EXIT_REASON_TIMEOUT`, and an indicators test asserts it. Its consumers only display the field (agent `tools.py:1688`, analysis `fundamentals_scoring.py:64`). Metrics do not change, because the early return comes before `record_sandbox_execution` (`:383`).
  - **UI (D-12).** `readinessCue.ts` exports `EVALUATION_FAILED_PROVENANCE` and `EVALUATION_FAILED_CUE`. The desktop opportunities page gates the header, the readiness slot (`opportunity-evaluation-failed-<sym>`) and the act row on non-held `evaluation_failed` rows, and a Playwright assertion pins it.
  - The isolation sites are unchanged: EvaluateReadiness, the kick, the materializer, `_compute_opportunities`/`_row_for`, and the heal. All use the shared `app/services/isolation.py`, with `except Exception` so `CancelledError` passes through.
  - Build order, one PR: exception field, predicate and indicators field; marker plumbing; readiness callers; `_compute_opportunities`; heal; UI; then the tests, docs and invariant texts.
- **Strongest open objection (blocking): O-1.** Changing feature-289 @AC-10 (`opportunity-compute-robustness.feature:108`) and @AC-13 (`readiness-caching-poll-discipline.feature:94`) needs C-16 operator sign-off, recorded here. The rewrites at `tests/test_unreadable_formula.py:671,691` must not land before that sign-off.
  - If the operator declines, D-11 applies: the TIMEOUT re-raise (`_is_formula_timeout`) happens only in `_row_for` and `_readiness_for`. The kick, materializer and heal still isolate, so report 3's batch loss stays fixed (R-9).
- **Non-blocking objections still open.**
  - O-9: show the `evaluation_failed` cue on the mobile `SignalRow` (`SectionRenderer.tsx:248-256`) and the Signal-detail header (`trader/positions/[symbol]/page.tsx:1014-1020`), or record a named C-14 follow-up with the risk stated.
  - O-10: find the analysis test doubles by grep, including `_formula_stub` at `tests/test_strategy_evaluator.py:521/:581`. Regression tests must assert that the classifier received a `FormulaExecutionError` carrying `exit_reason`.
- **Closed in round 3:**
  - O-6: MEMORY_EXCEEDED stated as terminal, with its cost.
  - O-7: desktop act gate and cue (D-12).
  - O-8: indicators touch recorded above, with a test.
- **Floor status:** no Floor breaches.
- **Uncovered @AC changes** (none is covered by an operator decision yet):
  - CHANGE: feature-289 @AC-10, feature-289 @AC-13, 308 @AC-2 (wording amended), 308 @AC-3 (outcome split by site)
  - EXTEND: feature-289 @AC-9 / @AC-26, feature-181 @AC-2
  - PRESERVE: feature-289 @AC-4 / feature-185 @AC-4, feature-185 @AC-1, @AC-9, @AC-8 / feature-289 @AC-21, 308 @AC-1
- **Path note:** the batch task again named the feature dir with the doubled prefix `docs/roadmap/features/docs/roadmap/features/308-…`. The real directory `docs/roadmap/features/308-fix-analysis-per-symbol-isolation/` was used.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 synthesis. D-1 to D-10 stand. Where the proposal contradicts D-8, the approach below is corrected to honor D-8. That correction is not a new decision.\n\n1. Typed classification (D-8/D-9, implementation detail)\n- `FormulaExecutionError.__init__` (services/xstockstrat-analysis/app/services/evaluator.py:114) gains `exit_reason: int = 0`.\n- `_decode_formula_output` passes `resp.exit_reason` directly on the `not resp.success` raise (evaluator.py:141). There is no `getattr` fallback.\n- `_is_transient_formula_error(exc)` is True only for:\n  - `grpc.RpcError`\n  - a `FormulaExecutionError` whose `exit_reason == SANDBOX_EXIT_REASON_TIMEOUT` (indicators.proto:104)\n- **MEMORY_EXCEEDED is terminal `evaluation_failed`, as D-8 says.** design.md states this explicitly, together with the indicators evidence I verified:\n  - (a) the watchdog kill, `killed_for_memory` (indicators sandbox.py:763-773, 799-800), measures the formula's own process group;\n  - (b) the `_MEMORY_EXHAUSTED_MARKERS` arm (:810-811) fires under the formula's own RLIMIT;\n  - (c) only `-SIGKILL` plus a rise in `_oom_kill_rose` (:812-813) can hit a bystander, and `oom_score_adj=1000` usually picks the hog itself.\n- Stated cost: a rare cgroup-OOM bystander row stays `evaluation_failed` until the next recompute. It does not heal. This cost is visible and bounded, and it avoids two harms: perpetual heal churn on a known memory hog, and the R-3 data-outage misdiagnosis.\n- Everything else is terminal: UNSPECIFIED, RUNTIME_ERROR, IMPORT_BLOCKED, MEMORY_EXCEEDED, the decode `ValueError` (:145), and the contract raises (:553, :560).\n- **Test doubles.** The spec step lists them by grep, not by count:\n  - every `SimpleNamespace(success=` construction and helper under services/xstockstrat-analysis/tests;\n  - this includes `_formula_stub` (tests/test_strategy_evaluator.py:521, called with `success=False` at :581), which the proposal's 9-count missed.\n  - Each double gains `exit_reason`.\n  - Regression tests assert that the predicate received a `FormulaExecutionError` carrying the expected `exit_reason`. This stops an `AttributeError` from a double, swallowed by the per-symbol `except Exception`, from passing as `evaluation_failed`.\n\n2. Indicators touch (O-8, D-9)\n- In services/xstockstrat-indicators/app/handlers/servicer.py:352-359, the deadline-refusal response sets `exit_reason=indicators_pb2.SANDBOX_EXIT_REASON_TIMEOUT`.\n- An indicators test asserts the field on the refused path.\n- context.md records it as an \"in-scope cross-service touch (D-9)\":\n  - consumers only display it (agent tools.py:1688, analysis fundamentals_scoring.py:64);\n  - indicators metrics do not change, because the early return comes before `record_sandbox_execution` (:383).\n\n3. UI (O-7 closed; cue parity carried as O-9)\n- Add to services/xstockstrat-ui/src/lib/readinessCue.ts, next to `IN_QUEUE_CUE` (:24):\n  - `export const EVALUATION_FAILED_PROVENANCE = 'evaluation_failed'`, the single TS copy of the wire token (C-18);\n  - `EVALUATION_FAILED_CUE: EnumRender`.\n- In services/xstockstrat-ui/src/app/insights/opportunities/page.tsx:\n  - derive `evalFailed = o.provenance.includes(EVALUATION_FAILED_PROVENANCE)` beside `held`/`unreadable` (:507-508);\n  - header (:518): render the cue when `evalFailed && !held`;\n  - readiness slot (:567-575): add an `evalFailed` arm with `data-testid=opportunity-evaluation-failed-<sym>`, parallel to the unreadable arm. The row then no longer falls through to `—` / 0-of-0;\n  - act gate (:659): `fundUnavailable || ((unreadable || evalFailed) && !held)`.\n- One Playwright assertion: a non-held `evaluation_failed` row has no act controls, and it shows the cue test id.\n- Mobile `SignalRow` (SectionRenderer.tsx:248-256) and the Signal-detail header (trader/positions/[symbol]/page.tsx:1014-1020) still show only `—` / the action badge. The proposer must either:\n  - render `EVALUATION_FAILED_CUE` there, through a `SignalItem` field plumbed via sections.ts, using the shared constant; or\n  - record a named C-14 follow-up feature with the risk stated (a display-only misread; there are no act controls on mobile, and the detail page's OrderForm is always present by design).\n\n4. Isolation sites\nThe isolation sites are unchanged from D-1, D-5, D-6 and D-7:\n- `EvaluateReadiness`\n- the kick (servicer.py:4312)\n- the materializer (:6167)\n- `_compute_opportunities` / `_row_for` (:5758-5835)\n- the heal (:5152-5164)\n\nAll sites use the shared `app/services/isolation.py`, and `except Exception` lets `CancelledError` through.\n\n5. O-1 (blocking, operator only)\n- **Default (CHANGE):** a timeout isolates to `unavailable` / readiness `-1`.\n  - `tests/test_unreadable_formula.py:671,691` are rewritten as the proposal describes.\n  - Feature-289 @AC-10 (opportunity-compute-robustness.feature:108) and @AC-13 (readiness-caching-poll-discipline.feature:94) are amended in the same PR.\n  - This happens only after the sign-off is recorded in context.md. The pre-written rewrites must not land first.\n- **Fallback if the operator declines:**\n  - The re-raise of a `FormulaExecutionError` with `exit_reason == TIMEOUT` (one predicate, `_is_formula_timeout`) applies **only in `_row_for` and `_readiness_for`**, the two sites @AC-10 and @AC-13 pin.\n  - The kick, materializer and heal isolate to `-1` / `unavailable` on every branch, so report 3's batch loss stays fixed.\n  - MEMORY_EXCEEDED is terminal and isolated in both branches.\n  - Spec @AC-1 and @AC-2 pass either way.\n\nBuild order, one PR:\n1. Exception field, predicate, indicators refusal field, paired tests.\n2. Marker plumbing (`_PROVENANCE_STRUCTURAL_MARKERS`, floor exemption).\n3. Readiness callers.\n4. `_compute_opportunities`.\n5. Heal.\n6. UI: constant, cue, desktop gates, e2e.\n7. Grep-enumerated double updates, regression tests, mutation-verified `CancelledError` tests, CHANGE-characterization rewrites (only after sign-off), the service CLAUDE.md \"FormulaExecutionError still propagates\" sentence, the three -1 invariant texts, and the named C-14 degraded-rate counter follow-up (`fails.md:3229-3232`).",
    "open_objections": [
      {
        "text": "O-1 (unchanged): the C-16 operator sign-off to CHANGE feature-289 @AC-10 and @AC-13 must be recorded in context.md before the rewrites at tests/test_unreadable_formula.py:671,691 land. If the operator declines, the narrowed fallback applies: the TIMEOUT re-raise happens only in _row_for and _readiness_for.",
        "blocking": true
      },
      {
        "text": "O-9: Cue parity for evaluation_failed outside the desktop act row. The mobile SignalRow (SectionRenderer.tsx:248-256) and the Signal-detail header (trader/positions/[symbol]/page.tsx:1014-1020) render a bare '—' or the action badge, where feature-289 renders the unreadable cue on all three surfaces (C-10, C-17). The fix is one of two: render EVALUATION_FAILED_CUE through a SignalItem field plumbed via sections.ts using the shared EVALUATION_FAILED_PROVENANCE constant, or record a named C-14 follow-up feature with the risk stated.",
        "blocking": false
      },
      {
        "text": "O-10: Enumerate the analysis test doubles by grep (every SimpleNamespace(success= construction and helper, including _formula_stub at tests/test_strategy_evaluator.py:521/:581), not by count. Regression tests must assert that the classifier received a FormulaExecutionError carrying exit_reason, so an AttributeError swallowed by the per-symbol except Exception cannot pass as evaluation_failed.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-10 (feature-289, opportunity-compute-robustness.feature)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-13 (feature-289, readiness-caching-poll-discipline.feature)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 (feature-289) / feature-185 @AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-185 @AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-185 @AC-9",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-185 @AC-8 / feature-289 @AC-21",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-289 @AC-9 / @AC-26",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-181 @AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "308 @AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "308 @AC-2 (wording amended)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "308 @AC-3 (outcome split by site: kick/materializer cache -1 sentinel; heal skips cache write + WARN tally)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Treating MEMORY_EXCEEDED as transient (proposal r3). It widens settled D-8 without a REOPEN. Two of the three indicators producers are deterministic per formula: the watchdog kill (sandbox.py:763-773, 799-800) and the RLIMIT/OpenBLAS marker (:810-811). Making them transient sends a known memory hog into a perpetual heal near the memory cap and shows a data-outage cue for a formula defect (the R-3 harm).",
      "Re-raising a TIMEOUT FormulaExecutionError at all five isolation sites in the declined-sign-off fallback. @AC-10/@AC-13 pin only _row_for and _readiness_for. Re-raising in the kick (servicer.py:4312), the materializer (:6167) and the heal (:5152) brings back report 3's whole-batch loss, and with D-9 a load spike would trigger it.",
      "An additive SANDBOX_EXIT_REASON_OOM_KILLED enum used only on the cgroup-bystander path (sandbox.py:812-813). It is precise for both populations, but it is a proto change (C-09 gates, codegen) and a second cross-service touch inside a bug fix. It belongs with the operator as a follow-up, not slipped in here.",
      "Reading resp.exit_reason through getattr with a default so the existing test doubles keep passing. That bends production code around test doubles, and the proto field always exists (indicators.proto:97).",
      "Gating only the desktop header badge and act row while leaving the readiness slot to fall through to '—'/0-of-0. The row would then read as 'no data' beside the cue, and the claimed parity with feature-289 would not hold (page.tsx:567-575).",
      "Inline 'evaluation_failed' string literals at each TS site. They duplicate the Python-owned wire token in several places (DRY guard rail); one exported constant in readinessCue.ts replaces them."
    ],
    "open_risks": [
      "A cgroup-OOM bystander, the only non-deterministic MEMORY_EXCEEDED path, stays evaluation_failed (stale) until the next recompute. This is bounded and visible, not silent.",
      "Until the named C-14 counter follow-up lands, a sustained per-symbol degraded rate shows up only in WARN logs and span attributes. No alert covered these signals before or after the change.",
      "If O-1 is declined, a load-driven timeout still aborts the owner's opportunity compute and EvaluateReadiness. Only the kick, materializer and heal stay isolated.",
      "The gather-level isolated(...) backstop can still drop a candidate on a row-assembly bug, deleting its stored row for one cycle.",
      "Overloading the -1 readiness sentinel may mislead future readers if any of the three invariant texts is missed.",
      "Agent test_formula will display TIMEOUT instead of UNSPECIFIED for a deadline-refused run.",
      "Until O-9 is resolved, mobile and Signal-detail show evaluation_failed rows as '—' or the UNSPECIFIED badge. This is display-only; there are no act controls on mobile."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-04",
      "C-09",
      "C-10",
      "C-11",
      "C-14",
      "C-16",
      "C-17",
      "C-18",
      "P-02",
      "P-03",
      "DRY guard rail (docs/patterns/dry-guard-rail.md)",
      "PLAT-N1"
    ],
    "rationale": "I checked the adversary's r3 claims in the code, and all of them hold.\n\nMEMORY_EXCEEDED\n- indicators sandbox.py emits memory_exceeded from three arms:\n  - the watchdog `killed_for_memory` (:763-773 and :799-800);\n  - `_MEMORY_EXHAUSTED_MARKERS` in stderr (:810-811);\n  - `-SIGKILL` plus `_oom_kill_rose` (:812-813).\n- Only the last arm can hit a bystander. So the proposal's premise, \"a load victim and a real hog look the same\", is false for the common paths.\n- The transient classification also contradicts settled D-8 (\"Transient means RpcError or exit_reason == TIMEOUT\"), and nobody filed a REOPEN.\n- Under the register guardrail the approach is corrected back to D-8. O-6 only asked for the classification to be stated, and that is now done with the stated cost, so O-6 closes.\n\nTest doubles\n- tests/test_strategy_evaluator.py:521 `_formula_stub` builds `SimpleNamespace(success, output, error)` with no exit_reason and is called with success=False at :581. The proposal's inventory was incomplete, and a double failing inside the new catch would fail silently. Opened as O-10.\n\nUI\n- SectionRenderer.tsx:248-256 and positions/[symbol]/page.tsx:1014-1020 render the feature-289 unreadable cue, so the claim of no precedent gap does not hold.\n- The act-control risk that O-7 named is concretely answered by the desktop gate at page.tsx:659 plus the header cue, so O-7 closes.\n- Parity for the readiness slot, mobile and detail, and the shared TS constant, carry forward as O-9. The readiness slot is folded into the approach.\n\nFallback\n- The adversary is right that @AC-10/@AC-13 pin only the owner compute and EvaluateReadiness. Re-raising in the kick, materializer and heal would recreate report 3, so the fallback is narrowed and recorded as D-11.\n\nO-8\n- O-8 is concretely answered (context.md entry plus an indicators refusal test) and closes.\n\nO-1\n- O-1 stays blocking and only the operator can close it.\n\nNo reopen petitions were filed by either side.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "D-11: If the operator declines O-1, the timeout re-raise (FormulaExecutionError with exit_reason == TIMEOUT, one predicate _is_formula_timeout) applies only in _row_for and _readiness_for, the sites pinned by feature-289 @AC-10/@AC-13. The kick, materializer and heal isolate to -1/unavailable on every branch.",
          "evidence": "feature-289 @AC-10 (opportunity-compute-robustness.feature:108), @AC-13 (readiness-caching-poll-discipline.feature:94); kick servicer.py:4312, materializer :6167, heal :5152 are unpinned; report 2026-11-05 batch-loss defect"
        },
        {
          "text": "D-12: The UI gates evaluation_failed through one exported TS constant EVALUATION_FAILED_PROVENANCE and an EVALUATION_FAILED_CUE EnumRender in src/lib/readinessCue.ts. The desktop opportunities page uses it in the header, the readiness slot (opportunity-evaluation-failed-<sym>) and the act gate ((unreadable || evalFailed) && !held). A Playwright assertion pins the missing act controls.",
          "evidence": "page.tsx:507-508,518,567-575,659; readinessCue.ts:1-4,24 (non-state cue precedent IN_QUEUE_CUE); DRY guard rail"
        },
        {
          "text": "D-13: _decode_formula_output reads resp.exit_reason directly with no getattr default. The analysis test doubles are enumerated by grep (every SimpleNamespace(success= construction and helper), not by count.",
          "evidence": "indicators.proto:97 (field always present); evaluator.py:141; tests/test_strategy_evaluator.py:521,581 (_formula_stub, missed by the r3 count)"
        }
      ],
      "new_rejected": [
        {
          "text": "R-8: Classifying SANDBOX_EXIT_REASON_MEMORY_EXCEEDED as transient (healable unavailable)",
          "why": "Contradicts settled D-8. Two of the three indicators producers are deterministic per formula (watchdog sandbox.py:763-773,799-800; RLIMIT marker :810-811); only -SIGKILL plus oom_kill rose (:812-813) can hit a bystander, and oom_score_adj=1000 usually picks the hog. The result would be perpetual heal churn and the R-3 data-outage misdiagnosis."
        },
        {
          "text": "R-9: Re-raising the timeout at all five isolation sites in the declined-sign-off fallback",
          "why": "Only _row_for and _readiness_for are pinned by @AC-10/@AC-13. Re-raising in the kick, materializer or heal recreates report 3's whole-batch loss, and with D-9 a load spike triggers it."
        },
        {
          "text": "R-10: Adding SANDBOX_EXIT_REASON_OOM_KILLED (proto change) inside this bug fix",
          "why": "A proto change (C-09 gates, codegen) and a second cross-service touch inside a SEV-2 fix. If wanted, it goes to the operator as a separate follow-up."
        }
      ],
      "new_objections": [
        {
          "text": "O-9: Cue parity for evaluation_failed outside the desktop act row. The mobile SignalRow (SectionRenderer.tsx:248-256) and the Signal-detail header (trader/positions/[symbol]/page.tsx:1014-1020) show '—' or the action badge, while feature-289 renders the unreadable cue on all three surfaces (C-10/C-17). Either render EVALUATION_FAILED_CUE through a SignalItem field plumbed via sections.ts with the shared constant, or record a named C-14 follow-up feature with the risk stated.",
          "blocking": false
        },
        {
          "text": "O-10: Analysis test doubles must be enumerated by grep (including _formula_stub at tests/test_strategy_evaluator.py:521/:581). Regression tests must assert that the classifier received a FormulaExecutionError carrying exit_reason, so a swallowed AttributeError from a double cannot pass as evaluation_failed.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-6",
          "how": "The classification is stated: MEMORY_EXCEEDED is terminal evaluation_failed per settled D-8. The proposal's transient reading was corrected to honor the register, with the evidence verified at indicators sandbox.py:763-773, 799-800, 810-813. Stated cost: a rare cgroup-OOM bystander stays stale until the next recompute. There is no heal churn for deterministic hogs."
        },
        {
          "id": "O-7",
          "how": "The act controls and the UNSPECIFIED badge are gated for non-held evaluation_failed rows on the desktop page (page.tsx:518 header cue, :659 act gate) through the shared constant and cue (D-12), and a Playwright assertion pins it. Remaining parity on mobile and detail is split out as O-9."
        },
        {
          "id": "O-8",
          "how": "The proposal records the indicators deadline-refusal exit_reason=TIMEOUT (servicer.py:352-359) in context.md as an in-scope D-9 cross-service touch, with display-only consumers and no metrics change (the early return precedes :383), plus an indicators test asserting the field on the refused path."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
