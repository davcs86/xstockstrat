# Implementation Spec: fix-stored-edgar-periods

**Status**: `done`
**Created**: 2026-10-06
**Feature**: `docs/roadmap/features/223-fix-stored-edgar-periods/feature.md`
**Total Steps**: 4
**Feature Branch**: `feature/fix-stored-edgar-periods` (stacked on `feature/fix-edgar-quarterly-roe`)

### Scenario Coverage (Constitution C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` stored AXP periods carry financial-debt D/E after re-derivation | Steps 2–3 (`TestBackfillFundamentals_RederivesStaleStoredPeriods_AC1_AC2_feature223`, golden-guard D/E assertion) |
| `@AC-2` snapshot reflects the re-derived period; no stale cached row served | Steps 2–3 (edgar snapshot invalidation) |

### Step 1 — migration: 008 `derivation_version`

**Status**: `done` — `migrations/008_fundamentals_history_derivation_version.{up,down}.sql` (verified offline: ADD ↔ DROP COLUMN).

### Step 2 — service: versioned writes + guarded upgrade + snapshot invalidation

**Status**: `done` — `internal/edgar/edgar_client.go` (`DerivationVersion`), `internal/source/source.go`,
`internal/repository/marketdata_repo.go` (`InsertHistoricalFundamentals` $21, `GetHistoricalPriceState`
scans the version, `RederiveHistoricalFundamentals`, `DeleteEdgarSnapshot`),
`internal/service/marketdata_service.go` (`backfillOneSymbol` upgrade branch).

### Step 3 — test

**Status**: `done` — service fake-repo test (upgrade, invalidation, idempotent re-run, price-join
untouched), pgxmock pins (guarded UPDATE, same-version no-op, scoped DELETE, version scan), golden
drift guard (`internal/edgar/derivation_version_test.go`).

### Step 4 — docs

**Status**: `done` — marketdata `CLAUDE.md` (versioning rule), `docs/context-constitution.md`
(MARKETDATA-13), `docs/runbooks/historical-backfill.md` (§ Re-deriving stored periods),
`merge-order.md` (217 → 223 migration order; 222 → 223 stacked).

**Verification**: `GOWORK=off golangci-lint run` 0 issues; `GOWORK=off go test -race ./...` green.

## Deviation Log

1. Constitution row numbered **MARKETDATA-13** (217's PR claims MARKETDATA-12) to avoid a merge
   collision.
2. Operational step (not code): after 222 + 223 deploy, run ONE fundamentals re-backfill for the
   fundamentals universe; the deferred `fundamentals_macd_blend` exit-rule backtests (222 context.md)
   unblock after it.
