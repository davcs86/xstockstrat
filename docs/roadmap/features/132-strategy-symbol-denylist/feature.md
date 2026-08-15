# Feature: strategy-symbol-denylist

**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/strategy-symbol-denylist`
**Created**: 2026-08-14
**Last Updated**: 2026-08-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-14 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-14 | `draft` → `spec-ready` | /sdd-review | Criteria: PASS WITH WARNINGS (1 warning fixed — a wrong `live_loop.py` line citation, corrected to `:188-196`; FR-3/FR-5/AC-5's deferred-mechanism warnings accepted as legitimate, matching 131's own precedent). Overlap: file-level overlap with 131 (`_compute_opportunities`, `strategy_symbols()`) confirmed expected/already-committed-to (FR-6); no resource-number collisions (proto field 12 vs 133's field 13 confirmed disjoint against trunk). |
| 2026-08-14 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved APPROVE-READY; recon.md + design.md written. Two user-locked forks: **layer 132 on 131** (merge order 133→134→131→132) and a **dedicated `Opportunity.muted` flag** for FR-5. User steers: **entry-only deny** (held positions keep exit tracing) amending FR-1/AC-2; a **new `signal_eligible` flag** (FR-8) gating the platform-wide active-signal term; and **fair-share live-loop scheduling** (FR-9) built now. Shared `resolve_universe` helper (C-10b parity), muted-via-provenance persistence (no migration), portfolio-readiness-gated entry_backfill. One accepted residual (cold-boot backfill no-retry, no worse than shipped 116). Amended 131's design.md (FR-6) + merge-order.md. |
| 2026-08-14 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 17 steps. Proto (3 additive fields, re-verified free on trunk: StrategyDefinition highest=11, Opportunity highest=11) → analysis write-path/live-loop/opportunities/precondition-backfill (4 service+4 test steps) → agent (1+1) → UI (3 service + 1 e2e, C-14) → docs. Every step grounded in current-trunk `path:line`; 131/133-dependent anchors flagged for a conditional re-spec pass before /sdd-execute (132 executes last per merge order 133→134→131→132). |
| 2026-08-15 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential (stacked on 131) execution started; re-grounded each 131/133-dependent anchor inline against the landed tree. |
| 2026-08-15 | `in-progress` → `code-completed` | /sdd-execute | All 17 steps done. analysis 499 pass / 83.1%, agent 222 pass / 75.8%, UI tsc+lint clean (e2e is the CI gate). Integration PR next. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, user-approved architecture (Phase 1, 5 rounds)
- [Implementation Spec](implementation-spec.md) — 17 numbered steps with grounded codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replaces the opt-in `signal_params.symbols` allowlist per strategy with a deny list: a live-enabled
strategy's evaluation universe becomes `union(watchlist-bound symbols, held-position symbols,
active-signal symbols)` minus its own deny list, edited from both the Symbol detail page and the
Strategy edit page, with denied `(symbol, strategy)` pairs surfaced as explicit skipped/muted rows
in the Opportunities queue rather than silently disappearing. Directly amends
`131-live-strategy-opportunity-attribution` (design-approved, not yet implemented), which currently
assumes the opt-in list.

## Reviewers

_(Canonical snapshot finalized at /sdd-spec time — the deduplicated union of every step's
`**Reviewers**` value in implementation-spec.md. Stable unless /sdd-spec re-runs.)_

| Role | Review Focus | Steps |
|---|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` | 1, 2 |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias — live-loop evaluation-universe correctness, fair-share fairness, ordinal/cardinal discipline (muted rows), live-toggle precondition, boot-time backfill robustness | 1, 2, 3–10, 17 |
| `xstockstrat-ui` owner | Trading/analytics UI correctness, Connect-RPC call safety — StrategyWizard deny-list editor + `signal_eligible` toggle, Symbol-page masked mute control, Opportunities muted-row display, mock-backend fidelity | 1, 2, 13–16 |
| `xstockstrat-agent` owner | MCP tool contract stability (name, params, return shape) — `manage_strategy` field surface + `strat-lab` plugin skill parity (root CLAUDE.md same-PR rule) | 1, 2, 11, 12 |

_Note: `xstockstrat-portfolio` owner and Platform Lead were flagged advisory at story/design time; the
approved design reuses feature 133's existing `ListPositions(user_id)` + synthetic-header `ListWatchlists`
mechanism and adds **no** new portfolio RPC or cross-user aggregation surface, so neither owns a step here._

## Next Action

`/sdd-review strategy-symbol-denylist impl-spec` — validate the implementation spec (advisory quality
check + overlap scan), then `/sdd-execute strategy-symbol-denylist`. **Before executing**, run a
conditional re-spec pass (`/sdd-spec strategy-symbol-denylist`, evidence-only) once features **131** and
**133** have merged to `main-dev` — 132 executes last (merge order `133 → 134 → 131 → 132`) and several
step anchors (`resolve_universe`/`live_by_symbol` in `_compute_opportunities`, `StrategyDefinition.user_id`,
the rewritten `get_by_owner_and_id`, `_MASKABLE_PATHS`) only take final line-shape after those land. The
spec flags each such anchor. Field numbers (`denied_symbols=12`, `signal_eligible=14`, `Opportunity.muted=12`)
re-verified free on trunk today.
