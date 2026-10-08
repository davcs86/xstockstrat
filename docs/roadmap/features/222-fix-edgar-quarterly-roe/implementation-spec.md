# Implementation Spec: fix-edgar-quarterly-roe

**Status**: `done`
**Created**: 2026-10-06
**Feature**: `docs/roadmap/features/222-fix-edgar-quarterly-roe/feature.md`
**Total Steps**: 2
**Feature Branch**: `feature/fix-edgar-quarterly-roe`

### Scenario Coverage (Constitution C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` quarterly ROE on a TTM basis (10,685 / 30,264 ≈ 0.353) | Step 2 (`ttm_roe_test.go`) |
| `@AC-2` EDGAR snapshot inherits the TTM roe | Step 2 (`marketdata_service_test.go` feature222) |
| `@AC-3` annual periods unchanged | Step 2 (`TestAnnualROE_Unchanged_AC3`) |

### Step 1 — service: TTM net income for quarterly ROE

**Status**: `done` — **Service**: `xstockstrat-marketdata` — **TDD**: `red-green required`
**Files**: `internal/edgar/edgar_client.go` (`niFact`, `trailingNetIncome`, `annualizeQuarterlyROE`), `CLAUDE.md` (ratio bases)

### Step 2 — test: TTM, Q4 derivation, comparative-column trap, PIT cutoff, fallback, snapshot

**Status**: `done` — **Files**: `internal/edgar/ttm_roe_test.go`, `internal/service/marketdata_service_test.go`

**Verification**: `GOWORK=off golangci-lint run` (0 issues); `GOWORK=off go test -race ./...` green.

## Deviation Log

1. `@AC-1`'s three earlier quarterly NI figures remain illustrative (2,500 / 2,600 / 2,700M) — the
   real AXP XBRL facts were not reachable from this session (no sec.gov egress for an ad-hoc pull);
   the fixture additionally exercises the Q4-from-FY derivation and the comparative-column trap.
2. Already-stored quarterly rows keep their old single-quarter ROE until re-derived — healed by
   223's `derivation_version` mechanism + one re-backfill (merge 222 first, then 223).
