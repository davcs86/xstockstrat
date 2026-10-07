# Feature: private-by-default-templates

**Development Branch**: `feature/private-by-default-templates`
**Created**: 2026-10-06
**Last Updated**: 2026-10-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-06 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-10-06 | `draft` → `spec-ready` | /sdd-review | Product spec approved on re-review (first pass failed C-07/P-03, fixed); 6 warnings, 3 carried to design |
| 2026-10-06 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + design.md written |
| 2026-10-07 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 41 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Remove the concept of "public" from every user-authored object (formulas, strategies, signal sources and the
signals ingested into them all become owner-private), and add an admin-curated template catalog for
strategies, formulas and signal sources that users instantiate into independent private snapshot copies.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer (`packages/proto`) | Field number uniqueness per message, no breaking change without deprecation comment, `buf lint`/`buf breaking` pass (Step 1) |
| DBA | Migration NNN numbering, up+down pair, hypertable partitioning, index correctness, run-order with `scripts/db-migrate.sh` (Steps 3, 4, 6, 13, 18, 33) |
| Platform Lead | Cross-service migration tooling and CI jobs (Steps 3, 4) |
| Security | SAN-bound internal-caller identity; per-user secrets encrypted, redacted on every edge, decryptable only via `GetSecret` (Steps 1, 5, 21, 22) |
| `xstockstrat-indicators` owner | Formula sandboxing, no side-effects from formula execution; owner-only read/execute; templates (Steps 1, 13–15, 27, 28, 33) |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias; owner threading, owner-keyed state, template saga (Steps 1, 6–12, 16, 17, 25, 26, 31–33) |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion (per-owner dedup), newsletter source schema stability (Steps 1, 5, 18–20, 23, 24, 29, 30, 33) |
| `xstockstrat-config` owner | Global/per-user scoping, secret encryption + redaction, WatchConfig stream stability (Steps 1, 5, 21, 22) |
| `xstockstrat-agent` owner | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; tool-count statements across all six inventory surfaces (Steps 34, 35) |
| `xstockstrat-ui` owner | Analytics display accuracy, Connect-RPC call safety, config mutation safety, no secret values rendered (Steps 36–39) |

## Next Action

`/sdd-review private-by-default-templates impl-spec` — validate implementation spec, then `/sdd-execute private-by-default-templates`
