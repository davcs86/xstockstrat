# Context: screener-engine  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped as an on-demand `ScreenSymbols` RPC on `xstockstrat-analysis` that ranks a symbol universe against formula/signal/fundamental criteria, sharing scoring math with `RunBacktest` via a newly-extracted pure module, plus an insights `/screener` page — landed stacked on 059 (fundamentals-data-source) with fundamentals live from day one rather than degraded.
**Why (irrecoverable rationale)**: Platform lead mandated hard isolation — screener must never touch `RunBacktest`/live-strategy behavior — which drove extracting `_backtest_symbol`'s inline weight-combination math (`servicer.py:449-459`, pre-refactor) into `app/services/scoring.py` rather than importing it in place, so a bug in screener math structurally cannot regress backtest (context.md Session 2026-06-26). Fundamentals were deliberately kept out of the indicators sandbox namespace (product-spec.md:71) to preserve the sandbox's exact backtest-parity contract (FR-3).
**Rejected alternatives**:
- `watchlist_id` convenience param on the request — deferred (OQ-060-a) to keep analysis free of a new dependency on the watchlist/portfolio layer; UI/agent resolves symbols instead (product-spec.md:150-151).
- Persisted "saved screens" table — deferred (OQ-060-b) to keep v1 stateless like backtest results (product-spec.md:152-153).
- Streaming/continuous screening — explicitly out of scope; on-demand request/response chosen per platform-lead modality decision (product-spec.md:24-25, 68).
**Scars & gotchas**:
- Spec assumed analysis called `ExecuteFormula` already; reality was `ComputeIndicator`/`GetFormula` — the screener's `ExecuteFormula` call was a **net-new outbound RPC**, triggering the header-propagation gate analysis hadn't needed before (context.md:52-54, Session 2026-06-27 sdd-spec).
- Golden-regression intent ("pin pre-refactor `RunBacktest` output") couldn't be run as a literal before/after diff inside the execute session — realized instead as frozen-value tests on the extracted pure functions plus the full pre-existing suite passing unchanged (implementation-spec.md:519-527).
- E2E spec/mock were authored but **could not be run to completion** in the execute container — Playwright's dev webServer wouldn't bind within 60s after apt/Playwright-Firefox churn; committed per user direction (retry-once-then-commit) verified only by `tsc`+`next lint`, needs a real run in a stable env (context.md:105-111).
- New page shipped without sidebar nav registration — root-caused and already captured as [DUP:docs/roadmap/ledger/fails.md:41] (060-screener-engine — assumption), not re-added here.
**Permanent deviations**: - FR-5 spec said fundamental criteria degrade via a compile-time `hasattr` capability check (059 might not exist yet) -> shipped calling `GetFundamentalsMulti` unconditionally and degrading to "skipped" only on `RpcError` -> because 060 ended up stacked on 059 so the proto was always in ancestry, making a compile-time skip moot (context.md:113-116).
**Cross-feature signal**: - Second confirmed instance (after 058) of a shipped UI page/route omitting shared-nav registration because the vertically-scoped feature spec never referenced the horizontally-owned `PLATFORM_SUBNAV` — already promoted to rule C-10(a) [DUP:docs/roadmap/ledger/fails.md:42-44].
**Deferred follow-ons**:
- `watchlist_id` request param (OQ-060-a).
- Persisted saved-screens table, `analysis.screens` (OQ-060-b).
- Historical as-of scanning via the reserved `evaluation_window` field (OQ-060-e).
- Re-run `pnpm test:e2e -- screener` in a stable environment to actually execute the authored E2E spec.
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f871138.
