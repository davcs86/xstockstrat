# Context: remove-n8n-references

**Feature**: `docs/roadmap/features/011-remove-n8n-references/feature.md`
**Product Spec**: `docs/roadmap/features/011-remove-n8n-references/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/011-remove-n8n-references/implementation-spec.md`

---

## Session 2026-05-18T00:00:00Z — sdd-spec

- Generated implementation-spec.md with 16 steps. Status → implementation-ready.
- Key codebase findings:
  - Four Node.js services (config, ledger, notify, identity) each have TWO n8n webhook router files: a live one at `src/n8n/webhookRouter.ts` (imported by `src/index.ts`) and an orphaned one at `<service>/n8n/webhookRouter.ts` (top-level, uses express.Router(), never imported). Both must be deleted in Steps 1–4.
  - Identity service has no top-level `n8n/` directory — only `src/n8n/`. All others that have top-level n8n dirs: config, ledger, notify.
  - indicators: `n8n/webhook.py` is a standalone file NOT imported by `app/http_server.py`. The http_server.py defines its own inline webhook routes. Both must be updated.
  - analysis and ingest: no separate n8n/ directory — webhook routes are inline in `app/http_server.py` only.
  - packages/n8n contains 7 workflow JSON files + README. Deleted entirely in Step 9.
  - Integration test script `scripts/integration-test.sh` has a `section_12_n8n_webhook()` function that uses the old paths (Step 15).
  - docs/setup/alpaca.md has 4 curl examples with old `/webhooks/n8n/` paths (Step 14).
  - docs/runbooks/add-data-source.md has the most n8n references of any runbook (Step 11).
  - 009 product spec tool definitions table has 3 paths to update (Step 13).
  - Feature was in `draft` status when /sdd-spec was run (product-spec review had not been completed). Proceeding per implicit user confirmation via skill invocation.

## Session 2026-05-16T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: n8n was planned as the orchestration layer but never implemented; platform moving to AI agent architecture (009, 010).
- No functional changes — rename and path update only. Zero existing callers, so no backward compatibility needed.
- New canonical webhook path prefix: /webhooks/<action> (drops the /n8n/ segment).
- packages/n8n/ deleted (not archived) — superseded by agent approach.
- docs/setup/n8n.md replaced with stub pointing to 009.
- 009 product spec must be updated as part of this feature (references old /webhooks/n8n/ paths).
- Two open questions: DO app spec n8n env vars, add-data-source.md runbook references.
