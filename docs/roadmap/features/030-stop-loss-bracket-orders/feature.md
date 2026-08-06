# Feature: stop-loss-bracket-orders

**Lifecycle Status**: `design-approved`
**Priority**: `P0` — blocking live-capital expansion (Live-Capital Safety program, see context.md 2026-08-04)
**Development Branch**: `feature/stop-loss-bracket-orders`
**Created**: 2026-05-26
**Last Updated**: 2026-08-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-05 | `draft` → `spec-ready` | /sdd-review | Product spec approved after 2 review rounds (3 warnings) |
| 2026-08-06 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full — hard cap) and approved with noted open risks; recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec stop-loss-bracket-orders`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Automatically submits stop-loss and optional take-profit bracket orders at the broker (IBKR/Alpaca) when a position is opened, using the stop price computed by the position sizing engine, so that open positions are protected without requiring platform uptime or human intervention.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| Platform Lead | Cross-service architecture, new service additions, port assignments |

## Next Action

`/sdd-spec stop-loss-bracket-orders` — design approved; generate implementation spec (do not run
until feature 023 reaches `implementation-ready` with real line numbers — see recon.md's hard
sequencing blocker)
