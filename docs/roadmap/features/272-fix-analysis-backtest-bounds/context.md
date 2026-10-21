# Context Log: fix-analysis-backtest-bounds

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-analysis-backtest-bounds-defect.md` (Issues disabled);
  sidecar `triaged` / `ref: feature:272-fix-analysis-backtest-bounds`.
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-28, D-29.
- Severity: SEV-2 (group). Impact type: silent-partial-backtest-data. Environment: dev (main-dev) @ a053b0e.
  Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..3), context.md.
- Affected services: xstockstrat-analysis (fix site), xstockstrat-config (seeded key; migration only if retired).
- Root cause hypothesis: D-28 guard does not tell EOF from a re-served page by whether a token was sent; D-29 key
  seeded in the first config migration with no implementation.
- Re-verification on a053b0e: both D-ids reproduce by reading; no line drift.
  - D-28: `servicer.py:1432-1435` (unchanged); docstring `:1394-1412`; `_MAX_BAR_PAGES = 32` `:298`,
    `_BAR_PAGE_SIZE = 1000` `:294`. **Test that locks the bug in:** `tests/test_warmup.py:236-243`
    (`test_identical_page_with_identical_token_terminates` asserts `[1, 2]`). The fix must invert it to expect
    `_BarFetchError` — a deliberate test change, not a regression (record in design per C-18).
  - D-29: `001_config_tables.up.sql:69`, `002_config_environment.up.sql:71`, analysis `CLAUDE.md:468` (all unchanged);
    0 readers in `app/`; screener's own key read at `servicer.py:3786` (unchanged); `RunBacktest` at `:785`, no
    `wait_for`. `docs/reports/2026-08-07-config-governance-audit.md` also mentions the key (historical).
- **Overlaps:**
  - `244-fix-python-config-stored-zero` (implementation-ready) changes the analysis getters. If D-29 wires the key,
    read it presence-aware so a stored 0 is not silently replaced (or clamp 0 = no limit explicitly), and rebase on 244.
  - `docs/reports/2026-10-19-dead-config-keys-defect.md` (`open`) does not list this key; if design retires it, note
    the addition there or in its eventual feature to avoid a second retirement.
  - No feature in 240–253 touches `_fetch_bars_paged` or `RunBacktest`'s deadline.
  - `strat-lab` plugin: if `run_backtest` gains a new failure mode (truncation error or `DEADLINE_EXCEEDED`), root
    CLAUDE.md requires the `backtest` skill update in the same PR (`docs/patterns/strat-lab-plugin.md`).
- Recommended design depth: full → `/sdd-design fix-analysis-backtest-bounds` (rationale: 2 affected services and a
  possible config migration — the C-0 full trigger). Design fork for D-29: wire `asyncio.wait_for` (and the
  production 120 s value then becomes live — check current backtest durations on dev first) vs retire the key.
- Development branch: feature/fix-analysis-backtest-bounds

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (0 fails, 0 floor breaches).
  Overlap verdict: WARN (no FAIL).
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-28, D-29.
- Warnings (for /sdd-design):
  - OQ-1 (enforce vs retire the backtest duration key) stays open, owned by /sdd-design. Default is enforce (FR-3
    stands). Record the resolution here at design time. If design picks retire, rewrite FR-3 and @AC-3 before
    /sdd-spec (C-11).
  - FR-3 leaves a value <= 0 (reject vs "no limit") to design. Add an @AC scenario for whichever choice is made.
  - FR-3 "a message naming the limit": @AC-3 says "names the 1 second limit". Pin the exact message string at design.
  - @AC-3 is timing-sensitive (3 s evaluation, 2 s bound). Design must pin how the delay is injected (a fake clock or
    a stubbed evaluator) so the regression test is not flaky.
  - Coverage gap (resolved in this session): added @AC-4. A token-bearing request that returns an empty page is a loud
    failure (FR-1). It is distinct from an empty first page, which is EOF (FR-2).
  - Consumer surface: the spec does not say whether a UI/agent message exists for DEADLINE_EXCEEDED. Settle this at
    design, and update the strat-lab `backtest` skill in the same PR (docs/patterns/strat-lab-plugin.md).
  - The prod value of 120 s (`002_config_environment.up.sql:71`) first takes effect on enforce. Before launch, check
    dev backtest durations against it.
- Overlap findings (WARN only):
  - `servicer.py` RunBacktest (`:785`) / `_fetch_bars_paged` (`:1394-1446`) is shared with 244
    `fix-python-config-stored-zero` (implementation-ready). FR-3 depends on 244's presence-aware getter, so 244 merges
    first or this feature rebases on it.
  - Shares the RunBacktest region and the `_fetch_bars_paged` pager precedent with 215
    `fundamentals-blend-strategy-restrictions` (in-progress, live overlap).
  - Shares `servicer.py` with 245 `fix-screener-symbol-isolation` (screener deadline `:3786`, which FR-3 mirrors).
    FR-3 must not edit the screener block.
  - 274 `otel-metrics-logs-export` (spec-ready) cites `servicer.py:799-800` inside RunBacktest. Re-check at impl-spec.
  - `tests/test_analysis_servicer.py` is shared with 244 and 215, but no test case is shared. No other active feature
    names `tests/test_warmup.py`.
  - Config key `analysis.backtest.max_duration_seconds`: no active feature defines or edits it.
  - Migration 033 is free in every active spec (needed only under retire). Separately, 032 is double-claimed by 244
    and 248, a FAIL between those two features that does not involve this one. Flagged to the router.
  - Merge-order (router-owned proposal): add a Blocking Dependencies row "fix-analysis-backtest-bounds blocked by
    fix-python-config-stored-zero (244)". Consider also blocking on 215 for the RunBacktest region.
