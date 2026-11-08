# Feature: config-dead-rows-prune

**Development Branch**: `feature/config-dead-rows-prune`
**Created**: 2026-11-07
**Last Updated**: 2026-11-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-07 | `idea` → `draft` | /sdd-story | Product spec generated from feature 296's approved design (`296-fix-config-keys-contract/design.md` §1, §9; FR-9 and AC-7/13/14 moved here). Created at the operator's explicit direction as slice C of the 296 split; `Type: feature` (planned slice, not a triaged defect) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec config-dead-rows-prune`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Deletes the operator-signed dead config rows — `ledger/stream.notify_enabled`, `analysis/opportunity.sparkline_bars`, `marketdata/alpaca.paper` (5 tuples) — only when a small pure evidence evaluator finds zero reads in either spelling over a full staging release and every subscriber logged read coverage, with snapshot, audit and a reversible down. Unmatched signed tuples are reported, never raised.

## Reviewers

| Role | Review Focus |
|---|---|
| Service owner — `xstockstrat-config` | Config key naming (relative), env/global-per-user scoping, WatchConfig stream stability; no secret values in logs or reports |
| DBA | Migration NNN numbering (max+1 at merge), up+down pair, replay safety, run-order with `scripts/db-migrate.sh` |
| Platform Lead | Evidence rule correctness; baseline close-out; operator sign-off discipline (`signoff.md`) |

## Next Action

`/sdd-review config-dead-rows-prune product-spec` — AI review of product spec before running /sdd-spec
