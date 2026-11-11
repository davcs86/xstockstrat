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
