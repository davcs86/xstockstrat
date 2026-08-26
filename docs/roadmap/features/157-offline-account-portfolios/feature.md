# Feature: offline-account-portfolios

**Development Branch**: `feature/offline-account-portfolios`
**Created**: 2026-08-26
**Last Updated**: 2026-08-26
**Committed to main**: 65aeaa4c5bb7c000dfb4e30d5b788d6c39352234
**Launched date**: 2026-08-26
**Archived**: 2026-08-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-26 | `draft` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved; recon.md + design.md written; @AC-7 amended + realized/shorts scenarios added |
| 2026-08-26 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 15 steps |

| 2026-08-26 | `code-completed` → `launched` | CI workflow | Promoted via PR #1027; committed 65aeaa4c5bb7c000dfb4e30d5b788d6c39352234 |
| 2026-08-26 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(1); promoted 15 scenarios → trading/portfolio/ui/agent suites + platform.feature; pruned 4 specs |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1, 4 rounds)
- [Implementation Spec](implementation-spec.md) — 15 numbered steps with codebase evidence (Phase 2)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds **offline accounts** — a manually-tracked account variant with no broker credentials and no
broker client — that reuses the existing per-`account_id` portfolio integrations (position tracking,
P&L, portfolio cards, orders/positions pages). Because there is no broker to report fills, an offline
order's **confirmation** (fill quantity, average price, status, fill time) is entered and editable
from both the `/trader` UI and an MCP agent tool.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` (service owner) | Order lifecycle correctness, offline vs. broker routing safety, no broker call ever issued for an offline account, position-limit/halt paths unaffected |
| `xstockstrat-portfolio` (service owner) | P&L calculation accuracy for offline positions, position snapshot consistency across `ListPositions` **and** `ListPortfolios` read paths, concurrent write safety |
| `xstockstrat-ui` (service owner) | Account selector + order-confirmation edit correctness, Connect-RPC call safety, no broker-only controls shown for offline accounts |
| `xstockstrat-agent` (service owner) | New MCP tool contract stability (name/params/return), `docs/runbooks/mcp-tools.md` parity + tool-count sync across all six inventory surfaces, no secret leakage |
| Proto Reviewer | Field-number uniqueness, additive (non-breaking) enum/RPC/field additions, `_UNSPECIFIED=0`, `buf lint`/`buf breaking` pass |
| DBA | Migration NNN numbering (trading `008`, portfolio next), up+down pair, nullable-credentials change safety |
| Platform Lead | Cross-service architecture: how "offline" is modeled (enum value vs. account-source field) and how it flows trading → ledger → portfolio → UI/agent |

## Next Action

`/sdd-review offline-account-portfolios impl-spec` — validate the implementation spec, then `/sdd-execute offline-account-portfolios`
