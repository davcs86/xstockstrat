# Defect: EDGAR companyfacts decode fails when SEC returns `cik` as a string

**Recorded**: 2026-10-21
**Severity**: SEV-3
**Impact type**: missing-fundamentals-data
**Environment**: staging (main-dev, deploy 31ee809a)
**Affected service(s)**: xstockstrat-marketdata
**Config-only fix possible**: no

## Observed

The staging fundamentals backfill job `8de93c4c-08e8-4ebf-a8cf-0d99e503ceca` (35 symbols, 2026-10-21 00:27 UTC)
ended `PARTIAL` with `failed_symbols = [CRCL, ELWT, PSKY, RDDT]`. Each failed with the same decode error:

```
fundamentals backfill: symbol failed (skipped) symbol=CRCL
error="companyfacts CRCL: json: cannot unmarshal string \"0001876042\" into Go value of type json.Number: invalid syntax"
```

(ELWT `"0002063863"`, PSKY `"0002041610"`, RDDT `"0001713445"`.) These symbols therefore have no stored filings,
so every snapshot read logs `edgar snapshot not producible — falling back to vendor` (`reason: zero_history`).

## Expected

The companyfacts document decodes whatever JSON type SEC uses for `cik`; the four symbols store their filing history
like the other 31.

## Reproduction

1. `trigger_backfill(symbols=["CRCL"], data_kind="fundamentals")` on staging.
2. `get_backfill_status` → `PARTIAL`, `failed_symbols: ["CRCL"]`; marketdata logs the unmarshal error above.

## Evidence

`services/xstockstrat-marketdata/internal/edgar/edgar_client.go:105`
> CIK        json.Number                     `json:"cik"`

SEC serves `cik` as a zero-padded string for these filers. `json.Number` accepts a JSON number only, so the
whole document fails to decode. The field is never read: only `tickerEntry.CIK` (`edgar_client.go:100`, used at
`:145`) feeds CIK resolution. Existing tests only use a numeric `cik` (`edgar_client_test.go:56`, `:210`, `:258`).
