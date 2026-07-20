# Feature: trigger-backfill-mcp-tool

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/trigger-backfill-mcp-tool`
**Created**: 2026-07-20
**Last Updated**: 2026-07-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-20 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning, fixed inline) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec trigger-backfill-mcp-tool`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Expose OHLCV historical backfill triggering and job-status monitoring as MCP agent tools on
`xstockstrat-agent`, wrapping the existing ingest `TriggerBackfill` / `GetBackfillStatus` /
`ListBackfillJobs` RPCs so agents can fill data gaps and immediately re-run backtests without
the browser UI or private-network `grpcurl` access.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` owner | MCP tool surface consistency (params/returns/errors per `docs/runbooks/mcp-tools.md`), `x-mcp-secret` on outbound calls, admin `x-access-scope` only on write ops. _Note: the agent has no row in the reviewer registry's Service Owners table — flagged for registry update._ |
| `xstockstrat-ingest` owner | Correct use of `TriggerBackfill`/`GetBackfillStatus`/`ListBackfillJobs` (timeframe_enum not the deprecated string; idempotent job semantics untouched) |

## Next Action

`/sdd-design trigger-backfill-mcp-tool quick` — grounded design (recon + single adversarial round) before /sdd-spec
