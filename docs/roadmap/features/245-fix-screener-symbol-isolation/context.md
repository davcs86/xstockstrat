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
