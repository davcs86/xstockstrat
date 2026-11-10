# Feature: fix-agent-bearer-secret-orphan

**Type**: bug
**Development Branch**: `feature/fix-agent-bearer-secret-orphan`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 1 defect report(s) (clustered triage) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-agent-bearer-secret-orphan`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A signal-source bearer token is written as a per-user encrypted config secret before the ingest register call; when that call fails, nothing deletes the secret, so every failed retry leaves another unreferenced `mcp_credential.<uuid>` ciphertext row (agent `manage_signal_source` / `instantiate_template`, and the config-ui hook).

## Next Action

`/sdd-design fix-agent-bearer-secret-orphan` — recommended design depth (full) from triage; see context.md
