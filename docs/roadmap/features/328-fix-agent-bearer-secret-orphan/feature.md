# Feature: fix-agent-bearer-secret-orphan

**Type**: bug
**Development Branch**: `feature/fix-agent-bearer-secret-orphan`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 1 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 9 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A signal-source bearer token is written as a per-user encrypted config secret before the ingest register call; when that call fails, nothing deletes the secret, so every failed retry leaves another unreferenced `mcp_credential.<uuid>` ciphertext row (agent `manage_signal_source` / `instantiate_template`, and the config-ui hook).

## Reviewers

_(Snapshot from docs/runbooks/reviewer-registry.md, finalized at /sdd-spec time — re-run /sdd-spec
if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-config` owner | Secret encryption + redaction, environment / global-per-user scoping, WatchConfig stream stability |
| `xstockstrat-ingest` owner | Signal-source registry semantics (`credentials_ref`, owner scoping) |
| `xstockstrat-agent` owner | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output |
| `xstockstrat-ui` owner | Config mutation safety, no secret values rendered in UI |
| DBA | Cross-schema read, run-order compliance with `scripts/db-migrate.sh` (no migration ships) |
| Security | Secrets redacted at every edge; no ciphertext read; no widened secret-read authority |

## Next Action

`/sdd-review fix-agent-bearer-secret-orphan impl-spec` — validate implementation spec, then `/sdd-execute fix-agent-bearer-secret-orphan`
