# Product Spec: remove-n8n-references

**Created**: 2026-05-16

---

## Problem Statement

n8n was the originally planned orchestration layer for the platform but was never implemented. All webhook handler files, directories, and HTTP route paths carry the `/webhooks/n8n/` prefix and `n8n` naming, which is now misleading — the actual orchestrator will be the AI agent service (009, 010). These references create confusion about the platform's architecture and couple all service entry points to a tool that is not in use.

Most of these webhook endpoints exist solely because n8n workflows were the intended caller. The only webhooks with a legitimate future caller are those the agent MCP server (009) needs for signal ingestion: `ingest-signal`, `trigger-backfill`, `backfill-status` on ingest; `emit-alert` and `list-alerts` on notify; and `run-backtest` on analysis. All others are removed entirely.

## User Story

As a platform developer, I want all n8n naming removed from the codebase and documentation so that the codebase accurately reflects the agent-based architecture and new contributors are not misled into thinking n8n is a dependency.

## Functional Requirements

FR-1. Webhook endpoints are handled in two tracks:

**Track A — Delete entirely** (no replacement, no new path): these endpoints were created exclusively for n8n workflows and have no future caller. All handler files, route registrations, and imports are removed.

| Service | Endpoints removed |
|---|---|
| xstockstrat-config | `set-config`, `rollout`, `list-keys` |
| xstockstrat-ledger | `append-event`, `query-events` |
| xstockstrat-identity | `validate-token`, `create-apikey` |
| xstockstrat-trading | `place-order`, `cancel-order` |
| xstockstrat-indicators | `compute-indicator`, `execute-formula` |
| xstockstrat-analysis | `score-strategy` |

Callers that need these operations must use Connect-RPC directly (e.g. `POST /{package}.{Service}/{Method}`), which is already available on each service's HTTP port.

**Track B — Keep, rename path** (remove `/n8n/` segment only): these endpoints serve the agent MCP server's signal ingestion goal.

| Service | Endpoints kept | Old path prefix | New path prefix |
|---|---|---|---|
| xstockstrat-ingest | `ingest-signal`, `trigger-backfill`, `backfill-status` | `/webhooks/n8n/` | `/webhooks/` |
| xstockstrat-notify | `emit-alert`, `list-alerts` | `/webhooks/n8n/` | `/webhooks/` |
| xstockstrat-analysis | `run-backtest` | `/webhooks/n8n/` | `/webhooks/` |

FR-2. Handler files and directories named after n8n are handled as follows:

**Track A — Delete file entirely (no replacement created):**

| Service | File(s) deleted |
|---|---|
| xstockstrat-config | `src/n8n/webhookRouter.ts`, `n8n/webhookRouter.ts` (orphaned top-level) |
| xstockstrat-ledger | `src/n8n/webhookRouter.ts`, `n8n/webhookRouter.ts` (orphaned top-level) |
| xstockstrat-notify | `src/n8n/webhookRouter.ts`, `n8n/webhookRouter.ts` (orphaned top-level) |
| xstockstrat-identity | `src/n8n/webhookRouter.ts` |
| xstockstrat-trading | `internal/handler/n8n.go` |
| xstockstrat-indicators | `n8n/webhook.py`; inline routes deleted from `app/http_server.py` |

**Track B — Rename/update in place:**

| Service | Action |
|---|---|
| xstockstrat-ingest | Inline routes remain in `app/http_server.py`; route paths updated, function names de-n8n'd |
| xstockstrat-notify | `src/n8n/webhookRouter.ts` → `src/webhooks/router.ts`; `list-alerts` route removed; `n8n/webhookRouter.ts` (orphaned) deleted |
| xstockstrat-analysis | `score-strategy` inline route deleted from `app/http_server.py`; `run-backtest` route path updated |

FR-3. All import statements and route registrations in `src/index.ts` (Node.js) or `cmd/server/main.go` (Go) for Track A services are removed. Track B services have imports updated to the new file paths where applicable.

FR-4. The `packages/n8n/` directory (containing workflow JSON files) must be deleted. No archiving — these files describe an orchestration approach that is superseded.

FR-5. `docs/setup/n8n.md` must be replaced with a one-page stub explaining that n8n is no longer used, listing the surviving webhook endpoints under their new paths, and linking to the agent-mcp-server feature (009) as the replacement.

FR-6. All references to n8n in `CLAUDE.md` (root), service-level `CLAUDE.md` files, `docs/roadmap/implementation-roadmap.md`, and `docs/roadmap/phase6-deviations.md` must be updated to reflect the agent architecture. References in historical deviation notes may be updated to past-tense descriptions rather than deleted (they are factually accurate as history).

FR-7. The `agent-mcp-server` product spec (`docs/roadmap/features/009-agent-mcp-server/product-spec.md`) must be updated to reference `/webhooks/<action>` paths instead of `/webhooks/n8n/<action>` in its tool definitions table.

FR-8. `docs/runbooks/` references to n8n webhook paths must be updated: surviving paths renamed, deleted paths removed from examples and replaced with their Connect-RPC equivalents where applicable.

FR-9. No backward-compatibility aliases. All old `/webhooks/n8n/` paths are removed — there are no existing callers since n8n was never implemented.

## Out of Scope

- Changes to webhook handler business logic — route path changes only; request/response shapes unchanged.
- Any new webhook endpoints or capabilities.
- Renaming the `N8N_WEBHOOK_SECRET` environment variable (referenced in the 009 spec; rename is a separate change).
- Updating the DigitalOcean app specs unless they reference n8n-specific config (verify during impl-spec).
- CI workflow changes unless they reference n8n-specific steps (verify during impl-spec).

## Affected Services

- `xstockstrat-config` — webhook handler deleted entirely; `src/index.ts` webhook mount removed
- `xstockstrat-ledger` — webhook handler deleted entirely; `src/index.ts` webhook mount removed
- `xstockstrat-notify` — webhook handler file renamed; `score-strategy` removed; path updated
- `xstockstrat-identity` — webhook handler deleted entirely; `src/index.ts` webhook mount removed
- `xstockstrat-trading` — `internal/handler/n8n.go` deleted; route registrations removed from `cmd/server/main.go`
- `xstockstrat-indicators` — `n8n/webhook.py` deleted; inline routes removed from `app/http_server.py`
- `xstockstrat-analysis` — `score-strategy` route deleted; `run-backtest` path updated in `app/http_server.py`
- `xstockstrat-ingest` — route paths updated in `app/http_server.py`; function names de-n8n'd
- `packages/n8n` — deleted entirely
- `docs/` — n8n.md replaced, all cross-references updated

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/remove-n8n-references` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval per affected service (8 services — deletions and renames)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. `grep -r "webhooks/n8n" services/` returns no matches.
2. `grep -r "/n8n/" services/` returns no matches.
3. `find services/ -name "n8n*" -o -name "*n8n*"` returns no matches on files or directories.
4. `find packages/ -type d -name "n8n"` returns no matches.
5. All eight services start successfully (verified via `docker compose up`).
6. `POST /webhooks/config` on xstockstrat-config returns HTTP 404 — the webhook layer has been removed; config changes go via Connect-RPC.
7. `POST /webhooks/place-order` on xstockstrat-trading returns HTTP 404 — the webhook layer has been removed; order placement goes via Connect-RPC.
8. `POST /webhooks/ingest-signal` on xstockstrat-ingest accepts a valid payload and returns a signal_id.
9. `POST /webhooks/emit-alert` on xstockstrat-notify accepts a valid payload and emits an alert.
10. `POST /webhooks/run-backtest` on xstockstrat-analysis accepts a valid payload and returns backtest results.
11. `docs/setup/n8n.md` is replaced; no other doc page references n8n as an active dependency.
12. The 009 product spec tool definitions table references `/webhooks/<action>` paths.
13. CI passes on the feature branch (all lint and test jobs green).

## Open Questions

- [ ] Do the DigitalOcean app specs (`.do/app.dev.yaml`, `.do/app.yaml`) contain any n8n-specific environment variables or health-check paths that need updating?
- [ ] Does `docs/runbooks/add-data-source.md` reference n8n webhook paths for signal ingestion (likely yes — verify during impl-spec)?
