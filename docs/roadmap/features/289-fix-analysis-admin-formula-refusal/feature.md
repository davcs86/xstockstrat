# Feature: fix-analysis-admin-formula-refusal

**Type**: bug
**Development Branch**: `feature/fix-analysis-admin-formula-refusal`
**Defect report**: `docs/reports/2026-11-04-analysis-admin-formula-refusal-misclassified-defect.md` (Issues disabled; no GitHub issue)
**Severity**: SEV-2
**Created**: 2026-11-04
**Last Updated**: 2026-11-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` -> `draft` | /sdd-triage | Product spec pre-populated from defect report |
| 2026-11-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved after revision (pass 1 FAIL: 4 blockers; pass 2 FAIL: 1 blocker; pass 3 PASS WITH WARNINGS, all warnings addressed) |
| 2026-11-05 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds + 1 targeted delta pass, full) and approved; recon.md + design.md written. Operator C-16 sign-offs: unified NOT_FOUND+PERMISSION_DENIED refusal, narrowing `@AC-1 @feature-185`, referenced-only marking, non-held rank/action (fund_skip treatment) with held rows keeping their signal action, global `_formula_fundamentals` classification (FR-5 gate-ON CHANGE). Product-spec/acceptance amended (FR-1..FR-7; AC-14 retired, AC-15..AC-27) |
| 2026-11-05 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 14 steps |
| 2026-11-05 | `implementation-ready` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | §5.3 re-spec gate, conditional directive: merged `origin/main-dev` (already up to date, `94908ce6`), ledger-guard clean; every Verification block re-rooted to `$(git rev-parse --show-toplevel)`, Tree stamp refreshed, drifted anchors corrected in Steps 1, 2, 4, 6, 8a, 9, 11, 12; no Files change |
| 2026-11-05 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Operator approved the up-front plan (§5.4); step loop starts at Step 1 |
| 2026-11-05 | `in-progress` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | §5.3 re-spec gate, conditional directive. Merged `origin/main-dev` (already up to date); ledger-guard clean. Step 2: codegen now runs in the cached `xstockstrat-codegen` image after `pnpm install`, because host `buf-gen.sh` lacks `grpc_tools` and `node_modules`; Files gain `gen/ts/analysis/v1/analysis.ts`. Anchors corrected in Steps 1, 6, 11 and 12. Step 11's `LockSimple` icon is verified. Status unchanged (already `in-progress`) |
| 2026-11-06 | `in-progress` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | §5.3 re-spec gate, conditional directive. Merged `origin/main-dev` (already up to date, `94908ce6`); ledger-guard clean. Step 2: codegen image cache is unverifiable while dockerd is stopped, so the step now starts `dockerd &` and checks `docker images` first. Anchors corrected in Steps 4 (`TestEvaluateReadiness._svc` stub form; use the `test_unreadable_formula.py:265` `_sma_resp` form), 6 (`_period_keyed_stub` `:259`, `_counting_stub` `:273`), 9 (feature-215 bullet group ends `:1084`) and 11 (`rollupReadiness` needs an explicit `formulaUnreadable` arm before `:51`; `LockSimple` re-check path under the UI package after `pnpm install`). No Files change. Status unchanged (already `in-progress`) |
| 2026-11-06 | `in-progress` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | §5.3 re-spec gate before Step 11, conditional directive. Merged `origin/main-dev` (clean merge, `282cd49f`; brings feature 282); ledger-guard clean. Anchors corrected in Step 11 (`opportunityShared.test.ts` states list `:11`, `SemanticRole` `:20`, `WatchlistReadiness` `:51`/`:73`, `SectionRenderer` `:154-158`/`:171`, detail header `:1008-1014`) and Step 12 (`watchlistMock.ts` `:52`/`:280`). Step 14 Files gain `fix-backtest-silent-symbol-skip.feature` (EXTEND target for `@AC-22`). Step 13 verified, unchanged. Status unchanged (already `in-progress`) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier + business rules (C-16)
- [Design](design.md) — debated, user-approved architecture
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Reviewer | Focus |
|---|---|
| Proto Reviewer | Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` passes, `buf breaking` passes against dev trunk, BSR publication readiness |
| xstockstrat-analysis owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| xstockstrat-ui owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |
| xstockstrat-agent owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync; no secret values in tool output |

---

## Summary

Analysis folds indicators' deliberate PERMISSION_DENIED (admin may not execute another user's formula) into a data-unavailable row in `_compute_opportunities` and lets it escape as ERROR in `EvaluateReadiness`; feature 275 fixed only the backtest path.

## Next Action

`/sdd-execute fix-analysis-admin-formula-refusal sequential` — step loop from Step 12 (UI tests, fixtures, Playwright); Steps 1 (proto), 2 (proto-gen), 3 (analysis read side), 4 (analysis read-side tests), 5+6 (evaluator sink + its tests, one combined commit), 7+8a+8b (servicer producer wiring + its tests, one combined commit), 9 (agent `list_opportunities` docstring + runbook) 10 (agent projection tests) and 11 (UI consumer surface) done 2026-11-06
