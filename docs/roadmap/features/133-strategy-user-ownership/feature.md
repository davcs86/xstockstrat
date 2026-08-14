# Feature: strategy-user-ownership

**Lifecycle Status**: `in-progress`
**Development Branch**: `feature/strategy-user-ownership`
**Created**: 2026-08-14
**Last Updated**: 2026-08-14

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-14 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-14 | `draft` → `spec-ready` | /sdd-review | Criteria: PASS WITH WARNINGS (4 warnings fixed — migration numbering tightened to explicit 013/014/015+, a seed-user-ownership governance note added to FR-5 per C-10(c), a wrong proto message name corrected (`CreateOrderRequest` → `PlaceOrderRequest`), `feature.md`'s Reviewers table reconciled with Affected Services by removing the unlisted `xstockstrat-identity` row). Overlap: CLEAN — no field/migration/config-key collisions against 132 (both self-coordinated numbers verified disjoint against trunk). |
| 2026-08-14 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full, plus 1 extra final-verification adversary pass) and approved; recon.md + design.md written. No Floor breach at any round; several severity-equivalent gaps found and fixed each round (a cross-tenant write-scoping bug, a migration mechanism that didn't satisfy its own dev/prod requirement, a missed second BFF gate, a false "already secure" trading rationale, a missed second unscoped list RPC, a missed `ctx` parameter). |
| 2026-08-14 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 17 steps. No trading/portfolio code steps (existing `user_id` fields + synthetic-header mechanism, per design decisions 6/8). One execute-time confirmation flagged: the live-loop owner-union symbol-universe composition (Step 9 sub-step 3, design Open Risk 1). |
| 2026-08-14 | `implementation-ready` (unchanged) | /sdd-execute respec | Sequential-mode §5.3 re-spec gate: 16/17 steps' anchors confirmed against trunk. One corrected — Step 7's `BacktestRunsRepository.create` → `insert` (the real method name, `backtest_runs.py:25`); same intent (thread `user_id` into the backtest-run write). Anchor-only edit, no scope change. |
| 2026-08-14 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started. Step 1 (proto: `StrategyDefinition.user_id = 13`) done — buf lint + buf breaking (vs main-dev, non-breaking) pass. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 17 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Makes `StrategyDefinition` user-owned: `strategy_id` becomes unique per-owner (not platform-wide),
ownership gates every RPC that touches a strategy (including `RunBacktest`), and the live evaluation
loop resolves each strategy's symbol universe (watchlist/held/signals) against its own owner —
closing `132-strategy-symbol-denylist`'s cross-user-aggregation gap by construction instead of a new
cross-user RPC. Foundational, wide-blast-radius change: every table/proto referencing a bare
`strategy_id` today (watchlist bindings, trading orders, backtest run history, live-loop cooldown
state) needs a `user_id` alongside it.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

_(Snapshot finalized at /sdd-spec: the distinct reviewer set across the 17 steps. `xstockstrat-trading`
and `xstockstrat-portfolio` owners were dropped — design decisions 6/8 produced **no** code steps in
those services (existing `user_id` fields + synthetic-header mechanism); `xstockstrat-ui` owner added
for the BFF de-gating + cross-user e2e steps.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service deploy config parity — migration-tooling `SEED_USER_ID` wiring across `docker-compose.yml` ↔ `.do/app*.yaml` (Step 6) |
| Proto Reviewer | Field-number uniqueness + `buf breaking` for `StrategyDefinition.user_id = 13` (field 12 reserved for 132) — Steps 1–2 |
| DBA | Migrations `013`/`014`/`015` — NNN numbering, up+down pairs, PK changes, seed-backfill guard, migration tooling (Steps 3–6) |
| `xstockstrat-analysis` owner | Ownership gating on every strategy-scoped RPC incl. `RunBacktest`; SQL-layer `user_id` scoping; live-loop per-owner keying + evaluation (Steps 1, 3–10) |
| `xstockstrat-agent` owner | 5 MCP tools now ownership-scoped — real `x-user-id` forwarding, missing `ctx` params, `run_backtest` error wrapping; `strat-lab` skill same-PR (Steps 11–12, 16) |
| `xstockstrat-ui` owner | `/insights` + `/trader` BFF admin-gate removal, cross-user IDOR isolation e2e (Steps 13–15) |

## Next Action

`/sdd-review strategy-user-ownership impl-spec` — validate the implementation spec, then
`/sdd-execute strategy-user-ownership`. The 4 design Open Risks are placed on concrete steps:
Open Risk 1 (live-loop `x-user-id` impersonation → findings entry) = Step 17; Open Risk 2 (`envsubst`
scoped-substitution vs the `DO $$` block) = Step 6 execute-time render check; Open Risk 3
(WatchlistBinding regression → named AC) = Step 10.6; Open Risk 4 (concrete seed `user_id`) = supplied
by the operator before Step 3/6 execute, recorded in `context.md` (this spec does not invent one).
**One execute-time confirmation** the spec deliberately does not resolve (behavior #1 / P-03): the
live-loop owner-union symbol-universe composition (Step 9 sub-step 3) — surface the options to the
user before implementing. **This feature must land (or at minimum reach `code-completed`) before
`132-strategy-symbol-denylist`'s FR-3 can be implemented** — update
`docs/roadmap/features/merge-order.md` with the dependency.
