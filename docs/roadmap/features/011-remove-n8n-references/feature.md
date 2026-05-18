# Feature: remove-n8n-references

**Lifecycle Status**: `launched`
**Development Branch**: `feature/remove-n8n-references`
**Created**: 2026-05-16
**Last Updated**: 2026-05-18
**Committed to main**: 6dbc75e
**Launched date**: 2026-05-18
**Note**: Product spec revised 2026-05-18 — scope expanded from rename-only to selective deletion; Track A services (config, ledger, identity, trading, indicators) lose webhook layer entirely; Track B services (ingest, notify, analysis) keep surviving endpoints with path rename.

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-16 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-18 | `draft` → `implementation-ready` | /sdd-spec | Implementation spec generated with 16 steps |
| 2026-05-18 | `implementation-ready` → `implementation-ready` | /sdd-spec | Implementation spec regenerated with 16 steps (revised scope: Track A = delete entirely, Track B = rename path) |
| 2026-05-18 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 completed (xstockstrat-config webhook removal) |
| 2026-05-18 | `in-progress` → `code-completed` | /sdd-execute | All 16 steps completed; ready for integration PR |
| 2026-05-18 | `code-completed` → `launched` | production promotion | Merged to main via commit 6dbc75e; now live in production |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 16 steps, generated 2026-05-18
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Remove all n8n references from the codebase and documentation. Webhook endpoints used only by n8n (config, ledger, identity, trading, indicators) are deleted entirely — callers use Connect-RPC directly. Endpoints that serve the agent MCP server's ingestion goal (ingest, notify, analysis) are kept with the `/n8n/` path segment removed. The `packages/n8n/` directory is deleted and all docs updated.

## Reviewers

_(Snapshot finalized at /sdd-spec time 2026-05-18 regeneration. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-config` owner | Config mutation safety; webhook layer removed — Connect-RPC routes unaffected |
| `xstockstrat-ledger` owner | Append-only invariant unaffected; webhook layer removed — Connect-RPC routes unaffected |
| `xstockstrat-notify` owner | Stream delivery unaffected; `emit-alert` and `list-alerts` survive with new paths |
| `xstockstrat-identity` owner | Auth correctness unaffected; webhook layer removed — Connect-RPC routes unaffected |
| `xstockstrat-trading` owner | Order execution correctness unaffected; webhook handler deleted — Connect-RPC routes unaffected |
| `xstockstrat-indicators` owner | Formula execution unaffected; webhook routes deleted from `app/http_server.py` and `n8n/webhook.py` |
| `xstockstrat-analysis` owner | `run-backtest` survives with new path; `score-strategy` webhook deleted |
| `xstockstrat-ingest` owner | All three ingestion endpoints survive with new paths |

## Next Action

`/sdd-review remove-n8n-references impl-spec` — validate regenerated implementation spec (revised scope: Track A delete, Track B rename), then `/sdd-execute remove-n8n-references`
