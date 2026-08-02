# Feature: fix-mcp-server-input-validation

**Type**: bug
**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/fix-mcp-server-input-validation`
**Source Report**: docs/reports/2026-08-01-mcp-tools-alignment-triage.md (F-9 (code), F-10 (notify field validation))
**Severity**: SEV-3
**Created**: 2026-08-02
**Last Updated**: 2026-08-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the MCP-alignment triage report (F-9 (code), F-10 (notify field validation)) |
| 2026-08-02 | `draft` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written. NaN-rejecting range form + tools.py docstring sync + notify compile-first de-cloak folded in from adversary round 1 |
| 2026-08-02 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps |
| 2026-08-02 | `implementation-ready` → `code-completed` | /sdd-execute | All 5 steps done RED-first: ingest F-9 conviction guard (155 tests green), notify F-10 empty-field guard + compile-first de-cloak (19 tests green, no latent red), docstrings/mcp-tools.md/merge-order updated |

---

## Reviewers

| Step category | Service | Reviewers |
|---|---|---|
| service, test | `xstockstrat-ingest` | xstockstrat-ingest owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| service, test | `xstockstrat-notify` | xstockstrat-notify owner — stream delivery guarantees, backpressure handling, alert deduplication |
| docs | `docs/` + `xstockstrat-agent` | none (docs category); advisory: xstockstrat-agent owner — MCP tool contract stability + `mcp-tools.md` parity |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md) — 5 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Two small independent server guards: ingest range-validates conviction to INVALID_ARGUMENT (not INTERNAL/silent NULL), and notify rejects empty title/body (INVALID_ARGUMENT).

## Next Action

Open the integration PR (`feature/fix-mcp-server-input-validation` → `main-dev`). Rebase-only overlaps with 085 (`tools.py`) and 092 (notify harness) — see `merge-order.md`.
