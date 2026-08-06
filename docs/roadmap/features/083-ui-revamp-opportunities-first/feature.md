# Feature: ui-revamp-opportunities-first

**Lifecycle Status**: `launched`
**Committed to main**: 37a7f5269454eadb810c4303d5100063e4f35eed
**Launched date**: 2026-08-01
**Development Branch**: `feature/ui-revamp-opportunities-first`
**Created**: 2026-07-31
**Last Updated**: 2026-07-31
**Archived**: 2026-08-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-31 | `idea` → `draft` | /sdd-story | Product spec generated from Nocturne design handoff (12-screen UI revamp) |
| 2026-07-31 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS with 5 advisory warnings; overlap CLEAN). Warnings C-3/C-4/C-5/C-10(b) folded into FR-20 + AC-8; six design-phase Open Questions accepted for routing to /sdd-design |
| 2026-07-31 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md (+ Phase 0b producer recon) + design.md written. **User override:** all backend work in-scope for 083 (backend→frontend order, no phased split). No Floor breach (F-06 held via ledger-backed Copilot threads). Six Open Questions resolved. **Gate before /sdd-spec:** product-spec refresh + re-review (backend now in-scope) |
| 2026-07-31 | `design-approved` (unchanged) | /sdd-review | Refreshed multi-service product spec re-reviewed: **PASS WITH WARNINGS** (0 blockers, no Floor breach — F-06/F-07 held; 3 advisory warnings deferred to /sdd-spec). Overlap **CLEAN**. Copilot descoped to shallow beta. Lifecycle unchanged (re-validation, not a re-gate). |
| 2026-07-31 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 31 steps. Grep-resolved the design Open Risks: factor grouping **requires** `portfolio.exposure.factor_map` (marketdata `Fundamentals` proto has no `sector`); expectancy is **derivable** from `backtest_runs` `win_rate`+`profit_factor` (no analysis migration); portfolio resting-stops held **in-memory** via `ConsumeOrderFills` replay (no portfolio migration); only ingest migration **008** needed; new `analysis→trading` `TRADING_ENDPOINT` edge confirmed absent in all three deployment files. |

| 2026-08-01 | `code-completed` → `launched` | CI workflow | Promoted via PR #834; committed 37a7f5269454eadb810c4303d5100063e4f35eed |
| 2026-08-06 | `launched` (unchanged) | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(4)/fails(3); pruned 4 specs (product-spec.md, recon.md, design.md, implementation-spec.md). `design-handoff/` extra was already deleted 2026-08-06 per a prior human decision (recorded in the Archive Synthesis) |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance _(stale re backend scope — refresh + re-review before /sdd-execute; see design.md Open Risks)_
- [Recon](recon.md) — grounded codebase dossier (UI + Phase 0b producer services)
- [Design](design.md) — debated, approved architecture (analysis-owns-queue spine; backend→frontend ordering)
- [Implementation Spec](implementation-spec.md) — 31 numbered steps, backend→frontend ordering
- [Context Log](context.md) — session history, decisions, deviations
- [Design Handoff](design-handoff/) — Nocturne design reference: `README.md` (token + screen grammar spec), `source-map.md` (screen → repo-module map), `xstockstrat UI.dc.html` (interactive prototype), `screenshots/01–12` (per-screen captures)

---

## Summary

Re-frame the `xstockstrat-ui` web app around a ranked **opportunity queue** — a Decide / Discover /
Engine / Book nav shell with an optional MCP-backed Copilot rail — that surfaces explained buy / trim /
exit signals the trader can act on with one confirmation, while the broker (Alpaca / IBKR) remains the
owner of the ledger and P&L. Reproduces the high-fidelity "Nocturne" dark design system across all 12
handoff screens plus the CRUD editors and a 1:1 mobile companion.

## Reviewers

_Canonical snapshot finalized by /sdd-spec (2026-07-31) from `docs/runbooks/reviewer-registry.md`,
deduplicated across all 31 steps. Stable unless `/sdd-spec` re-runs._

| Role | Review Focus | Steps |
|---|---|---|
| Proto Reviewer | Field-number uniqueness per message, no breaking change, `buf lint`/`buf breaking` pass against dev trunk, `_UNSPECIFIED=0` | 1, 2 |
| Platform Lead | Additive proto pass sign-off; new `analysis→trading` edge in the inter-service dependency graph; port/registry consistency | 1, 15 |
| `xstockstrat-analysis` (service owner) | Opportunity-queue aggregation, traced readiness/conviction determinism (no look-ahead), per-strategy analytics, screener enrichment; hot backtest path frozen | 1, 2, 3–8, 15–18 |
| `xstockstrat-portfolio` (service owner) | Position risk/factor fields, ledger-event stop ingestion (no `portfolio→trading` cycle), C-10(b) valuation parity, `factor_map` config | 1, 2, 12, 13, 14 |
| `xstockstrat-ingest` (service owner) | Signal-source health tracking + migration 008; idempotent ingestion | 1, 2, 9, 10, 11 |
| DBA | ingest migration 008 — NNN numbering (no gap/conflict), up+down pair, index correctness | 9 |
| `xstockstrat-config` (config team) | `portfolio.exposure.factor_map` naming `<service>.<category>.<key>`, WatchConfig read at startup | 13 |
| `xstockstrat-ui` (service owner) | Nocturne fidelity, nav reachability (C-10(a)), Connect-RPC call safety, FR-20 order-execution parity, AC-8 valuation parity, Copilot beta read-only surface, no secret values rendered | 2, 19–30 |
| `xstockstrat-ledger` (owner, FYI) | Copilot append-store usage (`AppendEvent`/`QueryEvents`); ledger unchanged, no new pool | 27 |
| `xstockstrat-trading` (owner, FYI) | `ListOrders`/order-event read for "taken" + resting-stop; read-only consumer, no change | 12, 15 |

_Config team added because `portfolio.exposure.factor_map` **is** used (marketdata exposes no `sector` —
confirmed at /sdd-spec). Full Copilot (authenticated MCP invocation + LLM) is a separate future feature._

## Next Action

`/sdd-review ui-revamp-opportunities-first impl-spec` — validate the implementation spec, then
`/sdd-execute ui-revamp-opportunities-first` (backend→frontend; step PRs target the feature branch
directly, not base-chained — fails.md 082).
