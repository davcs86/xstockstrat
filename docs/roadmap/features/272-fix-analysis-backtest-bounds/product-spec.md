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

## Functional Requirements

- **FR-1 (D-28).** When `_fetch_bars_paged` requests a page with a non-empty `page_token` and the response adds no
  bar strictly newer than the last bar already collected, it raises `_BarFetchError` ("refusing to return a truncated
  series") and returns no series. Every caller listed above inherits the error instead of a first-page-only series.
  The existing `tests/test_warmup.py::test_identical_page_with_identical_token_terminates` (`:236`) is inverted to
  expect the error. That is a deliberate test change, not a regression (C-18).
- **FR-2 (D-28).** A genuine end of data still returns the full collected series without error: an empty first page,
  or a response whose `next_page_token` is empty.
- **FR-3 (D-29, enforce, the proposed default under OQ-1).** `RunBacktest` reads
  `analysis.backtest.max_duration_seconds` (an integer number of seconds) at call time and bounds the backtest's
  wall-clock run by it. When the run exceeds it, the RPC aborts with gRPC `DEADLINE_EXCEEDED` and a message naming
  the limit, matching the screener's existing deadline (`analysis.screener.max_duration_seconds`, `servicer.py:3786`).
  The read is presence-aware per feature 244: a stored value is honored, and only an absent key falls back to the
  documented default `300`. Design fixes how a value ≤ 0 is treated (reject, or "no limit") and records that choice.
  If design instead picks "retire", FR-3 and @AC-3 are rewritten before `/sdd-spec`. See OQ-1.

## Consumer Surface(s)

Behavior visible to traders and operators changes, so C-14 applies:

- **Backtest callers:** the `/insights` backtest view, the symbol-page backtest, the agent `run_backtest` MCP tool,
  and the `strat-lab` plugin's `backtest` skill. A re-served page now fails the backtest loudly instead of producing
  results on truncated data (FR-1). A run that exceeds the limit now ends with `DEADLINE_EXCEEDED` (FR-3). Per root
  `CLAUDE.md` and `docs/patterns/strat-lab-plugin.md`, the `backtest` skill must document both new failure modes in
  the same PR.
- **Operators:** setting `analysis.backtest.max_duration_seconds` through `/config-ui` or the agent `set_config` tool
  now changes backtest behavior. Before the production value of 120 s takes effect, design must check current dev
  backtest durations against it.

## Fix Scope

- [x] No proto changes
- [x] No database migrations under the proposed default (enforce). Retiring the key (the OQ-1 alternative) would
  require a new `services/xstockstrat-config/migrations/NNN_*.up.sql`/`.down.sql` pair. The next free number is 033:
  the trunk tip is 030, 031 is claimed by feature 243, and 032 is reserved for a peer.
- [x] No new config keys. The existing `analysis.backtest.max_duration_seconds` gains its first reader (FR-3). Its
  name, type and seeded values are unchanged.

## Open Questions

- **OQ-1 (owner: `/sdd-design`, due before `design-approved`). Should D-29 enforce the key or retire it?** The spec
  proposes **enforce**. The key is seeded in both environments and documented as a live limit, the screener already
  enforces the same pattern, and enforcing needs no migration. The **retire** alternative would remove the key with
  config migration 033 (up and down files, run after 031 and 032) and drop it from the analysis `CLAUDE.md` key
  table, which also keeps it out of `docs/reports/2026-10-19-dead-config-keys-defect.md`. If design chooses retire,
  FR-3 and @AC-3 must be rewritten to a single retirement outcome, and the change recorded in `context.md`. The
  question is not left unresolved by default: absent a design decision to the contrary, FR-3 stands as written.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Marketdata's `cursor = start` fallback on an unparseable page token (the server-side cause of a re-served page)
- The getter-wide zero-value trap (feature 244). This feature only reads its one key presence-aware (FR-3) and rebases
  on 244.
- The screener deadline (`analysis.screener.max_duration_seconds`) and its behavior; FR-3 aligns with it but does not
  change it
- Per-caller retry or fallback logic in the `_fetch_bars_paged` callers; they only inherit FR-1's error
