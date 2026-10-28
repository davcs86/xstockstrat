# Context Log: fix-screener-symbol-isolation

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-19-analysis-screener-no-per-symbol-isolation-defect.md`
  (Issues disabled). Source: Latent-bugs row in `services/xstockstrat-analysis/docs/context-constitution-findings.md:20`.
- Severity: SEV-2. Environment: dev (main-dev) @ 1302e6d. Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (AC-1..AC-3), context.md.
- Affected services: xstockstrat-analysis.
- Root cause hypothesis: `asyncio.gather` at `screener.py:115` has no `return_exceptions`, and
  `_eval_symbol` has no outer guard; it catches only `grpc.RpcError` (`:229`).
- Confirmation evidence: the report's reproduction (a `ZeroDivisionError` from `compute_signal_score` over
  50 symbols makes the RPC abort UNKNOWN with no results) was not re-run at triage. A code read on
  main-dev @ 37b9a56 confirms the shape: `screener.py:115` gather with no `return_exceptions`, and the
  `:256` `compute_signal_score` call is unguarded.
- Design forks for /sdd-design:
  - degraded-row shape: INSUFFICIENT_DATA re-triggers the UI poll loop (feature 144 note), so the options are
    `score_unavailable` or dropping the row;
  - the isolation point;
  - `CancelledError` must keep propagating (AC-2). The servicer's `asyncio.wait_for` →
    DEADLINE_EXCEEDED lives at `app/handlers/servicer.py:3786-3795`.
  - The servicer maps a `ValueError` out of `screen()` to INVALID_ARGUMENT (`:3796`). That error is raised by
    `_validate_fundamental_metrics` before the fan-out, and per-symbol isolation must not absorb it (AC-3).
- Recommended design depth: quick → `/sdd-design fix-screener-symbol-isolation quick` (rationale: SEV-2,
  single service, no proto/migration/config anticipated; escalate to full if a new `ScreenResultStatus`
  value is chosen).
- Development branch: feature/fix-screener-symbol-isolation

## Session 2026-10-20 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Verdict: PASS WITH WARNINGS (0 fails, 0 Floor breaches).
- Warnings (4):
  - C-15/P-06: AC-1's "computed score" Then has no pinned oracle. Examples 2 and 3 fail after raws are
    already set (`sig` at `screener.py:276`, plus `rsi` before `_latest_indicator` at `:284`).
    `_normalize_universe` (`:409-437`) normalises over every row with a raw, so the other 49 scores depend
    on the partial-raws fork. Not pinned here. /sdd-design must write the oracle back into AC-1 as wording
    only, keeping AC IDs (product-spec "Partial raws" fork).
  - C-14: INSUFFICIENT_DATA had been re-admitted as a degraded-row shape. **Resolved:** it is removed from
    FR-1, the Degraded-row shape fork, Consumer Surface and AC-1. A gap-less INSUFFICIENT_DATA row starts the
    `/insights/screener` poll (`page.tsx:120-129`) and shows the "Fundamentals pending" badge (`:241-254`);
    `SymbolScreening.tsx:236-248` shows "Not enough data to screen". Feature 144 kept the status for
    transient causes only (`services/xstockstrat-analysis/docs/context-constitution.md:42`). This matches
    the triage narrowing above. The remaining shapes are a kept `score_unavailable=true` + `passed=false` row,
    or a dropped row.
  - C-10 (advisory): the sibling un-isolated gathers (`servicer.py:3983`, `:5776`; `_row_for` catches only
    `grpc.RpcError` at `:5693`) are untracked. **Partially resolved:** Out of Scope now says each needs its
    own defect report. No report has been filed yet, because that is outside this feature dir; it is an
    open follow-up.
  - Criterion 2/8: an INSUFFICIENT_DATA row ties at score 0.0 under the `(score_unavailable, -score)` sort
    key (`screener.py:152`). **Resolved** by removing INSUFFICIENT_DATA: FR-1 now pins a kept row to
    `score_unavailable=true`, so it sorts last. /sdd-design should still keep AC-1's fixture clear of
    0.0-score ties.
- Notes (4), resolved where cheap:
  - AC-2 now names the blocking site (marketdata GetBars never returns).
  - AC-3 now names symbols `["AAPL","MSFT"]`, states that neither has an `extra_metrics` key
    `not_a_metric`, and asserts that no rows are returned.
  - Reproduction step 1 now adds the `:253-255` preconditions (a signal plus at least one bar).
    `_latest_indicator` is cited as called at `:284` and defined at `:288`.
  - C-16 note: AC-1 Examples keep their internal symbol names (precedent:
    `services/xstockstrat-analysis/acceptance/fix-signal-screen-crash.feature`), and its @AC-1 is preserved.
  - Criterion 9 note: no unchecked items.
- Overlap findings: none (feature-overlap PASS, no collisions).
- Operator decisions:
  > OPERATOR DECISIONS (binding, recorded 2026-10-20):
  > - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  > - Full design depth (operator overrode the triage 'quick' recommendation).
- Next: `/sdd-design fix-screener-symbol-isolation` (full). This supersedes the triage `quick` recommendation.

## Session 2026-10-20 — sdd-review product-spec (re-review)

- Re-review of the post-approval spec. Verdict: PASS WITH WARNINGS (0 fails, 0 Floor breaches). Status was
  already `spec-ready` (73e1ccba), so status.md is unchanged and no duplicate `draft` → `spec-ready` row was
  added to feature.md. Next Action is unchanged: `/sdd-design fix-screener-symbol-isolation` (full).
- Warnings (6):
  - C-15: AC-1's "with its computed score" Then has no concrete oracle. Partial raws change min-max
    normalisation (`screener.py:409-437`). **Open, routed to /sdd-design:** the "Partial raws" fork already
    requires design to write the pinned oracle back into AC-1.
  - C-15/P-06: AC-1's "row, if present" admits a passing test with no BAD row. **Partially resolved:** the
    Degraded-row shape fork now requires design to rewrite "if present" to the chosen shape, and to assert a
    kept row present.
  - P-03/C-11: three design forks are still open (degraded-row shape, isolation point, partial raws). Not a
    blocker. **Open, routed to /sdd-design;** they must be resolved before the impl-spec.
  - C-14: Consumer Surface(s) was prose. **Resolved:** it is now a checkbox list (Agent `screen_symbols`, UI
    `/insights/screener`, UI `/trader/positions/[symbol]`), and each item says what changes. The conditional
    no-code-change claim still depends on the design fork, and C-14 needs a step or a named follow-up if the
    shape requires agent or UI work.
  - AC-3 used the shorthand "FUNDAMENTAL". **Resolved:** it now reads `SCREEN_KIND_FUNDAMENTAL`
    (`packages/proto/analysis/v1/analysis.proto:477`).
  - Hygiene, CancelledError vs `return_exceptions=True`. **Resolved as a design constraint:** the Isolation
    point fork notes that `except Exception` does not catch `CancelledError` (a BaseException on 3.13), and
    that a child `CancelledError` returned by `gather(return_exceptions=True)` must not become a degraded row.
- Overlap findings: none (feature-overlap PASS, no collisions, no merge-order row). Low-risk context: the
  analysis service dir is shared with 242, 244, 246 and 248, in different files. Recheck 246 at impl-spec,
  because its scorer must not be `scoring.compute_signal_score` (`scoring.py:10`), the AC-1 failure site.
- Operator decisions:
  > OPERATOR DECISIONS (binding, recorded 2026-10-20):
  > - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  > - Full design depth (operator overrode the triage 'quick' recommendation).

## Session 2026-10-21 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-analysis; consumers xstockstrat-agent, xstockstrat-ui;
  key reuse patterns: `ScreenResult.score_unavailable` field 14 + `passed=false`, the `_eval_symbol` seed
  dict `screener.py:207-216`).
- Phase 1 Grilling: 4 rounds (full, per operator decision). Termination: auto-approved under operator
  standing authorization 2026-10-21 (rounds >= 2, no Floor breach, no blocking objection, no @AC CHANGE).
- Chosen approach (design.md items 1-8, single numbering): `_eval_symbol_isolated` wrapper with
  `except Exception` around `_eval_symbol`; failing symbol becomes a fresh `_seed_row` (empty raws) with
  `eval_failed=True`, exception kept in a local `failures` list only; `_build_result` early-returns
  `OK, passed=False, score_unavailable=True`; `_rank` zips the row flag into the sort key
  `(score_unavailable, eval_failed, -score)`; one summary WARN/ERROR line with `symbol:ExceptionType`
  samples + `screener.degraded_count` span attribute and `record_exception`; agent client forwards
  `score_unavailable` and docstring/runbook describe the three row kinds; SymbolScreening renders
  "Not evaluated" via shared `EmptyState`; alerting option (i), named follow-up feature 250.
- Round history:
  - r1: proposer chose the wrapper + `score_unavailable` row. Blockers: SymbolScreening (C-14) never reads
    `scoreUnavailable`; `except BaseException` mutation as AC-2 teeth found ineffective (CPython 3.13
    gather `_cancel_requested`).
  - r2: r1 blockers closed (UI option (a) on `EmptyState`; engine-level CancelledError test). New blockers:
    agent client drops `score_unavailable` (`services/xstockstrat-agent/app/client.py:760-766`) so a fault
    reads as a confident criteria fail; claim that ERROR "keeps the error-rate signal" disproved by
    `packages/otel/alerts/alert-rules.yaml:26-45`.
  - r3: both r2 blockers closed (agent step + AC-5; alerting option (i), feature 250 handoff). New blocker:
    clearing the row's `error` to None before `_rank` re-opens the `passed = True` scar (`screener.py:457`).
  - r4: r3 blocker closed (`eval_failed` bool set at creation, never cleared). Adopted adversary
    corrections: zip instead of `failed_syms` set (`screen()` does not dedupe, `screener.py:93`); agent
    guidance keeps "filter on `passed`" (PRESERVE feature 144, 144 `context.md:8`, `:14`), deletes the false
    `tools.py:845-846` sentence; `min_conviction`/`rank_limit` caveat; typed failure samples; existing
    seed-key tests instead of a bespoke identity test; TraceQL handoff form; handoff target is 250's branch.
- Rejected (24, full list in design.md § Rejected Alternatives): `gather(return_exceptions=True)`; dropping
  the row; new ScreenResultStatus (proto); INSUFFICIENT_DATA as degraded status; default `_build_result`
  path; keeping partial raws; ValueError/INTERNAL escalation; storing+clearing the exception; LogQL rule;
  metrics counter; `failed_syms` set; `.get("eval_failed", False)`; blanket agent "exclude"; per-symbol WARN;
  hand-rolled notice; bespoke seed test; handoff in 245's worktree; alerting on span exception event.
- Constitution rules touched: C-11, C-14, C-10, C-15, C-16, C-17, C-12/C-13, C-18, C-01, C-04/C-09,
  C-08/P-06, C-02, F-07, F-09, P-03, P-04/P-05, P-02. Floor breaches: none.
- Business rules: PRESERVE feature 160 AC-1/AC-2, feature 224 AC-29, this feature AC-2/AC-3; EXTEND this
  feature AC-1, new AC-4, AC-5; feature 144 render change EXTEND, agent keep-visible decision PRESERVE.
  No CHANGE, so no operator coverage needed.
- Debate checkpoints (session scratchpad, not durable): `/tmp/claude-0/-home-user-xstockstrat/0e33c54d-7bf5-528d-8d50-aaa4bc92a407/scratchpad/seeds/245/state-r2.json`,
  `state-r3.json`, `state-r4.json`. This entry + design.md are the durable record.
- Status: spec-ready → design-approved.
- Open Threads (from design.md § Open Risks):
  - Product-spec/acceptance amendments owed: AC-1 wording ("is present", 49-run oracle, summary log), FR-4,
    AC-4, AC-5, Affected Services (+agent, +ui), Consumer Surface(s), "no UI change" paragraph — target:
    `/sdd-spec` before step planning (C-15).
  - Feature-250 handoff not yet written: append to 250 `context.md` on `feature/fix-otel-metrics-logs-gap`
    after reading it (C-02); ERROR log rule + TraceQL `{ span.screener.degraded_count > 0 }` — target:
    orchestrator completion write.
  - FR-2/AC-2 teeth rest on a gather source read — target: `/sdd-execute` runs both mutations, records reds.
  - Span attribute landing on the GrpcAioInstrumentorServer server span unverified — target: `/sdd-spec`
    in-memory span exporter test (non-gating).
  - All-degraded scan stays below the error-rate threshold once 250 ships — target: feature 250.
  - `min_conviction > 0`/`rank_limit < N` drop degraded rows (`screener.py:172-181`) — target: agent docs step.
  - `_seed_row` drift guarded only by `test_screener.py:129/:153/:183/:215/:335` — target: engine step.
  - Agent cannot tell a fault row from a data-less hard-filter row — accepted (no proto change).
  - AC-2 servicer test ~1s hanging mock may flake — target: AC-2 test step.
  - AC-4 `page.route` glob for `/insights/api` from `/trader` unverified; `EmptyState` test id collision —
    scope selector to wrapper — target: UI step.
  - Recon grepped 28 analysis suites by keyword only — target: engine step full-suite run.
  - "No logs reach Loki" unverified against live Grafana — target: feature 250.
  - Sibling unguarded gathers `servicer.py:3983`, `:5776` — target: defect reports (docs step).
  - Cross-branch write to `feature/fix-otel-metrics-logs-gap` may conflict — read 250 `context.md`
    immediately before appending.

## Session 2026-10-21 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status → implementation-ready.
- Design-owed amendments applied before step planning (design.md § Open Risks, C-15 append-only IDs):
  - acceptance.feature AC-1 reworded (EXTEND, ID kept): "BAD"'s row is present with status OK, passed
    false, score_unavailable true and no criterion_scores; each of the other 49 rows equals the
    49-symbol run without BAD; BAD ranks last; exactly one WARN line names `BAD:<ExceptionType>`. A new
    Given gives BAD the highest signal conviction, so a kept partial raw would shift the other rows.
  - Appended `@AC-4 @FR-4` (SymbolScreening "Not evaluated") and `@AC-5 @FR-1` (agent row carries
    `score_unavailable`).
  - product-spec: FR-1 pin, new FR-4, Affected Services + xstockstrat-agent and xstockstrat-ui, Consumer
    Surface(s) paragraph resolved, AC→FR map extended.
- Step order:
  - analysis: Step 1 preservation guards AC-2/AC-3 (green on the unfixed tree), Step 2 engine items 1-3,
    Step 3 AC-1 outline + FR-2/soft-only/sort-tie/duplicate/span tests + the two mutation runs;
  - agent: Steps 4-6 (client, test, `docs/runbooks/mcp-tools.md` C-10);
  - UI: Steps 7-8 (SymbolScreening + Playwright AC-4 + INVENTORY.md:47);
  - Step 9 docs (findings row, constitution :42 sort key, two sibling defect reports, teardown).
- Key codebase findings:
  - Two of the three AC-1 failure sites take no symbol arg: `_latest_indicator(self, indicator, closes, propagation_meta)`
    `screener.py:288` and `scoring.compute_signal_score(signals_map, latest_bar, ...)` `:256-258`.
    BAD is told apart by a sentinel last-bar close `999.0`. `_technical_value` `:331` takes `symbol`.
  - The existing AC-3-like test `test_unknown_metric_aborts_invalid_argument` `tests/test_analysis_servicer.py:1265`
    uses one symbol `AAA`/`pe_ration`, not AC-3's `["AAPL","MSFT"]`/`not_a_metric`. Step 1 adds a
    two-symbol test and keeps `:1265`.
  - `pytest-timeout` is absent from analysis `pyproject.toml`, so the AC-2 servicer test carries no
    timeout marker.
  - The `page.route('**/xstockstrat.analysis.v1.AnalysisService/<RPC>')` glob is already used from
    `/trader` (`e2e/trader/position-detail.spec.ts:683`) and for ScreenSymbols in
    `e2e/insights/screener.spec.ts:95`. This closes design Open Risk "page.route glob".
  - `EmptyState` is already imported on the host page `src/app/trader/positions/[symbol]/page.tsx:66`,
    so the AC-4 selector is scoped to the `symbol-screen-unevaluated` wrapper.
  - `services/xstockstrat-analysis/docs/context-constitution.md:42` states the old sort key
    `(r.score_unavailable, -r.score)`. Step 9 updates it.
  - Opportunities `_row_for` deliberately lets `FormulaExecutionError` propagate (feature 185 comment
    `servicer.py:5694-5698`). Step 9's sibling defect report must record that choice.
  - Feature 246 edits `app/engine/fundsignal_loop.py`, not `scoring.compute_signal_score`, so there is no
    AC-1 overlap. Feature 244's `int_positive` clamp on `max_duration_seconds` leaves Step 1's stubbed
    `get_int → 1` intact.
- Decisions:
  - The design's "non-gating" span-exporter test became a normal Step 3 test. It uses a local
    `TracerProvider` (not global) plus `InMemorySpanExporter`. Context propagates through `wait_for` and
    the gather tasks' context copy.
  - The mutation runs (design item 7) are recorded in context.md, not gating (F-05 applies to the
    committed tree only).
- Open Threads:
  - Feature-250 handoff: orchestrator completion write on `feature/fix-otel-metrics-logs-gap` (C-02 read
    first). Target: completion.
  - C-16 promotion of AC-1..AC-5 into the analysis/ui/agent durable suites. Target: integration PR.
- Operator decisions:
  > OPERATOR DECISIONS (binding, recorded 2026-10-21):
  > - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  > - Full design depth (operator overrode the triage 'quick' recommendation).
- Next: `/sdd-review fix-screener-symbol-isolation impl-spec`, then `/sdd-execute fix-screener-symbol-isolation`.

## Session 2026-10-21 — sdd-review impl-spec

- MODE B, advisory. Status unchanged: implementation-ready. Criteria FAIL 1, WARN 6, Floor breaches 0;
  overlap WARN, rebase-only, no merge-order entry needed.
- FAIL C-15 traceability: stale-checkout false positive. The reviewer read
  `/home/user/xs-feat/245-fix-screener-symbol-isolation` at `2799e4f2`, the design commit. The amendments
  are on `origin/feature/fix-screener-symbol-isolation` from `7e4a2335` onward:
  - `acceptance.feature:41` `@AC-4 @FR-4`, `:49` `@AC-5 @FR-1`;
  - AC-1 oracle, "is present" and the one-WARN-line wording at `:14-17`;
  - `product-spec.md:116` FR-4, `:70-71` agent/ui under Affected Services.
  The Execution Summary now pins these anchors and the branch to review against. design.md:190 Open Risk
  and the Open Thread in this file's design entry are resolved by the sdd-spec entry above. design.md
  itself is left as written.
- Addressed in implementation-spec.md:
  - W1: Step 3 instr 3 cancel test is deterministic. CXL cancels first; OK1 returns a local literal, so
    there is no `_seed_row` call before Step 2.
  - W2: Step 3 **Files** lists the scratch mutation targets. Instr 8 requires Step 2 committed, then reverts
    with `git checkout -- ...` and a `git diff --quiet` clean check.
  - W3: Step 3 instr 4 pins universe `["AAA","BAD"]` and fixtures. New instr 4a tests the all-failed ERROR
    branch. Instr 5 pins GOOD/NODATA/BAD data, NODATA's sell at conviction 1.0 → 0.0
    (`scoring.py:41-42`), and the BAD-first universe. A stable sort would otherwise pass without the
    `eval_failed` key.
  - W4: old Step 9 split into Step 9 (sibling defect reports, 4 files) and Step 10 (findings row,
    constitution sort key, teardown last). Total Steps 10.
  - W5: Completion obligations now give an owner and a verification check for the 250 handoff and the dev
    smoke test.
  - W6: Step 3 Verification has a separate "Mutation verification" block.
  - Overlap: Step Dependencies corrects 246 (spec-ready; its recon cites `screener.py:152`, `:467`, `:479-480`)
    and notes the 244 re-anchor for `screener.py:91-127`.
- Open Threads (still open, for the /sdd-execute checkpoint):
  - Mutation (a) premise (servicer deadline test stays green under `except BaseException`, CPython 3.13
    gather `_cancel_requested`) comes from reading source, not a run. Target: /sdd-execute Step 3
    mutation verification records the actual result.
  - Feature 246 forward overlap on `screener.py:149-153`, `:439-507` is unconfirmed. Target: re-check at
    246 `/sdd-design`, and re-run impl-spec Mode B if 244 or 246 moves to in-progress.
  - Feature-250 alerting handoff and the dev smoke test are still owed. Each now has an owner and a
    verification check. Target: completion / integration session.

## Session 2026-10-28 — re-spec (sdd-execute sequential, sdd-batch-execute)

- Branch setup (§5.3): detached checkout of `origin/feature/fix-screener-symbol-isolation`, then
  `git merge -X ours origin/main-dev` (merge `9fea9fcd`), pushed.
- Re-spec, Step 5 only: Codebase Evidence cited the agent CI threshold at `.github/workflows/ci.yml:358-359`,
  which is now the `xstockstrat-indicators` row (threshold 50). The `xstockstrat-agent` matrix row is at
  `ci.yml:368-369`; its value is still 40, so the step's `--cov-fail-under=40` verification holds. Only the
  line anchor changed. The other Step 5 anchors were re-checked and still hold:
  `class TestScreenSymbolsClient` `tests/test_client.py:215`, `test_screen_symbols_sends_grpc_call` `:217`,
  the exact-equality assert `:277`. Instructions, Files and Verification are unchanged.

## Session 2026-10-28 — sdd-execute sequential (sdd-batch-execute)

- Status: `implementation-ready` → `in-progress`. Severity SEV-2.
- Up-front confirmation (sequential mode entry): operator approved the up-front plan by standing
  authorization — operator chat 2026-10-28 (session_01NpS3HShZK6pSnogA7CFo2f): "Start executing features
  241-276" via batch-execute. Answers: unattended checkpoints (checkpoint mode `report`); C-16 promotion
  auto-confirmed unless it changes an existing @AC rule; merge-train authorized; 255/275 deferred.
- Plan: Steps 1-10 in order, one commit per step on `feature/fix-screener-symbol-isolation`, each committed
  only after its Verification passes. Step 5 was re-anchored (see the re-spec entry above); no other step changed.
- Open Threads carried from the impl-spec review entry remain open (Step 3 mutation (a) run result,
  feature 246 overlap, feature-250 handoff and dev smoke test).

## Session 2026-10-28 — sdd-execute sequential, Step 1 (sdd-batch-execute)

- Step 1 — test: AC-2 deadline and AC-3 validation preservation guards (servicer). Status `pending` → `done`.
- Files: `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — added
  `TestScreenSymbols.test_scan_deadline_aborts_deadline_exceeded` (@AC-2: `get_int` → 1 for
  `analysis.screener.max_duration_seconds`, 50 symbols `S00`..`S49`, `S00` GetBars hangs on
  `asyncio.Event().wait()`, one RSI `SCREEN_KIND_TECHNICAL_INDICATOR` criterion; asserts abort args
  `(DEADLINE_EXCEEDED, "screen exceeded 1s deadline")`) and
  `test_unknown_metric_two_symbols_aborts_invalid_argument` (@AC-3: `AAPL`/`MSFT`, metric `not_a_metric`,
  abort code `INVALID_ARGUMENT`). `test_unknown_metric_aborts_invalid_argument` left untouched.
- TDD: N/A per spec (preservation guard). Preservation proof on the UNFIXED tree (pre-Step-2):
  `uv run pytest tests/test_analysis_servicer.py -q -k "scan_deadline_aborts_deadline_exceeded or unknown_metric_two_symbols or unknown_metric_aborts_invalid_argument"`
  → `3 passed, 380 deselected in 2.78s`.
- Verification: full suite `uv run pytest --cov=app --cov-fail-under=40` → `1278 passed`, coverage 88.45%;
  `ruff check` clean; `ruff format --check` clean. C-13: the only `conftest` reference in the file is the
  pre-existing import at `:33`; the new symbol lists and fundamentals literals stay inline (one consumer each).
- Deviations: none. Out-of-scope changes: none.

## Session 2026-10-28 — sdd-execute sequential, Step 2 (sdd-batch-execute)

- Step 2 — service: per-symbol isolation, fail-closed degraded row, sort, summary log and span (engine).
  Status `pending` → `done`. Discovery: every Codebase Evidence anchor in `app/services/screener.py` matched.
- Files: `services/xstockstrat-analysis/app/services/screener.py` only (design.md items 1-3):
  - item 1: `@staticmethod _seed_row(symbol)` (seed literal extracted, + `"eval_failed": False`);
    `_eval_symbol_isolated(symbol, *args)` returns `(row, None)` or `({**seed, "eval_failed": True}, e)` under
    `except Exception` only (CancelledError propagates, FR-2); `screen()` gathers the wrapper, splits
    `per_symbol` / `failures`. Validation `_validate_fundamental_metrics` stays before the fan-out (FR-3).
  - item 2: `_build_result` returns `ScreenResult(symbol, status OK, passed=False, score_unavailable=True)` for
    `row["eval_failed"]` right after the INSUFFICIENT_DATA return, before `passed = True`. `_rank` sorts on
    `(score_unavailable, eval_failed, -score)` via a local `ranked` list; executor dispatch unchanged.
  - item 3: top-level `from opentelemetry import trace`; after the `dataless_bars` block one
    `"screener: %d/%d scanned symbols failed evaluation; sample=%s"` line (`log.error` when all failed, else
    `log.warning`, `exc_info` = first failure) plus `screener.degraded_count` + `record_exception` on the
    current span. No `set_status`, no per-symbol WARN.
- TDD red → green (scratch test `tests/test_zz_step2_scratch.py`, deleted before commit — see Deviation Log):
  RED on the pre-Step-2 tree: `3 failed, 1 passed` — one-failure degraded row, all-failed ERROR, span attribute
  each failed with `RuntimeError: boom` escaping `screen()`; the CancelledError passthrough case passed (as
  Step 3 instr 3 predicts). GREEN after the change: `4 passed`.
- Verification: the five-symbol grep hits (`:34`, `:118`, `:161`, `:169`, `:226`, `:236`, `:239`, `:245`,
  `:250`, `:485`); `eval_failed", False)` → no output; `except BaseException` → no output; `ruff check` clean,
  `ruff format --check` clean. Regression: full suite `uv run pytest --cov=app --cov-fail-under=40` →
  `1278 passed`, coverage 88.37% (no existing test flipped).
- Deviations: scratch-test TDD capture; local CPython 3.12.3 venv (CI 3.13). Out-of-scope changes: none.

## Session 2026-10-28 — sdd-execute sequential, Step 3 (sdd-batch-execute)

### Step 3 — test: AC-1 outline, FR-2 cancel passthrough, fail-closed, all-failed ERROR, sort tie, duplicate symbol, span attribute (engine) [done]
- Added to `services/xstockstrat-analysis/tests/test_screener.py`: module-local `_isolation_fixture` (symbol-keyed
  bars/RSI/signals, BAD sentinel close 999.0, conviction 0.95) and the patch helpers; parametrized
  `test_one_symbol_failure_degrades_only_its_row` (@AC-1 Examples: `compute_signal_score`/ZeroDivisionError,
  `_technical_value`/ArithmeticError, `_latest_indicator`/ValueError; 49-run oracle by ScreenResult equality,
  BAD row OK/not passed/score_unavailable/empty scores, ranked last of 50, exactly one WARN naming
  `BAD:<exc>`); `test_cancelled_error_in_symbol_eval_propagates` (FR-2, @AC-2 engine level);
  `test_degraded_row_soft_only_criteria_is_not_passed`; `test_all_symbols_failed_logs_error_not_warning`;
  `test_degraded_row_sorts_after_feature144_zero_score_row`; `test_duplicate_symbol_healthy_copy_ranks_by_score`;
  `test_degraded_count_lands_on_current_span` (local `TracerProvider` + `InMemorySpanExporter`, not global).
- TDD (AC-1, AC-2): RED with `screener.py` restored from `cfc0047b` (pre-Step-2):
  `uv run pytest tests/test_screener.py -q` → `8 failed, 21 passed` — the 3 AC-1 Examples, soft-only, all-failed,
  sort-tie, duplicate and span tests each failed on the injected exception escaping `screen()`
  (`ZeroDivisionError: boom` / `RuntimeError: boom` / ...); the cancel test passed (as instr 3 predicts).
  GREEN on `HEAD` engine: `29 passed` (20 pre-existing + 9 new, incl. the `:129 :153 :183 :215 :335 :468 :572
  :625 :661` guards).
- Verification: `uv run pytest --cov=app --cov-fail-under=40` → `1287 passed` (1278 + 9; no existing test flipped,
  incl. `tests/test_screener_enrichment.py`), coverage 88.52%; `ruff check` clean; `ruff format --check` clean;
  C-13 grep → one inline `def _isolation_fixture` (`:704`), no conftest reference. C-13 verdict: single consumer,
  stays inline.
- Mutations (instr 8; scratch, reverted, never staged — "mutations reverted" printed):
  - (a) `_eval_symbol_isolated` `except BaseException`: `test_cancelled_error_in_symbol_eval_propagates` RED
    (`KeyError: 'status'` — the absorbed cancel reached `dataless_bars`); `test_scan_deadline_aborts_deadline_exceeded`
    stayed GREEN on CPython 3.13.17. Open Thread "mutation (a) premise" resolved: the run confirms the premise.
  - (b) servicer `ScreenSymbols` wrapper swallowing `CancelledError` → `ScreenSymbolsResponse()`:
    `test_scan_deadline_aborts_deadline_exceeded` RED (`DID NOT RAISE <class 'Exception'>`).
- Files modified: `services/xstockstrat-analysis/tests/test_screener.py`
- Deviations: RED against restored pre-Step-2 engine; `UV_PYTHON=3.13` (`.python-version` says 3.12); mutation (a)
  failure mode is a KeyError — full detail in Deviation Log. Out-of-scope changes: none.

## Session 2026-10-28 — sdd-execute sequential, Step 4 (sdd-batch-execute)

### Step 4 — service: agent `screen_symbols` forwards `score_unavailable`; docstring describes the row kinds [done]
- `services/xstockstrat-agent/app/client.py`: `"score_unavailable": r.score_unavailable,` added after `"passed"` in
  the `screen_symbols` result projection (`:765`). Additive return key; tool name and parameters unchanged.
- `services/xstockstrat-agent/app/tools.py` `screen_symbols` docstring (design.md item 4): Returns lists
  `"score_unavailable" (bool)`; the false clause "it is never reported OK/passed just because a criterion had no
  data" is deleted; the three `score_unavailable=true` row kinds are described (evaluation fault: status OK,
  passed=false, not evaluated ≠ failed screen; data-less hard-filter: passed=false; data-less soft-only, feature
  144: passed=true); `min_conviction > 0` also drops un-evaluated rows and `rank_limit` may cut them (server log is
  then their only trace); "Filter candidates on `passed`." kept.
- TDD (scratch, pre-AC-5): RED `uv run pytest tests/test_zz_step4_scratch.py` → `KeyError: 'score_unavailable'`;
  GREEN after the change → `1 passed`. Scratch deleted, never staged; Step 5 owns the durable AC-5 test.
- Verification: `"score_unavailable": r.score_unavailable` grep → `app/client.py:765`; `never reported` /
  `just because a criterion had no data` grep → no output; ``Filter candidates on `passed` `` grep → 1 hit
  (`app/tools.py:854`); `ruff check` clean; `ruff format --check` clean (59 files). Full suite: `1 failed, 517
  passed` — the one failure is `test_screen_symbols_sends_grpc_call`'s exact-equality dict (`tests/test_client.py:277`),
  the RED Step 5 predicts.
- Files modified: `services/xstockstrat-agent/app/client.py`, `services/xstockstrat-agent/app/tools.py`
- Deviations: scratch-test TDD capture; strengthened clause grep; interim red until Step 5 — see Deviation Log.
  Out-of-scope changes: none. Open item: Step 6 must mirror this docstring in `docs/runbooks/mcp-tools.md` (C-10).

## Session 2026-10-28 — sdd-execute sequential, Step 5 (sdd-batch-execute)

### Step 5 — test: agent row shape carries `score_unavailable` (AC-5) [done]
- `services/xstockstrat-agent/tests/test_client.py` `test_screen_symbols_sends_grpc_call`: mocked response gains a
  second row `ScreenResult(symbol="BAD", passed=False, status=OK, score_unavailable=True)`; the NVDA exact-equality
  dict gains `"score_unavailable": False`; new asserts on `results[1]` (symbol BAD, `passed is False`,
  `score_unavailable is True`) and that every row's `score_unavailable` is a `bool`.
- TDD (AC-5): RED with `app/client.py` restored from `308eb7ae` (pre-Step-4) → `1 failed`, `AssertionError` at
  `tests/test_client.py:283` (`Right contains 1 more item: {'score_unavailable': False}`); GREEN on `HEAD` →
  `1 passed, 61 deselected`.
- Verification: `uv run pytest --cov=app --cov-fail-under=40` → `517 passed`, coverage 81.23% (Step 4's interim red
  closed; the 518 there included the deleted scratch test); `ruff check` clean; `ruff format --check` clean (58 files);
  C-13 grep → no output (BAD literal has one consumer, stays inline).
- Files modified: `services/xstockstrat-agent/tests/test_client.py`
- Deviations: RED against restored pre-Step-4 `client.py` — see Deviation Log. Out-of-scope changes: none.

## Session 2026-10-28 — sdd-execute sequential, Step 6 (sdd-batch-execute)

### Step 6 — docs: `docs/runbooks/mcp-tools.md` `screen_symbols` parity (C-10) [done]
- Return JSON NVDA row gains `"score_unavailable": false`; the `status` aside (same paragraph) gains the three
  `score_unavailable=true` row kinds (evaluation fault: status OK, `passed: false`; data-less hard-filter row:
  `passed: false`; data-less soft-only row, feature 144: `passed: true`), keeps "Filter candidates on `passed`", and
  adds the `min_conviction > 0` / `rank_limit` caveat (server log is the only trace); Errors table gains the
  per-symbol evaluation-fault row. Wording mirrors the Step 4 docstring (`app/tools.py:850-854`).
- TDD: N/A (docs). Pre-edit baseline: `grep score_unavailable docs/runbooks/mcp-tools.md` → no output (exit 1).
- Verification: `grep -n score_unavailable` → hits at `:449` (Return JSON), `:455` (aside), `:465` (Errors);
  `grep -n "evaluation fault"` → `mcp-tools.md:455,465` and `app/tools.py:851`.
- Files modified: `docs/runbooks/mcp-tools.md`
- Deviations: none. Out-of-scope changes: none.

## Session 2026-10-28 — sdd-execute sequential, Step 7 (sdd-batch-execute)

Tooling setup (steps 7): node v22.22.0 ✓ (CLAUDE.md pins 24) · pnpm ✓ 9.15.9 · `pnpm install --frozen-lockfile` ⬇ (worktree) · chromium ✓ `/opt/pw-browsers`

### Step 7 — service: `SymbolScreening` "Not evaluated" branch; screener tooltip copy (UI) [done]
- `SymbolScreening.tsx`: imports `EmptyState` (`@/components/shared/EmptyState`); `const unevaluated =
  result?.scoreUnavailable === true;` after `insufficient`; the result branch is three-way — `insufficient` (unchanged)
  → `unevaluated` (`<div data-testid="symbol-screen-unevaluated"><EmptyState title="Not evaluated" description=…/></div>`)
  → `DataTable` (unchanged). No colour classes added (C-17).
- `insights/screener/page.tsx`: `no-criteria-data` badge `title` copy only → "No criteria data could be used for this
  candidate (missing data or an evaluation fault) — its score is not a real result." Test id, label, logic unchanged.
- TDD (AC-4 shape, scratch spec mirroring Step 8): RED on the pre-Step-7 tree → `1 failed`, `expect(locator).toBeVisible()`
  on `symbol-screen-unevaluated` (element not found; the page snapshot shows the criterion `DataTable` instead);
  GREEN after the edit → scratch passed, plus `position-detail.spec.ts` + `insights/screener.spec.ts` 60 passed /
  3 failed (`:15`, `:44`, `:447`, pre-existing — same 3 fail on the baseline tree).
- Verification: grep → `SymbolScreening.tsx:18` (import), `:66` (`scoreUnavailable === true`), `:252`
  (`symbol-screen-unevaluated`); `no-criteria-data` → 1 hit (`page.tsx:262`); `pnpm run lint` exit 0;
  `format:check` red only on 10 untouched files; `tsc --noEmit` red only on untouched `e2e/insights/backfills.spec.ts:135-136`.
- Files modified: `services/xstockstrat-ui/src/components/trader/SymbolScreening.tsx`,
  `services/xstockstrat-ui/src/app/insights/screener/page.tsx`
- Deviations: scratch RED/GREEN spec; host harness flags; pre-existing format/tsc/e2e reds — see Deviation Log.
  Out-of-scope changes: none.

## Session 2026-10-28 — sdd-execute sequential, Step 8 (sdd-batch-execute)

Tooling setup (steps 8): node v22.22.0 ✓ (CLAUDE.md pins 24) · pnpm ✓ 9.15.9 · `pnpm install --frozen-lockfile` ⬇ (worktree) · chromium ✓ `/opt/pw-browsers` · Docker e2e runner ✗ (Docker Hub 429 → host harness)

### Step 8 — test: Playwright AC-4 on the position-detail Screening section; fixture catalog (UI) [done]
- `position-detail.spec.ts`: imports `noCriteriaDataRow` from `'../fixtures/screenResults'` (C-12); new test
  `a scoreUnavailable single-symbol result shows "Not evaluated" (bug fix, feature 245)` (`:222`) routes
  `**/xstockstrat.analysis.v1.AnalysisService/ScreenSymbols` → `{ results: [noCriteriaDataRow('AAPL')], coverageGaps: [] }`
  before `goto('/trader/positions/AAPL')`, clicks `run-symbol-screen`, asserts `symbol-screen-unevaluated` visible with
  "Not evaluated", `symbol-screen-results` / `symbol-screen-insufficient` count 0 (all scoped to `symbol-screening`).
- `INVENTORY.md:47`: consumer list gains the feature 245 `noCriteriaDataRow` "Not evaluated" case. No new fixture.
- TDD: RED with `SymbolScreening.tsx` restored from `47c2becf` → `1 failed`, `toBeVisible()` on
  `symbol-screen-unevaluated` (element not found). GREEN on `HEAD` → the new test passes.
- Verification: the two specs → 59 passed / 4 failed (`:16`, `:45`, `:324`, `:473`; all pre-existing, `:324` confirmed
  on the baseline spec); C-12 import grep → `:2` (`helpers/auth`), `:4` (`fixtures/screenResults`); `feature 245` →
  `INVENTORY.md:47`; `pnpm run lint` exit 0.
- Files modified: `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts`,
  `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`
- Deviations: RED via restored pre-Step-7 file; host harness (Docker 429); pre-existing e2e failures; pre-existing
  INVENTORY.md prettier warning — see Deviation Log. Out-of-scope changes: none.

## Session 2026-10-28 — sdd-execute sequential, Step 9 (sdd-batch-execute)

Tooling setup (step 9): none needed (docs-only).

### Step 9 — docs: sibling defect reports (readiness, opportunities gathers) [done]
- `docs/reports/2026-10-21-analysis-readiness-gather-no-per-symbol-isolation-defect.md` (+ `.status` = `open`): SEV-2,
  request-failure-amplification. `EvaluateReadiness` gathers `_readiness_for` with no `return_exceptions` and no
  per-symbol guard (`servicer.py:3983`, `:3911`, `:3939`); one raising symbol fails the RPC and drops the healthy
  symbols' `readiness_cache` upsert.
- `docs/reports/2026-10-21-analysis-opportunities-row-gather-no-per-symbol-isolation-defect.md` (+ `.status` = `open`):
  SEV-2. `_compute_opportunities` gathers `_row_for` (`:5776`), which catches only `grpc.RpcError` (`:5693`). It quotes
  feature 185's deliberate `FormulaExecutionError` propagation (`:5694-5698`) and records that feature 245 isolates
  `Exception` for the screener only; both callers (`:4807` kick, `:5897` daily refresh) swallow the abort, so one bad
  candidate leaves the user's whole queue stale/empty. Triage decides whether the 185 contract stands.
- Anchors read on the branch tip; `servicer.py` is identical to `origin/main-dev` @ 971983e2 (empty diff), so
  Environment cites that sha.
- TDD: N/A (docs).
- Verification: `ls` → all 4 files; `grep servicer.py:3983|:5776` → readiness `:31`, opportunities `:45`;
  sidecars → `open` ×2; `grep -oE 'SEV-[123]' | sort -u` → one `SEV-2` per report.
- Files modified: the 4 `docs/reports/2026-10-21-analysis-*-gather-no-per-symbol-isolation-defect.{md,status}` files.
- Deviations: `**Recorded**` 2026-10-28 vs spec-pinned 2026-10-21 filename date; written directly against the
  `defect-filing.md` template rather than an interactive `/sdd-qa defect` run — see Deviation Log.
  Out-of-scope changes: none.

## Session 2026-10-28 — sdd-execute sequential, Step 10 (sdd-batch-execute)

Tooling setup (step 10): none needed (docs-only).

### Step 10 — docs: resolve the findings row, constitution sort key, teardown [done]
- `services/xstockstrat-analysis/docs/context-constitution-findings.md:20`: title struck, `**RESOLVED (feature 245)**`;
  names `_eval_symbol_isolated` (`except Exception`, so `CancelledError` passes), the `eval_failed` degraded row
  (`status OK`, `passed=false`, `score_unavailable=true`, empty raws), the sort, the summary WARN/ERROR and the
  `screener.degraded_count` span attribute. Anchors re-stamped against the code: `screen` `:92`, gather `:115`,
  `_eval_symbol_isolated` `:239`, `_build_result` fail-closed branch `:485`.
- `services/xstockstrat-analysis/docs/context-constitution.md:42`: sort key → `(score_unavailable, eval_failed, -score)`
  plus one clause (evaluation-fault row sorts after a feature-144 row, feature 245). Code: `screener.py:173`
  `ranked.sort(key=lambda p: (p[0].score_unavailable, p[1], -p[0].score))`, `p[1]` = `row["eval_failed"]`.
- Teardown: context-forge `context-constitution` not loaded in this session (only `context-scrubber`), so reconciled by
  hand; fixed UI-6 drift in `services/xstockstrat-ui/docs/context-constitution.md:26` (anchor `:64` → `:65`, evaluation-fault
  clause). See Deviation Log. The integration PR body must record both the unavailability and this reconciliation.
- TDD: N/A (docs).
- Verification: `grep "RESOLVED (feature 245)"` → findings `:20`; `grep eval_failed` → constitution `:42`.
- Files modified: the two analysis docs above + `services/xstockstrat-ui/docs/context-constitution.md`.
- Deviations: manual teardown; UI constitution outside **Files** — see Deviation Log. Out-of-scope changes: none beyond
  that sanctioned teardown fix.
- All 10 steps done → status `code-completed` (separate commit). Open: defect report
  `docs/reports/2026-10-19-analysis-screener-no-per-symbol-isolation-defect.status` stays `triaged` until launch;
  completion obligations (feature-250 alerting handoff, C-16 promotion, dev smoke test) are the integration session's.

