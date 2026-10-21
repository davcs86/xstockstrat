# Product Spec: fix-edgar-companyfacts-decode

**Type**: bug
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-10-21-edgar-companyfacts-string-cik-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-21

---

## Problem Statement

**Observed:** staging fundamentals backfill job `8de93c4c-08e8-4ebf-a8cf-0d99e503ceca` ended `PARTIAL`;
CRCL, ELWT, PSKY and RDDT failed with `companyfacts <SYM>: json: cannot unmarshal string "00018760xx" into Go
value of type json.Number`. They have no stored filings, so every snapshot read logs
`edgar snapshot not producible — falling back to vendor` (`reason: zero_history`).

**Expected:** the companyfacts document decodes whatever JSON type SEC uses for `cik`, and those symbols store
their filing history like any other SEC filer.

## Reproduction Steps

1. `trigger_backfill(symbols=["CRCL"], data_kind="fundamentals")` on staging.
2. `get_backfill_status` → `PARTIAL`, `failed_symbols: ["CRCL"]`; marketdata logs the unmarshal error.

## Root Cause Hypothesis

`companyFacts.CIK` is typed `json.Number` (`services/xstockstrat-marketdata/internal/edgar/edgar_client.go:105`),
which accepts only a JSON number; SEC serves a zero-padded string for these filers, so the whole document fails to
decode. The field is never read — CIK resolution uses `tickerEntry.CIK` (`:100`, used at `:145`).

## Affected Services

- xstockstrat-marketdata

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev (re-run the fundamentals backfill for CRCL, ELWT, PSKY, RDDT).

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Rate-limiting the `edgar snapshot not producible` WARN (separate log-noise concern)
