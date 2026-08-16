# Defect: Screener fundamentals comparator treats a missing metric as a real zero

**Recorded**: 2026-08-16
**Severity**: SEV-2
**Impact type**: incorrect-hard-filter-pass
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-analysis, xstockstrat-marketdata
**Config-only fix possible**: no

## Observed

`ScreenSymbols`'s fundamental criteria (`screener.py`) compared a symbol's raw fundamentals
value against a threshold using the requested comparator (`lt`/`lte`/`gt`/`gte`/`between`)
without ever checking whether the provider actually supplied that value. For any of the 11
closed `_FUNDAMENTAL_FIELDS` (`pe_ratio`, `market_cap`, `dividend_yield`, `debt_to_equity`,
…), a value the active provider never fetched — the metric tier was off (FMP `core`-only),
or the provider's response simply omitted the key for that symbol — arrived at the
comparator as the wire-format default `0.0`, indistinguishable from a genuine `0.0` (e.g. a
zero-debt company's `debt_to_equity`, or a non-dividend-payer's `dividend_yield`). A
hard-filter criterion using `lte`/`lt` against a positive threshold then evaluated
`0.0 <= threshold` and silently reported `passed=true` for a symbol whose metric was never
actually evaluated — the opposite of the fail-closed contract the 2026-08-08 companion
defect (`2026-08-08-screener-fundamental-criteria-silently-inert.md`) established for the
whole-batch-unavailable and whole-symbol-missing cases. This is a distinct, narrower gap
that report did not cover: a *known* field present for the symbol but individually null.

## Expected

A fundamental criterion whose raw value the provider never actually supplied must never be
reported as passing (or scored). It should be skipped exactly like any other missing raw
value (dropped from `criterion_scores`, and a `hard_filter` criterion fails closed), the
same treatment `_build_result`/`_eval_symbol` already apply when a symbol is entirely absent
from `GetFundamentalsMulti`'s response.

## Reproduction

1. Configure `marketdata.fundamentals.provider` to a provider whose response omits one of
   the closed fields for some symbol (e.g. FMP with `marketdata.fmp.metrics=core` omits
   `dividend_yield`/`pb_ratio`/`roe`/`debt_to_equity`/`beta`; or the live Finnhub response for
   a smaller-cap symbol commonly omits several `/stock/metric` keys).
2. Run `ScreenSymbols` with a hard-filter criterion `metric_name="dividend_yield",
   op=COMPARATOR_LTE, threshold=<any positive value>` against that symbol.
3. Before the fix: the result reports `status=OK`, `passed=true` — indistinguishable from a
   symbol whose dividend yield was genuinely `0`.

## Evidence

`services/xstockstrat-analysis/app/services/screener.py:378-386` (pre-fix)
> ```python
> if metric_name in _FUNDAMENTAL_FIELDS:
>     return float(getattr(fund, metric_name))
> ```
> Unconditional read — can never return `None` for a known field, so the existing
> fail-closed guard at `screener.py:441-448` (`if c.ref_name not in row["raws"]:
> ... if c.hard_filter: passed = False`) never triggers for this case.

`packages/proto/marketdata/v1/marketdata.proto:162-176` (pre-fix) — the 11 metric fields
were plain `double` with no presence tracking, so a genuinely-absent value was
indistinguishable on the wire from a real `0.0`.

`services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:272-277` (pre-fix)
> ```go
> deref := func(p *float64) float64 {
>     if p == nil {
>         return 0
>     }
>     return *p
> }
> ```
> Collapsed a genuine SQL `NULL` (the columns are nullable) straight to `0.0`, even though
> the scan two lines above (`GetFundamentals`) deliberately used `*float64` to detect NULL.

`services/xstockstrat-marketdata/internal/fmp/fmp_client.go` and
`internal/finnhub/finnhub_client.go` (pre-fix) — both providers' JSON response structs used
plain `float64` fields, so a JSON key the provider omitted decoded to Go's zero value
instead of leaving the field absent.

## Root cause hypothesis

The wire contract (`marketdata.proto`'s `Fundamentals` message) never distinguished a
genuinely-missing metric from a real `0.0`, and every layer between the provider's HTTP
response and the screener's comparator (Go JSON decode → DB round-trip → proto assembly →
Python read) independently collapsed "absent" to `0.0` along the way — so by the time
`_fundamental_value` read the field, the null information was already gone. The screener's
own fail-closed logic (added by the 2026-08-08 fix) was correct but could only ever fire for
the cases it could detect (whole-batch outage, whole-symbol absence); it had no signal for a
present symbol's individually-null known field.

## Confidence

high — reproduced the defect mechanism by tracing the exact code path end to end (Go
decode → repo → proto assembly → Python comparator) and confirmed via a new regression test
(`test_fundamental_hard_filter_missing_field_fails_closed_not_lte_zero`,
`services/xstockstrat-analysis/tests/test_screener.py`) that failed before the fix and
passes after.

---

**Status: fixed in this report's companion PR** (`claude/null-fundamentals-ohlcv-gaps-l2v4x5`).

## Fix

Rather than switching the 11 affected proto fields to `optional` (which `buf breaking`
correctly flags as an API-cardinality-changing breaking change requiring the 2-owner +
platform-lead proto approval this session does not have), the fix is fully additive:

- `marketdata.proto`'s `Fundamentals` message gains `repeated string missing_metrics = 18` —
  the canonical snake_case names (matching `market_cap`, `pe_ratio`, … verbatim) of any of
  the 11 known fields the active provider did not supply for this symbol. The 11 fields
  themselves keep their existing plain-`double` wire shape (unchanged, non-breaking).
- `source.Fundamentals` (the Go-internal, provider-agnostic model) changes its 11 metric
  fields from `float64` to `*float64` — a nil pointer means genuinely absent. This is an
  internal type, not the wire contract, so it carries no proto-breaking risk.
- `internal/fmp/fmp_client.go` and `internal/finnhub/finnhub_client.go`: the JSON response
  structs' metric fields become `*float64`, so an omitted/`null` JSON key decodes to `nil`
  instead of Go's `0.0` zero value; a genuinely-present `0` still decodes as present.
- `internal/repository/marketdata_repo.go`: `GetFundamentals`'s `deref` helper (which
  collapsed a real SQL `NULL` to `0.0`) is removed — the already-nullable-scanned locals
  pass straight through.
- `internal/service/marketdata_service.go`'s `toProtoFundamentals` derives `missing_metrics`
  from exactly the nil pointers, while still writing `0.0` to the plain-double wire field for
  backward compatibility with any consumer that doesn't check `missing_metrics` yet (that
  consumer gets the pre-fix behavior, unchanged — not a regression).
- `services/xstockstrat-analysis/app/services/screener.py`'s `_fundamental_value` checks
  `metric_name in fund.missing_metrics` before reading a known field, returning `None` (which
  routes through the existing fail-closed `_eval_symbol`/`_build_result` logic) instead of
  the field's wire-default `0.0`.

## Tests added

- `services/xstockstrat-marketdata/internal/fmp/fmp_client_test.go`:
  `TestGetFundamentals_MissingFieldStaysNil`
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client_test.go`:
  `TestGetFundamentals_MissingFieldStaysNil`
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go`:
  `TestToProtoFundamentals_MissingMetrics`
- `services/xstockstrat-analysis/tests/test_screener.py`:
  `test_fundamental_hard_filter_missing_field_fails_closed_not_lte_zero`

## Not in scope

- The best-effort `row["pe"]` raw display column in `screener.py` (`_eval_symbol`) still
  reads `pe_ratio` directly without checking `missing_metrics` — it is documented as a
  best-effort UI display value, not a filter/scoring input, and was already tolerant of a
  `0.0` reading meaning "unknown" before this fix.
- `fundamentals_scoring.py` / `fundsignal_loop.py` (feature 062/063) pass a fundamentals dict
  into a user-authored sandboxed formula rather than a fixed `analysis_pb2.COMPARATOR_*`
  comparator — there is no built-in `lte` comparison there for this fix to correct; a formula
  author who wants presence-awareness can already check for the metric's absence via
  `missing_metrics` if the caller threads it through, but that is a formula-authoring concern
  outside this defect's scope.
