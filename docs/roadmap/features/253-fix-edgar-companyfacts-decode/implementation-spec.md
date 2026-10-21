# Implementation Spec: fix-edgar-companyfacts-decode

**Status**: `complete`
**Created**: 2026-10-21
**Feature**: `docs/roadmap/features/253-fix-edgar-companyfacts-decode/feature.md`
**Total Steps**: 2
**Feature Branch**: `feature/fix-edgar-companyfacts-decode`

---

## Execution Summary

The fix deletes the unused `CIK json.Number` field from the `companyFacts` decode struct
(`services/xstockstrat-marketdata/internal/edgar/edgar_client.go:105`). `encoding/json` ignores keys
that have no struct field, so the document decodes whether SEC sends `cik` as a string or a number.
Step 1 removes the field. Step 2 adds the `@AC-1` regression test. `/sdd-execute`'s TDD gate runs the
Step 2 test against the tree before Step 1 to get the RED run. The string row fails there and the
number row passes on both sides, which guards existing behavior.

Why delete the field instead of retyping it: nothing reads it. `grep -rn "\.CIK\b" --include="*.go"`
outside tests matches only `tickerEntry.CIK` (`edgar_client.go:145`). A replacement type such as
`json.RawMessage` or a custom string-or-number unmarshaler would be code for a value no caller uses
(C-18 YAGNI). `/sdd-design` was skipped on triage's `skip` recommendation (bug-triage Track C), so
this choice is recorded here and in `context.md`.

No proto, migration, or config change. No consumer-surface step (C-14): the fix is internal to the
marketdata EDGAR lane. Its visible effect is that the four symbols get stored history and stop
falling back to the vendor (`reason: zero_history`). No `DerivationVersion` bump (MARKETDATA-13):
`buildPeriod` output is unchanged, so the golden guard `internal/edgar/derivation_version_test.go`
still passes. The four failed symbols have no stored rows, so a normal re-backfill inserts them under
`ON CONFLICT DO NOTHING`.

### Scenario Coverage (Constitution C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` Companyfacts decodes whichever JSON type SEC uses for cik (`"0001876042"`, `1876042`) | Step 2 (`TestFetchHistorical_DecodesCIKStringOrNumber_AC1_feature253`, one subtest per Example row) |

## Step Dependencies

- Step 2 [test] covers Step 1 [service] (C-08). Write Step 2's test first and run it against the
  tree before Step 1 to capture RED (P-06). Then apply Step 1 and re-run for GREEN.
- After the integration merge and dev deploy: re-run
  `trigger_backfill(symbols=["CRCL","ELWT","PSKY","RDDT"], data_kind="fundamentals")` and confirm
  `get_backfill_status` reports `SUCCEEDED` with no `failed_symbols` (the product-spec smoke test).
  This is post-deploy verification, not an executable step.
- C-16 promotion of `@AC-1` into `services/xstockstrat-marketdata/acceptance/` happens in the
  `/sdd-execute` integration PR (step 2.5 of that skill), not in this spec.
- Known gap, out of scope: `tickerEntry.CIK` (`edgar_client.go:100`, `cik_str`) is also
  `json.Number`. SEC currently sends `cik_str` as a number, and that field is read
  (`:145`), so it is not part of this bug. If SEC ever sent it as a string, CIK resolution would
  fail for every symbol at once, which is loud. Raise it in `/sdd-review` if it should be covered;
  it is not fixed silently here (P-03).

---

### Step 1 — service: drop the unused `CIK` field from `companyFacts`

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/edgar/edgar_client.go` — modify

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Confirmed via: `grep -n "companyFacts" services/xstockstrat-marketdata/internal/edgar/edgar_client.go` → struct at L104, decoded at L265 (`var cf companyFacts`) and L267 (`c.get(ctx, url, &cf)`, wrapped as `companyfacts %s: %w` at L268, which is the error the staging backfill logged).
- Existing code (L104–108):
  ```go
  type companyFacts struct {
  	CIK        json.Number                     `json:"cik"`
  	EntityName string                          `json:"entityName"`
  	Facts      map[string]map[string]factEntry `json:"facts"` // taxonomy → tag → entry
  }
  ```
- Field is unused: `grep -rn "\.CIK\b\|cf\.CIK" --include="*.go" services/xstockstrat-marketdata | grep -v _test.go` → only `edgar_client.go:145` (`e.CIK.String()` on `tickerEntry`, L99–102). The only reader of `cf` is the `cf.Facts` loop at L275.
- `encoding/json` stays imported after the change: `tickerEntry.CIK json.Number` (L100) and `json.NewDecoder` (L94) still use it.
- Behavior checked in a scratch program (Go 1.24.7): decoding `{"cik":"0001876042",...}` into a struct with `CIK json.Number` fails (`invalid number literal, trying to unmarshal "\"0001876042\"" into Number`). The same struct without the field decodes both `"0001876042"` and `1876042` with a nil error.

**TDD**: `red-green required` (paired with Step 2; Step 2's `cik_string` subtest fails against the current struct)

**Covers**: — (behavior asserted by Step 2)

**Instructions**:
1. In `services/xstockstrat-marketdata/internal/edgar/edgar_client.go`, delete the line
   `CIK        json.Number                     `json:"cik"`` (L105) from `type companyFacts struct`.
   Leave `EntityName` and `Facts`, and re-align the struct with `gofmt`.
2. Do not touch `tickerEntry` (L99–102), `resolveCIK` (L127–151), or `FetchHistorical` (L260+).
   Do not add a comment: the Step 2 regression test is what stops a typed `cik` field from coming back.
3. Do not bump `DerivationVersion` (L494). The period builder's output does not change (MARKETDATA-13).

**Verification**:
```bash
(cd services/xstockstrat-marketdata && grep -n 'json:"cik"' internal/edgar/edgar_client.go)   # expect no output
(cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod)
```

---

### Step 2 — test: `@AC-1` companyfacts decodes a string or a number `cik`

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/edgar/edgar_client_test.go` — modify (append after the last test, `TestDebtToEquity_NilWhenNoDebtTag_feature211`, which ends at L421)

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Test client to reuse: `newTestClientCF211(cf map[string]any) *Client` (`edgar_client_test.go:238`). It serves `cf` for any URL path containing `companyfacts`, whatever the CIK.
- CIK cache: `resolveCIK` returns early on a cache hit (`edgar_client.go:129–134`, `c.cikCache[key]`), so pre-seeding `c.cikCache["CRCL"] = "0001876042"` makes the test resolve CRCL without changing the helper's AAPL-only ticker map (L242). No duplicate round-tripper is needed (DRY guard rail).
- Period lookup helper to reuse: `periodByFP(t, periods, fp)` (`ttm_roe_test.go:41`). Annual periods are labelled `FY%d` (`buildPeriod`, `edgar_client.go:509–511`), so the target is `"FY2025"`.
- Annual classification: a flow fact with `fp:"FY"` and a 350–380-day span gives `"annual"` (`classifyPeriodType`, `edgar_client.go:467–489`). `2025-01-01`→`2025-12-31` is 365 days.
- Every existing fixture sends a numeric `cik` (`edgar_client_test.go:56, 210, 258, 298, 350`; `ttm_roe_test.go:35`), so nothing covers the string form today.

**TDD**: `red-green required` (write before Step 1. RED: the `cik_string` subtest fails with a `companyfacts CRCL: ...` decode error. The `cik_number` subtest passes on both sides and guards existing behavior.)

**Covers**: `AC-1` (both Example rows: `"0001876042"` and `1876042`)

**Instructions**:
1. Append `func TestFetchHistorical_DecodesCIKStringOrNumber_AC1_feature253(t *testing.T)` to
   `edgar_client_test.go`. Make it table-driven with two rows that match the `acceptance.feature`
   Examples:
   - `{name: "cik_string", cik: "0001876042"}`
   - `{name: "cik_number", cik: 1876042}`

   Use `cik any` for the field so `jsonResp`'s `json.Marshal` sends a JSON string for one row and a
   JSON number for the other.
2. For each row, in `t.Run(tc.name, ...)`:
   - Build an inline companyfacts map: `"cik": tc.cik`, `"entityName": "Circle Internet Group"`, and
     `"facts"` → `"us-gaap"` → `"NetIncomeLoss"` → `"units"` → `"USD"` holding one flow datum:
     `{"start":"2025-01-01","end":"2025-12-31","val":1.0e8,"accn":"x","fy":2025,"fp":"FY","form":"10-K","filed":"2026-02-25"}`.
     The NI value and filed date are illustrative: the real CRCL figure was not pulled and the test
     does not depend on it.
   - `c := newTestClientCF211(cf)`, then `c.cikCache["CRCL"] = "0001876042"`.
   - `periods, err := c.FetchHistorical(context.Background(), "CRCL", time.Time{}, time.Time{}, []string{"annual"})`.
   - Fail with `t.Fatalf` on a non-nil `err`. The message should name `@AC-1` and the row.
   - `p := periodByFP(t, periods, "FY2025")`. Assert `p.PeriodType == "annual"` and `p.Symbol == "CRCL"`.
3. C-13 verdict: the CRCL companyfacts literal has a single consumer (this test), so keeping it
   inline complies with C-13. Do not move it to `internal/testdata/`.

**Verification**:
```bash
# RED, before Step 1: cik_string fails; cik_number passes
(cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/edgar/ -run 'TestFetchHistorical_DecodesCIKStringOrNumber_AC1_feature253' -count=1 -v)
# GREEN, after Step 1: both subtests pass, plus the full suite, coverage gate (>= 40%) and lint
(cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:")
(cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod)
# C-13: the CRCL companyfacts literal is declared once
grep -rn "Circle Internet Group" --include="*_test.go" services/xstockstrat-marketdata   # expect exactly 1 match
```
Confirm `total:` ≥ 40%, golangci-lint reports 0 issues, and `TestDerivationVersion_GoldenDriftGuard_feature223` still passes.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
