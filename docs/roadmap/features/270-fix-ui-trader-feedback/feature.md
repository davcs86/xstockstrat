# Feature: fix-ui-trader-feedback

**Type**: bug
**Development Branch**: `feature/fix-ui-trader-feedback`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-ui-trader-feedback-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-ui-trader-feedback-defect.md` (debt-radar D-11, D-17, D-45, D-64) |
| 2026-10-22 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings; 5 resolved by adding AC-9..AC-12, splitting AC-7 and removing the Fix Scope template note) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 14 steps |
| 2026-10-28 | `implementation-ready` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | Merged `origin/main-dev` (`-X ours`); re-spec of Steps 2, 7, 9, 13, 14 for line drift only (no semantic change) |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Sequential execution started; up-front plan confirmed by operator standing authorization (see context.md) |
| 2026-10-28 | `in-progress` (Step 1 done) | /sdd-execute sequential (sdd-batch-execute) | Step 1 — D-45 symbol-page `runBacktest` now sends `strategyId` with `strategyIdRef` |
| 2026-10-28 | `in-progress` (Step 2 done) | /sdd-execute sequential (sdd-batch-execute) | Step 2 — `@AC-4` e2e pins that the symbol-page `RunBacktest` carries both `strategyId` and `strategyIdRef` |
| 2026-10-29 | `in-progress` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | Merged `origin/main-dev` (`-X ours`); re-spec of Steps 7 and 13 for line drift only (no semantic change) |
| 2026-10-29 | `in-progress` (Step 3 done) | /sdd-execute sequential (sdd-batch-execute) | Step 3 — D-64 per-call `onError` on opportunity actions and the signal-source toggle (`CardNotice` error), `errMessage` hoisted to `src/lib/errMessage.ts` |
| 2026-10-29 | `in-progress` (Step 4 done) | /sdd-execute sequential (sdd-batch-execute) | Step 4 — `@AC-5`/`@AC-6` e2e (503 SetOpportunityAction / ManageSignalSource → `role=alert` error) plus the `errMessage` unit test |
| 2026-10-29 | `in-progress` (Step 5 done) | /sdd-execute sequential (sdd-batch-execute) | Step 5 — D-64 ledger export (`/trader/portfolio`) shows a `CardNotice` error on a non-OK response or a rejected `fetch`; success download path unchanged |
| 2026-10-29 | `in-progress` (Step 6 done) | /sdd-execute sequential (sdd-batch-execute) | Step 6 — `@AC-7`/`@AC-11` e2e on `/trader/portfolio` (500 / aborted ledger export → `role=alert` "Export failed", no `pageerror`) |
| 2026-10-29 | `in-progress` (Step 7 done) | /sdd-execute sequential (sdd-batch-execute) | Step 7 — D-64 global mutation error fallback: `MutationCache` `onError` → single-slot `mutationErrorStore` → `MutationErrorFallback` alert in both providers; `meta.errorHandled` opt-out on the 9 audited hooks; the three no-op `onError` blocks removed |
| 2026-10-29 | `in-progress` (Step 8 done) | /sdd-execute sequential (sdd-batch-execute) | Step 8 — `@AC-10` tests: `mutationErrorStore`/`queryClient` Vitest units (unflagged → reported, `meta.errorHandled` → not, per-call `onError` → still reported) and an `orders.spec.ts` e2e (503 CancelOrder → global "cancel unavailable" alert, dismissable, no `pageerror`) |
| 2026-10-29 | `in-progress` (Step 9 done) | /sdd-execute sequential (sdd-batch-execute) | Step 9 — D-17: `toPbTradingMode` (`src/lib/tradingMode.ts`) maps an unknown environment (`null`) to `TRADING_MODE_UNSPECIFIED`; the five `?? 'paper'` defaults are removed, mode types widened to `EnvironmentMode \| null`, the lineage filter skips the mode clause on `null`, and the four empty-state strings drop the mode word |
| 2026-10-29 | `in-progress` (re-spec Steps 10–14) | /sdd-execute sequential (sdd-batch-execute) | Re-spec after merging `origin/main-dev`: line-drift refresh for Steps 10–14; Step 14 now preserves the feature-271 `@AC-5` `streamAlerts` hold branch and also updates the stale "stops silently" comments at `order-parity.spec.ts:118` and the `orders.spec.ts:11` header |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22). It stays stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment (`production`/`staging`) scope correctness | 1–14 |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism | none. Read-only: Step 2 re-runs the existing fingerprint tests (`test_analysis_servicer.py:1968,1999`) and changes no analysis code |
| `xstockstrat-trading` owner | Order execution correctness, paper-only dev invariant | none. Read-only: Steps 9–10 rely on `resolveTradingMode` (`trading.go:3573-3582`) deriving the mode from `TRADING_MODE_UNSPECIFIED`; no trading code changes |

---|---|---|
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, environment (`production`/`staging`) scope correctness | TBD (/sdd-spec) |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism | D-45 evidence/history semantics and open question NC-D; change only if design finds a phantom-row write |
| `xstockstrat-trading` owner | Order execution correctness, paper-only dev invariant | Read-only: D-17 relies on the server deriving mode from `TRADING_MODE_UNSPECIFIED`; confirm that contract |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks (Phase 1)
- [Implementation Spec](implementation-spec.md) — 14 numbered steps (7 service + 7 paired test)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Trader/insights UI feedback defects: a silently dropped order stream masks fresher polled statuses (D-11);
orders are tagged PAPER while the environment is unknown (D-17); symbol-page backtests omit `strategyId`
and earn no evidence (D-45); and three user actions fail with no visible error (D-64).

## Next Action

`/sdd-review fix-ui-trader-feedback impl-spec` — validate implementation spec, then `/sdd-execute fix-ui-trader-feedback`
