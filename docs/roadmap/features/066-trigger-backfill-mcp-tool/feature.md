# Feature: trigger-backfill-mcp-tool

**Lifecycle Status**: `in-progress`
**Development Branch**: `feature/trigger-backfill-mcp-tool`
**Created**: 2026-07-20
**Last Updated**: 2026-07-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-20 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning, fixed inline) |
| 2026-07-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written |
| 2026-07-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps |
| 2026-07-20 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started (Step 1) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon Dossier](recon.md) — grounded codebase facts (Phase 0)
- [Design](design.md) — debated architecture (Phase 1, approved)
- [Implementation Spec](implementation-spec.md) — 5 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Expose OHLCV historical backfill triggering and job-status monitoring as MCP agent tools on
`xstockstrat-agent`, wrapping the existing ingest `TriggerBackfill` / `GetBackfillStatus` /
`ListBackfillJobs` RPCs so agents can fill data gaps and immediately re-run backtests without
the browser UI or private-network `grpcurl` access.

## Reviewers

_(Canonical snapshot finalized by /sdd-spec on 2026-07-20 from the distinct per-step
**Reviewers** values in implementation-spec.md. Stable unless /sdd-spec re-runs. Steps 1–4
carry the agent owner; Step 1 also carries the ingest owner; Step 5 is docs — none.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` owner | MCP tool surface consistency (params/returns/errors per `docs/runbooks/mcp-tools.md`), `x-mcp-secret` on outbound calls, admin `x-access-scope` only on write ops; catalog name-set test as C-10 reachability proof. _Note: the agent has no row in the reviewer registry's Service Owners table — flagged for registry update (docs-only follow-up, see product-spec Open Questions)._ |
| `xstockstrat-ingest` owner | Correct use of `TriggerBackfill`/`GetBackfillStatus`/`ListBackfillJobs` (timeframe_enum populated alongside the deprecated string, never string-only; idempotent job semantics untouched; no server-side changes) |

## Next Action

`/sdd-review trigger-backfill-mcp-tool impl-spec` — validate implementation spec, then `/sdd-execute trigger-backfill-mcp-tool`
