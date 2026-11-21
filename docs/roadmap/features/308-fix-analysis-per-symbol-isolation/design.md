# Design: fix-analysis-per-symbol-isolation

**Created**: 2026-11-20
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-20 (design gate, option A)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Each per-symbol fan-out in xstockstrat-analysis isolates its per-symbol unit, so a failing symbol
degrades only its own row and healthy siblings are returned and persisted. Decisions D-1 to D-13 in
`debate.md` are the binding record; this section is their design-level summary. Anchors of the form
`recon.md:N` point at the recon line that carries the `path:line`; anchors verified only during the
debate are cited by their `D-n` evidence cell.

### 1. Isolation sites (D-1, D-6, D-7)

Isolation sits at the **callers**, never inside `compute_readiness_row`, because the loaders raise
before that function is reached (R-1). The five sites:

| Site | Anchor | Today |
|---|---|---|
| `EvaluateReadiness` / `_readiness_for` | `servicer.py:4031`, gather `:4103` (recon.md:37-38) | unguarded; one raise fails the RPC and skips `upsert_many` (`:4110`, recon.md:39) |
| Readiness kick | loop `servicer.py:4312`, compute `:4329` (recon.md:42) | only the outer catch `:4356` (recon.md:44) |
| Readiness materializer | `servicer.py:6166-6167` (recon.md:51) | only the per-owner catch `:6228-6230` (recon.md:52) |
| `_compute_opportunities` / `_row_for` | `servicer.py:5743`, eval `:5815`, gather `:5917` (recon.md:30-35) | catches `grpc.RpcError` only (`:5825`) |
| Opportunity heal | `servicer.py:5152`, catch `:5162-5164` (recon.md:48) | catches `grpc.RpcError` only |

- One shared module `app/services/isolation.py` (`isolated` + `log_isolation_tally`) replaces per-site
  copies and is adopted by the screener too. It follows the feature-245 shape
  `ScreenerEngine._eval_symbol_isolated` (`screener.py:234`, recon.md:68) and its tally logging
  (`screener.py:128-155`, recon.md:69).
- Every catch is `except Exception`, never `BaseException`, so `CancelledError` and deadlines pass
  through (recon.md:117, recon.md:148).
- In `_row_for` and the heal, the per-symbol `try` spans the loaders, the assess and the eval. The
  gather-level isolation is a count-and-log backstop only: a held, watchlist or muted candidate must
  not be dropped as the primary path (R-4).

### 2. Readiness degradation (D-2, D-10)

- A degraded readiness row reuses the existing `bar_epoch = -1` sentinel (`readiness.py:66-71`,
  recon.md:73). It reads as UNKNOWN with the 300 s cooldown (feature-181 @AC-2, recon.md:107) and is
  never served from FAST or cached as a success (recon.md:149).
- `EvaluateReadiness` returns OK. The failing symbol comes back as an empty `SymbolReadiness`; the
  result keeps the `(proto, None, computed_at)` triple shape that `staged_rows` filters on
  (recon.md:40), and the healthy symbols' SLOW rows are persisted.
- Outcome by site (this is the amended 308 @AC-3): the kick and the materializer cache the `-1`
  sentinel for the failing pair; the heal skips the cache write for it and reports it in the WARN
  tally. The heal's cache write stays success-only (feature-185 @AC-9, recon.md:92).
- No terminal readiness verdict is added. A deterministic fault is re-kicked once per 300 s cooldown
  while a client polls, bounded at k components × pairs under the sandbox and bars semaphores (D-10).

### 3. Opportunity fault classification (D-3, D-4, D-5, D-8, D-9, D-13)

One predicate, `_is_transient_formula_error` in `evaluator.py`, classifies on the typed
`SandboxExitReason`, never on error text (R-6).

- `FormulaExecutionError` gains `exit_reason: int = 0`. `_decode_formula_output` passes
  `resp.exit_reason` directly on the `not resp.success` raise, with no `getattr` default (D-8 and
  D-13 evidence: `evaluator.py:114,141`, `indicators.proto:97`). No proto change.
- **Transient → healable `unavailable`**: `grpc.RpcError`, or a `FormulaExecutionError` whose
  `exit_reason == SANDBOX_EXIT_REASON_TIMEOUT` (`indicators.proto:104`). This keeps the existing
  outage token and the heal selector keyed on it (recon.md:76, recon.md:141).
- **Terminal → structural `evaluation_failed`**: every other `Exception`. That covers UNSPECIFIED,
  RUNTIME_ERROR, IMPORT_BLOCKED, MEMORY_EXCEEDED, the decode `ValueError` and the post-decode
  contract raises. An UNSPECIFIED failure is not inferred to be transient (R-7).
- **MEMORY_EXCEEDED is terminal** (R-8). Of the three indicators producers, the watchdog kill
  (`sandbox.py:763-773,799-800`) and the RLIMIT marker (`:810-811`) are deterministic per formula;
  only `-SIGKILL` plus a rise in `oom_kill` (`:812-813`) can hit a bystander. Accepted cost: a rare
  cgroup-OOM bystander row stays `evaluation_failed` until the next recompute.
- `evaluation_failed` follows the feature-289 `formula_unreadable` precedent (recon.md:77-80): a new
  entry in `_PROVENANCE_STRUCTURAL_MARKERS` (`app/repositories/opportunities.py:28`, recon.md:53)
  plus the read-query floor exemption. It is exposed through provenance only; `data_unavailable` on
  the wire stays derived from `unavailable` alone (R-3).
- Marker precedence: `unavailable` (bars failed, `fund_unknown`, eval outage) > `evaluation_failed` >
  clean. `formula_unreadable` is exclusive of both.
- The outage flag moves onto the row. `fetch_failed` (`servicer.py:5669,5807,5834`, recon.md:29-33)
  reverts to bars-only, which removes the completion-order race from product-spec Open Question 3
  (recon.md:146).

**In-scope cross-service touch (D-9).** The indicators deadline-refusal response
(`services/xstockstrat-indicators/app/handlers/servicer.py:352-359`) sets
`exit_reason=SANDBOX_EXIT_REASON_TIMEOUT`, so a load-driven refusal is healable. An indicators test
asserts the field on the refused path. Its consumers only display the value (agent `tools.py:1688`,
analysis `fundamentals_scoring.py:64`), and indicators metrics do not change because the early
return precedes `record_sandbox_execution` (`:383`). xstockstrat-indicators is therefore a second
touched service, beyond the product spec's "xstockstrat-analysis (only)".

### 4. Timeout contract (operator decision, O-1)

A formula TIMEOUT isolates to `unavailable` on the opportunity side and to the `-1` readiness
sentinel on the readiness side, at all five sites. This reverses the feature-185 "a
`FormulaExecutionError` still propagates" contract (recon.md:32, recon.md:135-140) for which the
operator gave the C-16 sign-off on 2026-11-20. The declined-sign-off fallback (D-11) is not
exercised.

Follow-through in the same PR: the two pinning tests at
`services/xstockstrat-analysis/tests/test_unreadable_formula.py:671,691` are rewritten, feature-289
@AC-10 and @AC-13 are amended in their durable suites, and the service CLAUDE.md sentence and the
code comments at `servicer.py:5829,4980,5164` are updated.

### 5. Consumer surface (C-14, D-12)

The fix reaches the **insights opportunities page** of `xstockstrat-ui`; the agent's
`list_opportunities` output is unchanged apart from the new provenance token.

- `services/xstockstrat-ui/src/lib/readinessCue.ts` exports `EVALUATION_FAILED_PROVENANCE` (the
  single TS copy of the wire token) and `EVALUATION_FAILED_CUE`, beside `IN_QUEUE_CUE`.
- `src/app/insights/opportunities/page.tsx` derives `evalFailed` beside `held`/`unreadable` and
  uses it in three places (D-12 evidence: `page.tsx:507-508,518,567-575,659`):
  - header: the cue when `evalFailed && !held`;
  - readiness slot: an `evalFailed` arm with `data-testid=opportunity-evaluation-failed-<sym>`, so
    the row no longer falls through to `—` / 0-of-0;
  - act gate: `fundUnavailable || ((unreadable || evalFailed) && !held)`.
- One Playwright assertion: a non-held `evaluation_failed` row shows the cue test id and has no act
  controls.
- Mobile `SignalRow` and the Signal-detail header are **not** decided here; see Open Risks (O-9).

### 6. Tests and build order

- A RED regression per acceptance scenario (C-15).
- `CancelledError` passthrough tests at each isolation site, credited only after a mutation run
  (recon.md:148).
- Analysis test doubles are enumerated by grep (every `SimpleNamespace(success=` construction and
  helper, including `_formula_stub` at `tests/test_strategy_evaluator.py:521,581`), and each gains
  `exit_reason`. Regression tests assert that the classifier received a `FormulaExecutionError`
  carrying the expected `exit_reason` (O-10).

One PR, in this order:

1. Exception field, predicate, indicators refusal field, paired tests.
2. Marker plumbing (`_PROVENANCE_STRUCTURAL_MARKERS`, floor exemption).
3. Readiness callers.
4. `_compute_opportunities`.
5. Heal.
6. UI: constant, cue, desktop gates, e2e.
7. Double updates, regression and `CancelledError` tests, the CHANGE-characterization rewrites, the
   service CLAUDE.md sentence, the three `-1` invariant texts, and the named C-14 degraded-rate
   counter follow-up (`fails.md:3229-3232`).

## Rejected Alternatives

- `R-1` Seam catch inside `compute_readiness_row` — rejected because it misses the pre-compute
  loaders (`servicer.py:4046-4064`), and spec @AC-2 patches the function itself.
- `R-2` Routing every `FormulaExecutionError`, timeouts included, to terminal `evaluation_failed` —
  rejected because a load-driven timeout would go stale for about 24 h; the heal is keyed on
  `unavailable`.
- `R-3` Showing `evaluation_failed` as `data_unavailable=True` — rejected because it misdiagnoses a
  formula fault as a data outage (agent `tools.py:1736`, UI outage cue).
- `R-4` Dropping a candidate whose failure happens outside the eval as the primary path — rejected
  because `replace_for_user` deletes held/watchlist/muted rows, breaking feature 131 and feature-185
  @AC-1.
- `R-5` Per-site copies of the screener isolation wrapper and tally logger — rejected as a DRY guard
  rail violation (seven near-identical blocks).
- `R-6` Classifying formula timeouts by matching the error-message text — rejected because the proto
  already models the value set as an enum, `str(e)` never starts with the sandbox text
  (`evaluator.py:115`), it misses the deadline-refusal producer, and analysis CI cannot catch an
  indicators reword.
- `R-7` Treating `success=False` with UNSPECIFIED `exit_reason` as transient — rejected because the
  sandbox `other` arm also maps to UNSPECIFIED (indicators `servicer.py:381-382,416`), so non-load
  faults would be over-healed.
- `R-8` Classifying `SANDBOX_EXIT_REASON_MEMORY_EXCEEDED` as transient — rejected because it
  contradicts settled D-8 and two of the three producers are deterministic per formula; the result
  would be perpetual heal churn and the R-3 misdiagnosis.
- `R-9` Re-raising the timeout at all five isolation sites in the declined-sign-off fallback —
  rejected because only `_row_for` and `_readiness_for` are pinned by @AC-10/@AC-13; re-raising in
  the kick, materializer or heal recreates report 3's whole-batch loss.
- `R-10` Adding `SANDBOX_EXIT_REASON_OOM_KILLED` (a proto change) inside this bug fix — rejected
  because it is a proto change (C-09 gates, codegen) and a second cross-service touch inside a SEV-2
  fix; if wanted it is a separate follow-up.

## Open Risks

- [ ] **O-9 (open, non-blocking): cue parity outside the desktop act row.** Mobile `SignalRow`
  (`SectionRenderer.tsx:248-256`) and the Signal-detail header
  (`trader/positions/[symbol]/page.tsx:1014-1020`) show `—` or the action badge for an
  `evaluation_failed` row, where feature 289 renders the unreadable cue on all three surfaces. The
  debate did not choose between rendering `EVALUATION_FAILED_CUE` there (a `SignalItem` field
  plumbed via `sections.ts`) and a named C-14 follow-up feature. Display-only; mobile has no act
  controls — to be decided and recorded at `/sdd-spec`, before the UI step.
- [ ] **O-10 (open, non-blocking): test doubles.** The double inventory must come from a grep, and
  regression tests must assert the classifier's input, so an `AttributeError` swallowed by the
  per-symbol `except Exception` cannot pass as `evaluation_failed` — to be addressed at the
  test-double step (build step 7).
- [ ] **308 @AC-2 / @AC-3 wording.** The amendment is signed off, but `acceptance.feature` still
  carries the pre-amendment text and the round-2 replacement wording is not on disk — to be
  reworded at `/sdd-spec` to match § 2 above.
- [ ] A cgroup-OOM bystander, the only non-deterministic MEMORY_EXCEEDED path, stays
  `evaluation_failed` until the next recompute. Bounded and visible — accepted; no step.
- [ ] Until the named C-14 counter follow-up lands, a sustained per-symbol degraded rate shows only
  in WARN logs and span attributes. No alert covered these signals before or after the change — to
  be filed as a named follow-up at build step 7.
- [ ] The gather-level `isolated(...)` backstop can still drop a candidate on a row-assembly bug,
  deleting its stored row for one cycle — to be covered by the tally WARN at the
  `_compute_opportunities` step.
- [ ] Overloading the `-1` readiness sentinel may mislead future readers if any of the three
  invariant texts is missed — to be addressed at build step 7.
- [ ] Agent `test_formula` displays TIMEOUT instead of UNSPECIFIED for a deadline-refused run —
  accepted; noted at the indicators step.
- [ ] Peer overlap: the analysis servicer is shared with in-flight peers 309, 313, 323, 327 and 329
  (recon.md:150); line anchors will drift — re-grep at `/sdd-spec`.

## Constitution Rules Touched

No Floor (`F-*`) rule is breached.

- `C-01` — honored by: the status flip happens only at COMPLETION, after the operator approved.
- `C-04` — honored by: classification uses the existing `SandboxExitReason` enum, not a string.
- `C-09` — honored by: no proto change; the proto-changing alternative is rejected (R-10).
- `C-10` — honored by: the service CLAUDE.md sentence and the three `-1` invariant texts change in
  the same PR.
- `C-11` — honored by: full recon and a three-round full-mode debate before any code.
- `C-14` — honored by: the fix reaches the opportunities page (§ 5); the degraded-rate counter and,
  if chosen, the mobile/detail cue are named follow-ups, not silent gaps.
- `C-16` — honored by: every CHANGE below carries the operator sign-off recorded in context.md.
- `C-17` — honored by: the desktop row gets a dedicated cue and test id; remaining surfaces are
  tracked as O-9.
- `C-18` — honored by: one exported TS constant for the wire token; no text-prefix constant.
- `P-02` — honored by: proposer and adversary saw only the synthesized state each round.
- `P-03` — honored by: the proposal's contradiction of D-8 was corrected as drift, not adopted; the
  undecided O-9 choice is surfaced, not guessed.
- DRY guard rail (`docs/patterns/dry-guard-rail.md`) — honored by: one `isolation.py` helper and one
  TS provenance constant.
- `PLAT-N1` — honored by: best-effort catches stay `except Exception`, with a mutation-verified
  `CancelledError` test at each site.

## Business Rules Touched (C-16)

Sign-off for every CHANGE line: Operator (2026-11-20, design gate, option A), recorded in context.md
`## Session 2026-11-20 — sdd-design`.

- CHANGE `@AC-10` (feature 289) "A formula execution timeout still fails the opportunities
  recompute" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`) —
  altered guarantee: the timed-out candidate isolates to an `unavailable` row and the recompute
  completes; signed off by user @ 2026-11-20 (context.md).
- CHANGE `@AC-13` (feature 289) "A formula execution timeout still aborts EvaluateReadiness"
  (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`) — altered
  guarantee: the RPC returns OK and the timed-out symbol degrades to readiness `-1`; signed off by
  user @ 2026-11-20 (context.md).
- CHANGE `@AC-2` (308, wording amended) "EvaluateReadiness returns and caches healthy symbols when
  one symbol's compute raises" — the proto has no `unavailable` field, so the failing symbol is an
  empty `SymbolReadiness`; signed off by user @ 2026-11-20 (context.md).
- CHANGE `@AC-3` (308, outcome split by site) "An indicators outage on one strategy component does
  not discard the user's readiness batch" — kick and materializer cache the `-1` sentinel; the heal
  skips the cache write and reports a WARN tally; signed off by user @ 2026-11-20 (context.md).
- PRESERVE `@AC-1` (308) "A candidate whose evaluation raises degrades to its own row and healthy
  candidates are materialized" — not regressed by: `_row_for` isolation with the fault marker.
- PRESERVE `@AC-4` (feature 289) "A genuine indicators outage still yields a data-unavailable row"
  and `@AC-4` (feature 185) "A background recompute does not starve an interactive read"
  (`.../opportunity-compute-robustness.feature`) — not regressed by: `RpcError` still maps to
  `unavailable`; the semaphores are untouched.
- PRESERVE `@AC-1` (feature 185) "A data-unavailable symbol is marked unavailable, not
  evaluated-0/0" — not regressed by: held/watchlist rows are degraded in place, never dropped (R-4).
- PRESERVE `@AC-9` (feature 185) "A recovered watchlist-entry symbol also refreshes the readiness
  cache" — not regressed by: the heal's cache write stays success-only.
- PRESERVE `@AC-8` (feature 185) "A data-unavailable row self-heals via a surgical read-time
  recompute" and `@AC-21` (feature 289) "The marker round-trips storage and a sibling's outage does
  not flip the row" — not regressed by: the heal is isolated per symbol and the outage flag is
  row-local.
- EXTEND `@AC-9` (feature 289) "The 300-second heal does not re-stamp an unreadable row as
  unavailable or retry it endlessly" and `@AC-26` (feature 289) "Once the formula becomes readable
  the next recompute evaluates the row normally" — new case added: `evaluation_failed` is terminal
  for the heal and clears on the next recompute.
- EXTEND `@AC-2` (feature 181) "A data-unavailable readiness row is decorated UNKNOWN, not perpetual
  PENDING" — new case added: a per-symbol evaluation fault also yields the `-1` sentinel.
