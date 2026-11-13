# Debate Register: fix-analysis-per-symbol-isolation

**State**: in-debate
**Mode**: full
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 7 | 5 | 0 | 5 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 3 | 2 | 4 | 3 | 0 | yes |
| 3 | 2026-11-13 | /sdd-batch | 3 | 3 | 3 | 2 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | D-1: Isolate per-symbol units at the caller (EvaluateReadiness, kick, materializer, _compute_opportunities, heal), never inside compute_readiness_row; catch `except Exception` only so CancelledError passes through. | servicer.py:4046-4064 loaders raise before compute_readiness_row; 308 @AC-2 patches compute_readiness_row; screener.py:234-240 precedent | settled |
| D-2 | 1 | D-2: A degraded readiness row reuses the existing bar_epoch=-1 sentinel and is cached, giving UNKNOWN with the 300 s cooldown and never served from FAST. | readiness.py:27 (bar_epoch >= latest_bar_epoch), readiness.py:92-106; feature-181 @AC-2 | settled |
| D-3 | 1 | D-3: Classify opportunity faults with one predicate, `_is_transient_formula_error` in evaluator.py. RpcError and indicators timeout → healable 'unavailable'; any other Exception → terminal structural 'evaluation_failed'. | indicators sandbox.py:781 timeout text; heal selector keyed on 'unavailable' servicer.py:4987; adversary O2 | settled |
| D-4 | 1 | D-4: data_unavailable on the wire stays derived from 'unavailable' only; 'evaluation_failed' is exposed via provenance only (no proto change). | servicer.py:6900; agent tools.py:1736 contract; UI provenance chips page.tsx:82 | settled |
| D-5 | 1 | D-5: Marker precedence: unavailable (bars failed / fund_unknown / eval_outage) > evaluation_failed > clean; formula_unreadable exclusive of both; fetch_failed reverts to bars-only and the outage flag is row-local. | servicer.py:5834,5877-5886; insights.md:3909-3912; adversary O5 | settled |
| D-6 | 1 | D-6: The per-symbol try spans the loaders, assess and the eval in both _row_for (servicer.py:5758-5835) and the heal (:5152-5164); the gather-level isolation is a count-and-log backstop only. | servicer.py:5758-5808 loaders outside current try; feature 131 held-row guarantee; feature-185 @AC-1 | settled |
| D-7 | 1 | D-7: One shared helper module app/services/isolation.py (isolated + log_isolation_tally), adopted by the screener too. | screener.py:150-161,234-240; docs/patterns/dry-guard-rail.md | settled |
| D-8 | 2 | D-8: _is_transient_formula_error classifies on the typed SandboxExitReason enum carried on FormulaExecutionError.exit_reason (set from resp.exit_reason in _decode_formula_output), never on error text. Transient means RpcError or exit_reason == TIMEOUT. | indicators.proto:97,104; indicators servicer.py:415-417; analysis evaluator.py:115,140-145 | settled |
| D-9 | 2 | D-9: The indicators deadline-refusal response sets exit_reason=SANDBOX_EXIT_REASON_TIMEOUT, so the load-driven refusal is classified as healable. Analysis does not infer transience from UNSPECIFIED. | indicators servicer.py:349-359 (no exit_reason), :381-382,416 ('other' also maps to UNSPECIFIED); exit_reason has display-only consumers (agent tools.py:1688, analysis fundamentals_scoring.py:64) | settled |
| D-10 | 2 | D-10: The readiness-side bar_epoch=-1 re-kick for deterministic faults is accepted, bounded at k components × pairs spawns per 300 s cooldown while polled, under the sandbox and bars semaphores. No terminal readiness verdict is added. | readiness.py:27; service CLAUDE.md _READINESS_UNKNOWN_RETRY_SECONDS; adversary r2 O-3 correction | settled |
| D-11 | 3 | D-11: If the operator declines O-1, the timeout re-raise (FormulaExecutionError with exit_reason == TIMEOUT, one predicate _is_formula_timeout) applies only in _row_for and _readiness_for, the sites pinned by feature-289 @AC-10/@AC-13. The kick, materializer and heal isolate to -1/unavailable on every branch. | feature-289 @AC-10 (opportunity-compute-robustness.feature:108), @AC-13 (readiness-caching-poll-discipline.feature:94); kick servicer.py:4312, materializer :6167, heal :5152 are unpinned; report 2026-11-05 batch-loss defect | settled |
| D-12 | 3 | D-12: The UI gates evaluation_failed through one exported TS constant EVALUATION_FAILED_PROVENANCE and an EVALUATION_FAILED_CUE EnumRender in src/lib/readinessCue.ts. The desktop opportunities page uses it in the header, the readiness slot (opportunity-evaluation-failed-<sym>) and the act gate ((unreadable // evalFailed) && !held). A Playwright assertion pins the missing act controls. | page.tsx:507-508,518,567-575,659; readinessCue.ts:1-4,24 (non-state cue precedent IN_QUEUE_CUE); DRY guard rail | settled |
| D-13 | 3 | D-13: _decode_formula_output reads resp.exit_reason directly with no getattr default. The analysis test doubles are enumerated by grep (every SimpleNamespace(success= construction and helper), not by count. | indicators.proto:97 (field always present); evaluator.py:141; tests/test_strategy_evaluator.py:521,581 (_formula_stub, missed by the r3 count) | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | R-1: Seam catch inside compute_readiness_row | Misses the pre-compute loaders (servicer.py:4046-4064); spec @AC-2 patches the function itself | locked |
| R-2 | 1 | R-2: Routing every FormulaExecutionError (including timeouts) to terminal evaluation_failed | A load-driven timeout goes stale for about 24 h because the heal is keyed on 'unavailable' | locked |
| R-3 | 1 | R-3: Showing evaluation_failed as data_unavailable=True | Misdiagnoses a formula fault as a data outage (agent tools.py:1736, UI outage cue) | locked |
| R-4 | 1 | R-4: Dropping a candidate whose failure happens outside the eval as the primary path | replace_for_user deletes held/watchlist/muted rows; breaks feature 131 and feature-185 @AC-1 | locked |
| R-5 | 1 | R-5: Per-site copies of the screener isolation wrapper and tally logger | DRY guard rail violation (seven near-identical blocks) | locked |
| R-6 | 2 | R-6: Classifying formula timeouts by matching the error-message text (prefix constant, paired literal tests, PLAT note) | The proto already models the value set as an enum (C-04 intent); str(e) never starts with the sandbox text (evaluator.py:115); misses the deadline-refusal producer; analysis CI cannot catch an indicators reword | locked |
| R-7 | 2 | R-7: Treating success=False with UNSPECIFIED exit_reason as transient | The sandbox 'other' arm also maps to UNSPECIFIED (indicators servicer.py:381-382,416), so non-load faults would be over-healed | locked |
| R-8 | 3 | R-8: Classifying SANDBOX_EXIT_REASON_MEMORY_EXCEEDED as transient (healable unavailable) | Contradicts settled D-8. Two of the three indicators producers are deterministic per formula (watchdog sandbox.py:763-773,799-800; RLIMIT marker :810-811); only -SIGKILL plus oom_kill rose (:812-813) can hit a bystander, and oom_score_adj=1000 usually picks the hog. The result would be perpetual heal churn and the R-3 data-outage misdiagnosis. | locked |
| R-9 | 3 | R-9: Re-raising the timeout at all five isolation sites in the declined-sign-off fallback | Only _row_for and _readiness_for are pinned by @AC-10/@AC-13. Re-raising in the kick, materializer or heal recreates report 3's whole-batch loss, and with D-9 a load spike triggers it. | locked |
| R-10 | 3 | R-10: Adding SANDBOX_EXIT_REASON_OOM_KILLED (proto change) inside this bug fix | A proto change (C-09 gates, codegen) and a second cross-service touch inside a SEV-2 fix. If wanted, it goes to the operator as a separate follow-up. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | O-1: C-16 operator sign-off required to CHANGE feature-289 @AC-10 and @AC-13, recorded in context.md. | yes | open |
| O-2 | 1 | O-2: The timeout predicate couples to the indicators error text; pin it with a contract test or a PLAT-* note. | no | closed @ round 2 (The text coupling is removed: classification uses the typed exit_reason enum (D-8), and the deadline refusal is tagged TIMEOUT (D-9). An analysis-side test builds the error through _decode_formula_output.) |
| O-3 | 1 | O-3: State and justify the readiness-side 300 s perpetual re-kick for deterministic faults versus the opportunity-side terminal marker. | no | closed @ round 2 (The asymmetry is accepted with a corrected bound (k components × pairs per 300 s while polled); recorded as D-10.) |
| O-4 | 1 | O-4: Confirm the evaluation_failed row's UI rendering (0-conviction + raw provenance chip) is not read as an evaluated 0/N. | no | closed @ round 2 (0/0 → 'nodata' (not 'quiet') is verified at readinessRollup.ts:27 and evaluator.py:1162-1170. The remaining act-control gap is split out as O-7.) |
| O-5 | 1 | O-5: Amend spec @AC-2 wording (proto has no unavailable field) and reconcile @AC-3's 'degraded with a diagnostic' with the heal's skip-only cache write; record the lost signals and file a C-14 follow-up for a degraded-rate alert. | no | closed @ round 2 (Replacement text for spec @AC-2/@AC-3 supplied; the lost-signal statement is corrected to 'no alert covered these signals before or after'; the C-14 follow-up names a concrete alertable counter.) |
| O-6 | 2 | O-6: State the MEMORY_EXCEEDED classification in design.md (synthesis recommends transient, because the cgroup OOM may kill a legitimate concurrent formula) and record the re-heal cost for a deterministic memory hog. | no | closed @ round 3 (The classification is stated: MEMORY_EXCEEDED is terminal evaluation_failed per settled D-8. The proposal's transient reading was corrected to honor the register, with the evidence verified at indicators sandbox.py:763-773, 799-800, 810-813. Stated cost: a rare cgroup-OOM bystander stays stale until the next recompute. There is no heal churn for deterministic hogs.) |
| O-7 | 2 | O-7: A non-held evaluation_failed row keeps the act controls and the UNSPECIFIED action badge (page.tsx:513-526), unlike formula_unreadable. Gate it via provenance.includes('evaluation_failed') or record a C-14 follow-up with the risk stated. | no | closed @ round 3 (The act controls and the UNSPECIFIED badge are gated for non-held evaluation_failed rows on the desktop page (page.tsx:518 header cue, :659 act gate) through the shared constant and cue (D-12), and a Playwright assertion pins it. Remaining parity on mobile and detail is split out as O-9.) |
| O-8 | 2 | O-8: Record the one-field indicators change (exit_reason=TIMEOUT on the deadline refusal) as an in-scope cross-service touch in context.md, with an indicators test asserting it. | no | closed @ round 3 (The proposal records the indicators deadline-refusal exit_reason=TIMEOUT (servicer.py:352-359) in context.md as an in-scope D-9 cross-service touch, with display-only consumers and no metrics change (the early return precedes :383), plus an indicators test asserting the field on the refused path.) |
| O-9 | 3 | O-9: Cue parity for evaluation_failed outside the desktop act row. The mobile SignalRow (SectionRenderer.tsx:248-256) and the Signal-detail header (trader/positions/[symbol]/page.tsx:1014-1020) show '—' or the action badge, while feature-289 renders the unreadable cue on all three surfaces (C-10/C-17). Either render EVALUATION_FAILED_CUE through a SignalItem field plumbed via sections.ts with the shared constant, or record a named C-14 follow-up feature with the risk stated. | no | open |
| O-10 | 3 | O-10: Analysis test doubles must be enumerated by grep (including _formula_stub at tests/test_strategy_evaluator.py:521/:581). Regression tests must assert that the classifier received a FormulaExecutionError carrying exit_reason, so a swallowed AttributeError from a double cannot pass as evaluation_failed. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
