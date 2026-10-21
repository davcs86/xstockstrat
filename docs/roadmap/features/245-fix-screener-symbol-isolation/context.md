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
