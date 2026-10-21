# Feature: fix-agent-getconfig-deadline

**Type**: bug
**Development Branch**: `feature/fix-agent-getconfig-deadline`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-agent-get-config-value-no-deadline-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-agent-get-config-value-no-deadline-defect.md` |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-20). `/sdd-spec` overwrites it and assigns steps.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; OAuth 2.1 edge-auth correctness and statelessness; no secret values in tool output | TBD (`/sdd-spec`) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-agent-getconfig-deadline`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The agent's `client.get_config_value` calls `GetConfig` with no gRPC deadline. A config service that accepts
connections but never answers therefore hangs `extract_website_content`, `ingest_signal`'s alert-threshold
read and OAuth dynamic client registration until the MCP client times out.

## Next Action

`/sdd-design fix-agent-getconfig-deadline quick` — recommended design depth (quick) from triage; see context.md
