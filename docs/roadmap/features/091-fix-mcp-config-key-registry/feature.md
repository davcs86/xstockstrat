# Feature: fix-mcp-config-key-registry

**Type**: bug
**Lifecycle Status**: `launched`
**Committed to main**: a76237080a282abac145b7f88a6044869132ba5f
**Launched date**: 2026-08-02
**Development Branch**: `feature/fix-mcp-config-key-registry`
**Source Report**: docs/reports/2026-08-01-mcp-tools-alignment-triage.md (F-8)
**Severity**: SEV-3
**Created**: 2026-08-02
**Last Updated**: 2026-08-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the MCP-alignment triage report (F-8) |
| 2026-08-02 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Single-table (no registry): migration 010 AFTER INSERT audit trigger + mode-exact existence gate + additive `create_key`. AC-3 unset-half reinterpreted (design-gate resolution). |
| 2026-08-02 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps (proto → proto-gen → migration 010 → config service+test → agent service+test → docs). |
| 2026-08-02 | `implementation-ready` → `code-completed` | /sdd-execute | All 8 steps implemented on feature branch. Migration verified on live Postgres (create audited once, no double-fire on update). Config 37/37 tests (RED demonstrated), agent 141 tests + descriptor-parity guard (RED demonstrated). One PR into main-dev. |

| 2026-08-02 | `code-completed` → `launched` | CI workflow | Promoted via PR #844; committed a76237080a282abac145b7f88a6044869132ba5f |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon](recon.md) — grounded codebase dossier (config + agent)
- [Design](design.md) — approved single-table architecture (2-round debate)
- [Implementation Spec](implementation-spec.md) — 8 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (governs review even if the registry later changes).

| Reviewer | Focus | Steps |
|---|---|---|
| Proto Reviewer | Field number uniqueness, no breaking change without deprecation, `buf lint`/`buf breaking` pass | 1 (proto), 2 (proto-gen) |
| DBA | Migration NNN numbering (no gap/conflict), up+down pair present, run-order compliance with `scripts/db-migrate.sh` | 3 (migration) |
| xstockstrat-config | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability, audit correctness | 1, 2, 3, 4 (service), 5 (test) |
| xstockstrat-agent | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output | 1, 2, 6 (service), 7 (test) |

_Step 8 (docs) has no assigned reviewer per the governance matrix._

---

## Summary

Stop set_config from typo-creating orphan keys: cheap agent-side guard using the ListKeys result it already fetches, and a real config key registry so NOT_FOUND is reachable and unset-registered keys are representable.

## Next Action

`/sdd-review fix-mcp-config-key-registry impl-spec` — validate the implementation spec, then `/sdd-execute fix-mcp-config-key-registry`
