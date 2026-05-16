# Feature: agent-scheduler

**Lifecycle Status**: `draft`
**Development Branch**: `feature/agent-scheduler`
**Created**: 2026-05-16
**Last Updated**: 2026-05-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-16 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec agent-scheduler`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Phase 2 of the AI agent service: adds a scheduled runner to `xstockstrat-agent` that automatically fetches unread emails via Gmail API at market open, passes them to Claude via the Anthropic SDK with tool use, and ingests extracted signals into the platform — reusing the same tool implementations and system prompt validated in Phase 1 (agent-mcp-server, 009).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Scheduled automation safety, autonomous tool-call scope, new external API dependency (Gmail) |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, source slug validation |
| `xstockstrat-ledger` owner | Append-only invariant, event ordering, agent run event schema correctness |
| Security | Gmail OAuth credential storage, x-webhook-secret enforcement, autonomous ingest scope limits |

## Next Action

`/sdd-review agent-scheduler product-spec` — AI review of product spec before running /sdd-spec
