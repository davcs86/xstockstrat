# Feature: fix-mcp-extract-credentials

**Type**: bug
**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/fix-mcp-extract-credentials`
**Source Report**: docs/reports/2026-08-01-mcp-tools-alignment-triage.md (F-1)
**Severity**: SEV-2
**Created**: 2026-08-02
**Last Updated**: 2026-08-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the MCP-alignment triage report (F-1) |
| 2026-08-02 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, full). Chosen: option (c) — env-scope + typed-projection fix for the legitimate reads (alert_threshold, OAuth); extract-tool credentials made loudly unsupported (raise) rather than a plaintext-config antipattern. AC-3 (radical resolver) deferred; AC-4 reinterpreted. |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon](recon.md) — grounded codebase dossier (agent + ingest + config)
- [Design](design.md) — approved option-(c) architecture (2-round debate)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-mcp-extract-credentials`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Give extract-tool credentials one owner: interim env/namespace-scoped, non-swallowing config read; radical — ingest resolves its own credentials_ref via a ResolveSourceCredential RPC (or server-side extraction), deleting the agent's dev-scoped plaintext-key path.

## Next Action

`/sdd-spec fix-mcp-extract-credentials` — generate the implementation spec from the approved design
