# Feature: fix-offline-book-consistency

**Type**: bug
**Development Branch**: `feature/fix-offline-book-consistency`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-offline-book-consistency-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-offline-book-consistency-defect.md` (debt-radar D-47, D-48, D-49, D-63) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 16 steps |
| 2026-10-28 | `implementation-ready` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | Steps 1-16 re-verified against current codebase after merging origin/main-dev; line-drift-only corrections in Steps 3,5,7,9,11,12,14,15 |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Execution started; up-front plan confirmed by operator standing authorization (session_01NpS3HShZK6pSnogA7CFo2f) |
| 2026-10-28 | `in-progress` (step 1 done) | /sdd-execute sequential (sdd-batch-execute) | Step 1: additive `offline_state_unavailable` on Portfolio (17) and Position (26); buf lint + buf breaking pass |
| 2026-10-28 | `in-progress` (step 2 done) | /sdd-execute sequential (sdd-batch-execute) | Step 2: regenerated Go/TS/Python portfolio stubs via `buf-gen.sh`; diff only in `portfolio/v1` |
| 2026-10-28 | `in-progress` (step 3 done) | /sdd-execute sequential (sdd-batch-execute) | Step 3: shared `isFinite` guard; ConfirmOrder rejects non-finite/negative `filled_qty` and (when filling) `filled_avg_price` before the load; snapshot checks use the helper |
| 2026-10-28 | `in-progress` (step 4 done) | /sdd-execute sequential (sdd-batch-execute) | Step 4: durable ConfirmOrder tests for `@AC-4` (non-finite/negative fill rejected before the load, no emit), `@AC-7` (PARTIALLY_FILLED/FILLED + one positions.synced each) and `@AC-10` (0/0 un-confirm → NEW + emit) |
| 2026-10-29 | `in-progress` (step 4 done) | /sdd-execute sequential (sdd-batch-execute) — re-spec | Merged `origin/main-dev` (`-X ours`); re-specced Steps 5, 6, 12 line citations to the current tree (trading.go +5 from Steps 3-4 above :2178, +4 below it after main-dev dropped one line; test drift from Step 4; portfolio comment :114-115). No instruction or scope change |
| 2026-10-29 | `in-progress` (step 5 done) | /sdd-execute sequential (sdd-batch-execute) | Step 5: `appendLedgerEvent` (idempotency key, one `Unavailable` retry) with `emitLedgerEvent` as its void wrapper; ConfirmOrder returns UNAVAILABLE when positions.synced is not published; Snapshot adds a Warnings line; `ledger_emit_mtls_test.go` updated to the bounded retry (operator Option A) |
| 2026-10-29 | `in-progress` (step 6 done) | /sdd-execute sequential (sdd-batch-execute) | Step 6: durable D-63 tests in `trading_offline_test.go` (`recordingLedger.failFn` hook; ConfirmOrder UNAVAILABLE on emit and query failure, partial and full fill, re-confirm recovers; one-`Unavailable`-retry under one idempotency key; timeout-budget rule; `user_id` in payload; Snapshot warning) |
| 2026-10-29 | `in-progress` (steps 7-8 done) | /sdd-execute sequential (sdd-batch-execute) | Steps 7+8 merged into one commit (operator decision "B: merge Steps 7+8"): `processPositionSync` (offline branch, try-all `errors.Join`) and `processAccountDeregistered` return errors behind a SQLSTATE-classifying `boundedRetry` (class 22/23 park after 5 attempts, 08/40/53/57 + deadline/network never park, unclassified after ≥ 5 attempts and ≥ 10 min; one `"event parked"` Error); `DeleteOfflineRealized` onto `r.db`; new `portfolio_sync_retry_test.go` (AC-1, AC-2, AC-6, AC-9) |
| 2026-10-29 | `in-progress` (steps 9-10 done) | /sdd-execute sequential (sdd-batch-execute) | Steps 9+10 merged into one commit (operator decision "Merge pairs + standing rule"): `GetOfflineStates` returns `(states, failed, err)` with a per-row decode failure isolated to its account (AC-8); `readValuation.unavailable` + `degraded()` mark every requested id on a whole-call error and only the failed id on a row failure; `ErrOfflineStateUnavailable` sentinel (logs only); new repo and `valueRead` tests |
| 2026-10-29 | `in-progress` (steps 11-12 done) | /sdd-execute sequential (sdd-batch-execute) | Steps 11+12 merged into one commit (standing operator rule "Merge pairs + standing rule"): a degraded offline account keeps market-value equity, but its P&L is zeroed, `offline_state_unavailable` is set, and realized/fee/pct optionals stay unset. `markDegradedPositions` zeroes Day P&L on its offline positions across all four reads. The GetPortfolio aggregate excludes a degraded account's P&L and sets the marker. New AC-3 (all four reads), AC-8, broker-row and aggregate tests |
| 2026-10-30 | `in-progress` (steps 13-14 done) | /sdd-execute sequential (sdd-batch-execute) | Steps 13+14 merged into one commit (standing operator rule "Merge pairs + standing rule"; operator decision "A: Gate it, drop e2e"): `PNL_UNAVAILABLE_LABEL` and `PortfolioTotals.incomplete` in `portfolioTotals.ts`; every Day/Total P&L surface (PortfolioPanel, OrderBook `PortfolioSummary`, Book page, positions table and sheet, position page, insights `AccountPortfolioSelector`) shows `P&L unavailable` for a degraded offline account. vitest + Playwright AC-3 cases, AC-4/AC-5 confirm-dialog error cases, and the `PORTFOLIO_OFFLINE_DEGRADED` / `POSITION_OFFLINE_AAPL_DEGRADED` fixtures |
| 2026-10-30 | `in-progress` (step 15 done) | /sdd-execute sequential (sdd-batch-execute) | Step 15: agent pass-through tests for the `offline_state_unavailable` marker and the FR-5/FR-6 error details; Files widened to `test_position_parity.py` by operator decision (Deviation Log). No agent code change. |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22), collected from every step's `**Reviewers**`.

| Reviewer | Focus | Steps |
|---|---|---|
| Proto Reviewer | Field number uniqueness per message, no breaking change, `buf lint` / `buf breaking` pass | 1, 2 |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 1, 2, 7, 8, 9, 10, 11, 12 |
| `xstockstrat-trading` owner | Order execution correctness, fill detection | 1, 2, 3, 4, 5, 6 |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy | 1, 2, 13, 14 |
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) | 15 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks (Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The offline-account books from feature 240 drift or misreport P&L in four ways:

- Portfolio acks failed offline sync writes (D-47).
- Valuation swallows a failed `GetOfflineStates` and reports unrealized-only P&L as complete (D-48).
- `ConfirmOrder` accepts NaN/Inf quantity and any price (D-49).
- `ConfirmOrder` reports success when the positions emit fails (D-63).

## Next Action

`/sdd-review fix-offline-book-consistency impl-spec` — validate implementation spec, then `/sdd-execute fix-offline-book-consistency`
