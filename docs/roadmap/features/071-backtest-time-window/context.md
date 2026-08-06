# Context: backtest-time-window  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: The `run_backtest` MCP tool now accepts optional `start`/`end`, mapped onto the pre-existing `RunBacktestRequest.range` field the UI already used — the proto layer needed nothing new. The real work was a declared (not observed) per-strategy pre-window warm-up prefix, bounded pagination, and an explicit `trade_start_idx` threaded through both backtest loops, so results are deterministic across calendar days and true out-of-sample windows became possible (product-spec.md:9-14).
**Why (irrecoverable rationale)**: The original story's proto-change premise was falsified by `/sdd-review` — `TimeRange range` already existed and was already honored end-to-end (feature.md:18, context.md:24-35). Fail-loud on insufficient pre-window history was deliberately kept even after discovering the UI's default date range would now fail more often, because the reported `CoverageGap` names the exact actionable backfill span and the UI already auto-fills it (context.md:328-349).
**Rejected alternatives**:
- `WARMUP_PREFIX_DAYS = 365` constant — F-07 breach; its `p >= w` check is inert for EMA/MACD/VWAP (design.md:185-188). [DUP:docs/roadmap/ledger/insights.md:179]
- `analysis.backtest.warmup_prefix_days` config key — would clear F-07 but keeps a behavior-determining knob and inherits the `get_int` zero-trap (`watcher.py:68-74`: configured `0` reads back as default, so "no prefix" is inexpressible); deriving keeps one source of truth per product-spec OQ-2 (design.md:189-192).
- Prefixing the *defaulted* (no-`start`) range — rejected because it would need `730 + prefix` days of history, flipping ordinary ~2-year-backfilled symbols to `INSUFFICIENT_DATA`, a direct FR-2 violation. Only the resulting `warmup_prefix=start_set` snapshot is visible in shipped code (design.md:193-194; context.md:68-69).
- Forcing `warmup_bars = 0` and slicing in the caller — orphaned 3 live UI surfaces, no compile-time protection (design.md:195-197). [DUP:docs/roadmap/ledger/insights.md:193]
- `period` as EMA/MACD prefix — ~13.5% seed contamination; `3×` multiplier adopted, cost is discarded fetch volume (design.md:198-201).
- `max_range_days`-derived pagination page cap — "self-scaling and hazard-free, but adds a config read to a low-level fetch helper"; fixed `_MAX_BAR_PAGES = 32` fail-loud judged simpler and sufficient once exhaustion raises (design.md:202-204).
- Empty-token pagination probe (design round 2) — proved dead code: `QueryBars` runs `LIMIT pageSize+1` and only sets a token on the extra row, so a full page with an empty token is always genuine EOF; also mis-specified — a naive `isoformat()` token is rejected by `time.Parse(RFC3339Nano, …)`, silently re-serving page 1. Not visible in the shipped `_fetch_bars_paged` docstring, which documents only the chosen mechanism (design.md:127-131; context.md:96-99).
- Short-warm-and-report (non-fatal `CoverageGap`) — rejected twice, at design and again post-hoc, favoring fail-loud (context.md:328-333).
**Scars & gotchas**:
- Design's own loop-restructure arithmetic was off by one: `diags[k:]`/`bars_total=n-k`/`len(daily_equity)==len(diags)` can't jointly hold without conditioning the seed row on `trade_start_idx==0` — caught only by writing k>0 tests before shipping (context.md:173-200).
- Implemented on harness-assigned branch `claude/features-070-071-rnbkqo` (rebased onto `main-dev`) rather than `feature/backtest-time-window`, so 070 and 071 shared one branch/PR (context.md:48-50).
**Permanent deviations**: none — `trade_start_idx` was designed as an explicit parameter (design.md:77-90) but became derived at step 4 once the prefix was wired through, a within-feature refinement not a contradiction (context.md:214-216).
**Cross-feature signal**: feature 072 kept `client.run_backtest` intact and split logic in `tools.py`, so it never needed to invert `tests/test_tools.py:535-577` as predicted (feature.md:68-70).
**Deferred follow-ons**:
- FR-7 backtest/live parity gap open: `live_loop.py` keeps its own window with no shortfall detection; `3×` multiplier narrows but doesn't close divergence (design.md:164-169, context.md:279-282).
- Custom-formula sandbox cost under longer prefixed series flagged as ongoing watch item (design.md:214).
- VWAP anchor-shift special-case was proposed and rejected — would need a second indicators call and diverge further from the live loop; documented behavior change only, no fix planned (design.md:178-179, §7).
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none — FR-7 parity gap and VWAP anchor shift already live in the analysis service's own CLAUDE.md per context.md:298-304.
**Pruned artifacts**: product-spec.md, recon.md, design.md — last present at f871138.
