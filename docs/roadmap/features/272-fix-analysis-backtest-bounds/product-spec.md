# Product Spec: fix-analysis-backtest-bounds

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-analysis-backtest-bounds-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

**Observed.**

- **D-28.** `_fetch_bars_paged` (`services/xstockstrat-analysis/app/handlers/servicer.py:1394-1446`) documents that a
  partial series is never returned silently and that a re-served page becomes a loud failure. Instead, a page that adds
  no strictly-newer bar returns the bars so far (`:1432-1435`), even when the request carried a page token. A stuck
  marketdata token therefore yields only the first page to every caller (`:1464`, `:1472`, `:1924`, `:1926`, `:1955`,
  `:4961`, `:5570`). `tests/test_warmup.py:236-243` asserts this truncated result.
- **D-29.** `analysis.backtest.max_duration_seconds` is seeded (`services/xstockstrat-config/migrations/001_config_tables.up.sql:69`
  = 300, `002_config_environment.up.sql:71` = 120 prod) and documented (`services/xstockstrat-analysis/CLAUDE.md:468`),
  but no code in `app/` reads it. `RunBacktest` (`servicer.py:785`) has no deadline.

**Expected.** A re-served page on a token-bearing request raises `_BarFetchError`, while genuine EOF still returns. The
backtest wall-clock key is either enforced by `RunBacktest` (`DEADLINE_EXCEEDED` when exceeded) or retired by a config
migration and removed from the docs.

**Who is affected.** Traders and analysts who run backtests (`/insights` backtest view, the symbol-page backtest, the
agent `run_backtest` tool and the `strat-lab` plugin): results can silently omit the most recent bars. Operators who
set the backtest duration limit through `/config-ui` or `set_config`: the setting has no effect.

## Reproduction Steps

1. Pages `[bar 1, bar 2]` with token `"stuck"`, repeated. `_fetch_bars_paged` returns `[1, 2]` without error.
2. `grep -rn "backtest.max_duration_seconds" services/xstockstrat-analysis/app` → none. Set it to 1; a backtest
   longer than 1 s still completes.

## Root Cause Hypothesis

D-28: the guard treats "no fresh bars" as terminal without checking whether a token was sent. D-29: a seeded key with
no implementation. See the report.

## Affected Services

- xstockstrat-analysis (fix site)
- xstockstrat-config (owns the seeded key; a migration only if design retires it)

## Fix Scope

- [x] No proto changes anticipated
- [ ] No database migrations anticipated — retiring D-29's key needs a new config migration; wiring it needs none
- [ ] No config key changes anticipated — D-29 either starts reading `analysis.backtest.max_duration_seconds` or retires it

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Marketdata's `cursor = start` fallback on an unparseable page token (the server-side cause of a re-served page)
- The zero-value getter trap for this key (feature 244); if D-29 wires the key, read it presence-aware
