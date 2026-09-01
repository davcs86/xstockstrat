# Feature: mcp-client-signal-source

**Development Branch**: `feature/mcp-client-signal-source`
**Created**: 2026-08-31
**Last Updated**: 2026-09-01
**Committed to main**: c086afc839f905c4f72b24d75e824e22d61af0b2
**Launched date**: 2026-09-01

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-31 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-31 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings after fixes); overlap CLEAN |
| 2026-08-31 | `spec-ready` → `design-approved` | /sdd-design | Design debated (full) and approved; recon.md + design.md written |
| 2026-08-31 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated (17 steps) |
| 2026-09-01 | `implementation-ready` → `code-completed` | /sdd-execute | All 17 steps implemented (RED→GREEN) across ingest/config/agent/config-ui; suites green (ingest 206, config 98, agent 327, UI sources e2e 19) |

| 2026-09-01 | `code-completed` → `launched` | CI workflow | Promoted via PR #1065; committed c086afc839f905c4f72b24d75e824e22d61af0b2 |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Let an external MCP (Model Context Protocol) server be registered as a first-class **server-side**
signal source: `xstockstrat-ingest` connects to the configured MCP endpoint (bearer-auth header
only), queries a configured tool, parses the result into `ExternalSignal`s, and ingests them —
without routing the fetch through the Claude agent the way today's `mediated_*` sources do.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter/source-schema stability |
| `xstockstrat-config` owner | Config key naming, secret encryption + redaction, WatchConfig stream stability |
| Security | Bearer credential encrypted at rest, resolved only via `GetSecret`/`x-internal-caller`, never rendered or logged |
| `xstockstrat-agent` owner | `manage_signal_source`/`list_signal_sources` tool contract + `docs/runbooks/mcp-tools.md` parity |
| Proto Reviewer | Field-number uniqueness, no breaking change, `source_type` CHECK value addition |

## Next Action

`/sdd-design mcp-client-signal-source quick` — recon + design debate before /sdd-spec
