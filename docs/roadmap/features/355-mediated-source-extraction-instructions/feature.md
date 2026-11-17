# Feature: mediated-source-extraction-instructions

**Development Branch**: `feature/mediated-source-extraction-instructions`
**Created**: 2026-11-17
**Last Updated**: 2026-11-17

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-17 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-17 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings; 3 rounds — open questions resolved with the operator, AC-2 configs corrected) |
| 2026-11-17 | `spec-ready` → `design-approved` | /sdd-design | Design debated (6 rounds, full — round cap lifted by the operator) and approved; recon.md + debate.md + design.md written; FR-15 and @AC-24..26 added |
| 2026-11-17 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps |
| 2026-11-17 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1–4 done (sequential) |
| 2026-11-17 | `in-progress` → `code-completed` | /sdd-execute | All 11 steps done (sequential, one commit per unit on the PR branch) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) · [Debate Register](debate.md) · [Design](design.md)
- [Implementation Spec](implementation-spec.md) — 11 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A mediated signal source's extraction logic is prose an LLM agent follows, so it gets a first-class
`extraction_instructions` field, and the dead `extractor_module` (`app.extractors.noop`) stops being
shown or asked for on `mediated_*` sources — the value a consuming agent reads as "no work to do".

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-11-17 from the `**Reviewers**` lines of the 11 steps and
docs/runbooks/reviewer-registry.md. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness per message, no breaking change, `buf lint` / `buf breaking` pass |
| `packages/proto` owner | Field number uniqueness, backward compatibility, naming |
| DBA | Migration NNN numbering, up+down pair present, run-order compliance with `scripts/db-migrate.sh` |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output |
| `xstockstrat-ui` owner | Config mutation safety, Connect-RPC call safety, no secret values rendered in UI |

## Next Action

Review and merge the integration PR (#1567) once CI is green — `migration-rerun` is the first live apply of migration 017.
