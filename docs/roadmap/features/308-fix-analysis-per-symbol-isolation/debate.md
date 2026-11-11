# Debate Register: fix-analysis-per-symbol-isolation

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 7 | 5 | 0 | 5 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 3 | 2 | 4 | 3 | 0 | yes |

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

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | O-1: C-16 operator sign-off required to CHANGE feature-289 @AC-10 and @AC-13, recorded in context.md. | yes | open |
| O-2 | 1 | O-2: The timeout predicate couples to the indicators error text; pin it with a contract test or a PLAT-* note. | no | closed @ round 2 (The text coupling is removed: classification uses the typed exit_reason enum (D-8), and the deadline refusal is tagged TIMEOUT (D-9). An analysis-side test builds the error through _decode_formula_output.) |
| O-3 | 1 | O-3: State and justify the readiness-side 300 s perpetual re-kick for deterministic faults versus the opportunity-side terminal marker. | no | closed @ round 2 (The asymmetry is accepted with a corrected bound (k components × pairs per 300 s while polled); recorded as D-10.) |
| O-4 | 1 | O-4: Confirm the evaluation_failed row's UI rendering (0-conviction + raw provenance chip) is not read as an evaluated 0/N. | no | closed @ round 2 (0/0 → 'nodata' (not 'quiet') is verified at readinessRollup.ts:27 and evaluator.py:1162-1170. The remaining act-control gap is split out as O-7.) |
| O-5 | 1 | O-5: Amend spec @AC-2 wording (proto has no unavailable field) and reconcile @AC-3's 'degraded with a diagnostic' with the heal's skip-only cache write; record the lost signals and file a C-14 follow-up for a degraded-rate alert. | no | closed @ round 2 (Replacement text for spec @AC-2/@AC-3 supplied; the lost-signal statement is corrected to 'no alert covered these signals before or after'; the C-14 follow-up names a concrete alertable counter.) |
| O-6 | 2 | O-6: State the MEMORY_EXCEEDED classification in design.md (synthesis recommends transient, because the cgroup OOM may kill a legitimate concurrent formula) and record the re-heal cost for a deterministic memory hog. | no | open |
| O-7 | 2 | O-7: A non-held evaluation_failed row keeps the act controls and the UNSPECIFIED action badge (page.tsx:513-526), unlike formula_unreadable. Gate it via provenance.includes('evaluation_failed') or record a C-14 follow-up with the risk stated. | no | open |
| O-8 | 2 | O-8: Record the one-field indicators change (exit_reason=TIMEOUT on the deadline refusal) as an in-scope cross-service touch in context.md, with an indicators test asserting it. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
