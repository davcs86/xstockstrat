# Screener Criteria Have No Effect When Fundamentals Are Unavailable — 2026-08-08

**Status: fixed in this report's companion PR** (`claude/screener-criteria-filtering-7ydsuz`).
GitHub Issues are disabled on this repo, so this report is the audit trail per
`docs/runbooks/bug-triage.md` Track C (SEV-3 — UI/UX-facing, no trading-path dependency).

## Report

User-reported: the Insights → Screener page's criteria "doesn't seem to work at all" — no matter
which fundamentals indicator or value is selected, the results table is unchanged.

## Root cause

Reproduced directly against `xstockstrat-analysis`'s `ScreenSymbols` RPC (via the `screen_symbols`
MCP tool) on the `staging` deployment: a single hard-filter criterion
(`pe_ratio < 20, hard_filter=true`) against `AAPL`/`MSFT`/`GOOG` returned every symbol with
`score: 0.5`, `criterion_scores: {}`, and `passed: true` — the criterion had literally zero effect,
even though `marketdata.fmp.enabled` reads `true` in that environment. A parallel technical-
indicator criterion (`RSI`) scored and ranked normally, isolating the defect to the fundamentals
path specifically, not the screener in general.

`services/xstockstrat-analysis/app/services/screener.py`'s `_fetch_fundamentals` calls
marketdata's `GetFundamentalsMulti`; when that RPC errors — FMP disabled, quota-exhausted, or (as
in this case) the FMP call itself failing, most likely a missing/invalid `FMP_API_KEY` secret in
the environment even though the config gate is on — it caught the `grpc.RpcError` and returned
`fundamentals_available=False`. By design (feature 060 FR-5 "graceful degradation"), every
fundamental criterion was then silently dropped from `criterion_scores` for every symbol. But the
result still reported `status=SCREEN_RESULT_STATUS_OK` and `passed=true` unconditionally — a
skipped hard-filter criterion was never checked, so `passed` stayed at its default `True`, and a
symbol with zero evaluated criteria fell back to a neutral `score=0.5`. The response was
**indistinguishable from "every candidate genuinely passed a real filter"**, which is why the
results table looked frozen regardless of what the user picked: for as long as fundamentals
stayed unavailable, every fundamental criterion — any metric, any threshold, hard or rank-only —
was a total no-op, and the UI had no way to tell the two cases apart.

The bug is the missing-data path, not the FMP outage itself (an unset/invalid `FMP_API_KEY` or an
exhausted quota is an infrastructure/secrets concern outside this PR's scope) — a screener must
never report a candidate as having passed a filter it never actually evaluated.

## Fix

`screener.py`:
- `_eval_symbol` now bails the same way the existing bars-insufficient-data path already does:
  when any requested criterion is `SCREEN_KIND_FUNDAMENTAL` and the batch fundamentals fetch
  failed/was disabled, the symbol is reported `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA`
  (`passed=false`, no score) instead of `OK`/`passed=true`. No `CoverageGap` is attached — that
  message is bars-specific — so `coverage_gaps` (filtered via `HasField("gap")`) stays exactly the
  bars-backfill signal it always was.
- `_build_result`'s per-criterion loop now fails a hard-filter criterion closed (`passed=false`)
  whenever its raw value is missing for any reason — including the narrower case where
  fundamentals *were* fetched for the batch but a specific symbol's value is still absent (e.g.
  the source omitted that symbol). That symbol's `status` stays `OK` (it isn't a whole-batch
  outage), but its hard filter is no longer silently treated as passed.

No proto change was needed — `ScreenResultStatus.INSUFFICIENT_DATA` already existed and
`criterion_scores`'s "skipped criteria are absent" contract was already documented; the fix is
entirely in how the existing fields are populated. `docs/runbooks/mcp-tools.md`'s `screen_symbols`
reference and the agent tool's own docstring were updated to describe the corrected contract.

**Follow-up (same PR): tell the two `INSUFFICIENT_DATA` causes apart in the UI.** A user asked
whether the Screener could at least show that fundamentals will be available later, or notify them
once populated. Screener scans aren't persisted, so there's no state to notify against without new
infrastructure (out of scope here — see below); but the backend fix above already produces a clean
signal the frontend can use for free: a fundamentals-unavailable result never carries a `CoverageGap`
(that message is bars-specific), while a bars-insufficient result always does. `screener/page.tsx`
now branches on `!r.gap` to render a distinct "Fundamentals pending" badge (vs. the generic
"Insufficient data" for the bars case) plus a summary banner ("Fundamentals data isn't available
right now for N of M symbols — re-run this scan later"), so the page no longer looks silently
frozen and gives the user an accurate, actionable next step (re-run later) instead of implying a
backfill is possible.

## Tests added

- `services/xstockstrat-analysis/tests/test_screener.py`:
  `test_fundamentals_unavailable_yields_insufficient_data` (replaces the old test that asserted
  the buggy OK/passed=true behavior), `test_fundamentals_unavailable_bails_even_for_rank_only_criteria`,
  `test_fundamental_hard_filter_missing_for_one_symbol_fails_closed`.
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py`:
  `test_fundamental_unavailable_yields_insufficient_data_not_a_silent_pass` (same fix, at the
  servicer layer, replacing the prior assertion of the buggy behavior).
- `services/xstockstrat-ui/e2e/insights/screener.spec.ts`: new spec asserting the
  "Fundamentals pending" badge + banner render (and the generic "Insufficient data" badge does
  *not*) for a `gap`-less `INSUFFICIENT_DATA` result, distinguishing it from the existing
  bars-insufficient spec (which does carry a `gap`).

## Not in scope

- Diagnosing *why* `GetFundamentalsMulti` itself was failing in the `staging` environment (likely
  a missing/invalid `FMP_API_KEY` secret, or FMP quota) — that is an infrastructure/secrets
  concern, not a code defect, and is outside this PR.
- **Notify-when-populated.** Persisting a pending scan's symbols/criteria and pushing an
  in-app/`xstockstrat-notify` alert once fundamentals for those symbols are actually cached would
  need real new infrastructure — durable scan state, a way to detect "now available" and match it
  back to the pending scan, and a delivery channel — none of which exists today (screener scans are
  intentionally stateless, feature 060 FR-9). That's new capability, not a bug fix, so per root
  `CLAUDE.md`'s SDD entry-point rule it needs `/sdd-story` + `/sdd-design` first rather than being
  built ad hoc in this PR.
