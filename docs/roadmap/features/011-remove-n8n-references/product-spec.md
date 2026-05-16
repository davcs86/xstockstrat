# Product Spec: remove-n8n-references

**Created**: 2026-05-16

---

## Problem Statement

n8n was the originally planned orchestration layer for the platform but was never implemented. All webhook handler files, directories, and HTTP route paths carry the `/webhooks/n8n/` prefix and `n8n` naming, which is now misleading — the actual orchestrator will be the AI agent service (009, 010). These references create confusion about the platform's architecture and couple all service entry points to a tool that is not in use.

## User Story

As a platform developer, I want all n8n naming removed from the codebase and documentation so that the codebase accurately reflects the agent-based architecture and new contributors are not misled into thinking n8n is a dependency.

## Functional Requirements

FR-1. All HTTP route paths must be renamed from `/webhooks/n8n/<action>` to `/webhooks/<action>` across all eight services. The action names (e.g. `set-config`, `append-event`, `place-order`) remain unchanged — only the `/n8n/` segment is removed.

FR-2. All webhook handler files and directories named after n8n must be renamed to an orchestrator-neutral equivalent:

| Service | Old path | New path |
|---|---|---|
| xstockstrat-config | `src/n8n/webhookRouter.ts` | `src/webhooks/router.ts` |
| xstockstrat-ledger | `src/n8n/webhookRouter.ts` | `src/webhooks/router.ts` |
| xstockstrat-notify | `src/n8n/webhookRouter.ts` | `src/webhooks/router.ts` |
| xstockstrat-identity | `src/n8n/webhookRouter.ts` | `src/webhooks/router.ts` |
| xstockstrat-trading | `internal/handler/n8n.go` | `internal/handler/webhook.go` |
| xstockstrat-indicators | `n8n/webhook.py` | `app/webhooks/router.py` |
| xstockstrat-analysis | webhook routes inline in `app/http_server.py` | routes remain in `app/http_server.py`, no file rename needed |
| xstockstrat-ingest | webhook routes inline in `app/http_server.py` | routes remain in `app/http_server.py`, no file rename needed |

FR-3. All import statements, route registrations, and internal references updated to reflect the new file paths.

FR-4. The `packages/n8n/` directory (containing `workflows/config-update.json` and any other workflow files) must be deleted. No archiving — these files describe an orchestration approach that is superseded.

FR-5. `docs/setup/n8n.md` must be replaced with a one-page stub explaining that n8n is no longer used and linking to the agent-mcp-server feature (009) as the replacement.

FR-6. All references to n8n in `CLAUDE.md` (root), service-level `CLAUDE.md` files, `docs/roadmap/implementation-roadmap.md`, and `docs/roadmap/phase6-deviations.md` must be updated to reflect the agent architecture. References in historical deviation notes may be updated to past-tense descriptions rather than deleted (they are factually accurate as history).

FR-7. The `agent-mcp-server` product spec (`docs/roadmap/features/009-agent-mcp-server/product-spec.md`) must be updated to reference `/webhooks/<action>` paths instead of `/webhooks/n8n/<action>` in its tool definitions table.

FR-8. `docs/runbooks/` references to n8n webhook paths in `config-rollout.md`, `approval-flow.md`, or any other runbook must be updated to the new paths.

FR-9. No backward-compatibility aliases. The old `/webhooks/n8n/` paths are removed entirely — there are no existing callers since n8n was never implemented.

## Out of Scope

- Changes to webhook handler business logic — no functional changes, rename only.
- Any new webhook endpoints or capabilities.
- Updating the DigitalOcean app specs unless they reference n8n-specific config (verify during impl-spec).
- CI workflow changes unless they reference n8n-specific steps (verify during impl-spec).

## Affected Services

- `xstockstrat-config` — handler file rename, route path update
- `xstockstrat-ledger` — handler file rename, route path update
- `xstockstrat-notify` — handler file rename, route path update
- `xstockstrat-identity` — handler file rename, route path update
- `xstockstrat-trading` — handler file rename (`n8n.go` → `webhook.go`), route path update
- `xstockstrat-indicators` — handler directory/file rename, route path update
- `xstockstrat-analysis` — route path update in `http_server.py`
- `xstockstrat-ingest` — route path update in `http_server.py`
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
- [x] 1 service owner approval per affected service (8 services — rename + path change)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. `grep -r "webhooks/n8n" services/` returns no matches.
2. `grep -r "/n8n/" services/` returns no matches.
3. `find services/ -name "n8n*" -o -name "*n8n*"` returns no matches on files or directories.
4. `find packages/ -type d -name "n8n"` returns no matches.
5. All eight services start successfully after the rename (verified via `docker compose up`).
6. `POST /webhooks/set-config` on xstockstrat-config returns the same response as the old `/webhooks/n8n/set-config` did.
7. `POST /webhooks/place-order` on xstockstrat-trading returns the same response as the old `/webhooks/n8n/place-order` did.
8. `docs/setup/n8n.md` is replaced; no other doc page references n8n as an active dependency.
9. The 009 product spec tool definitions table references `/webhooks/<action>` paths.
10. CI passes on the feature branch (all lint and test jobs green).

## Open Questions

- [ ] Do the DigitalOcean app specs (`.do/app.dev.yaml`, `.do/app.yaml`) contain any n8n-specific environment variables or health-check paths that need updating?
- [ ] Does `docs/runbooks/add-data-source.md` reference n8n webhook paths for signal ingestion (likely yes — verify during impl-spec)?
