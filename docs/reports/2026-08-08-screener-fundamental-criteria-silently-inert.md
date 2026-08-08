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

## Tests added

- `services/xstockstrat-analysis/tests/test_screener.py`:
  `test_fundamentals_unavailable_yields_insufficient_data` (replaces the old test that asserted
  the buggy OK/passed=true behavior), `test_fundamentals_unavailable_bails_even_for_rank_only_criteria`,
  `test_fundamental_hard_filter_missing_for_one_symbol_fails_closed`.
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py`:
  `test_fundamental_unavailable_yields_insufficient_data_not_a_silent_pass` (same fix, at the
  servicer layer, replacing the prior assertion of the buggy behavior).

## Not in scope

- Diagnosing *why* `GetFundamentalsMulti` itself was failing in the `staging` environment (likely
  a missing/invalid `FMP_API_KEY` secret, or FMP quota) — that is an infrastructure/secrets
  concern, not a code defect, and is outside this PR.
- The UI (`services/xstockstrat-ui/src/app/insights/screener/page.tsx`) needed no change: it
  already renders the existing per-row "Insufficient data" badge (`status !==
  SCREEN_RESULT_STATUS_OK`) and already leaves the Passed column blank for `passed=false` rows —
  once the backend reports the correct status/passed, the existing UI surfaces it with no changes.
