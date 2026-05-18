# Context: remove-n8n-references

**Feature**: `docs/roadmap/features/011-remove-n8n-references/feature.md`
**Product Spec**: `docs/roadmap/features/011-remove-n8n-references/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/011-remove-n8n-references/implementation-spec.md`

---

## Session 2026-05-18T09:00:00Z — sdd-execute step 9

**Step 9 — service: delete packages/n8n directory** [done]

- Deleted entire `packages/n8n/` directory (rm -rf) containing README.md and 8 workflow JSON files (config-update, emit-alert, ingest-signal-csv, ingest-signal-email, ingest-signal-rss, ledger-query-events, place-order). No code imports from this directory exist. Verification: find packages/n8n returned 0 files.
- Files modified: `docs/roadmap/features/011-remove-n8n-references/implementation-spec.md`, `docs/roadmap/features/011-remove-n8n-references/context.md`
- Deviations: none

## Session 2026-05-18T08:00:00Z — sdd-execute step 8

**Step 8 — service: xstockstrat-ingest — rename webhook route paths and function names** [done]

- Renamed three webhook routes in xstockstrat-ingest from `/webhooks/n8n/*` to `/webhooks/*` and updated function names from `n8n_*` to `*_webhook`: `trigger-backfill` → `trigger_backfill_webhook`, `backfill-status` → `backfill_status_webhook`, `ingest-signal` → `ingest_signal_webhook`. Updated module docstring and section comment. All three endpoints kept (Track B). CLAUDE.md n8n references intentionally left for Step 16. grep check on app/ passes.
- Files modified: `services/xstockstrat-ingest/app/http_server.py`, `docs/roadmap/features/011-remove-n8n-references/implementation-spec.md`
- Deviations: none

## Session 2026-05-18T07:00:00Z — sdd-execute step 7

**Step 7 — service: xstockstrat-analysis — remove score-strategy, rename run-backtest path** [done]

- Removed `score-strategy` webhook endpoint (L58–L66) entirely and renamed `run-backtest` from `/webhooks/n8n/run-backtest` to `/webhooks/run-backtest` with function rename `n8n_run_backtest` → `run_backtest_webhook`, updated module docstring and section comment. CLAUDE.md n8n references intentionally left for Step 16. ruff not installed in this environment; grep check on app/ passes — linting runs in CI.
- Files modified: `services/xstockstrat-analysis/app/http_server.py`, `docs/roadmap/features/011-remove-n8n-references/implementation-spec.md`
- Deviations: ruff not available; fell back to grep-based verification on app/ directory (same as Step 5)

## Session 2026-05-18T06:00:00Z — sdd-execute step 6

**Step 6 — service: xstockstrat-notify — rename webhook router and update paths** [done]

- Renamed n8n webhook layer in xstockstrat-notify to generic webhook layer: created `src/webhooks/router.ts` from `src/n8n/webhookRouter.ts` with 11 targeted changes (logger name, JSDoc, function names, endpoint paths, error messages), updated `src/index.ts` imports and dispatch condition, deleted old `src/n8n/webhookRouter.ts` and orphaned `n8n/webhookRouter.ts` files, cleaned up empty directories. Webhook endpoints `/webhooks/emit-alert` and `/webhooks/list-alerts` remain with new paths; default `source_service` changed from 'n8n' to 'webhook'.
- Files modified: `services/xstockstrat-notify/src/webhooks/router.ts` (created), `services/xstockstrat-notify/src/index.ts`, `docs/roadmap/features/011-remove-n8n-references/implementation-spec.md`
- Deviations: none

## Session 2026-05-18T03:30:00Z — sdd-execute step 1

**Step 1 — service: xstockstrat-config — delete webhook layer** [done]

- Removed n8n webhook layer from xstockstrat-config: deleted `src/n8n/webhookRouter.ts` and orphaned `n8n/webhookRouter.ts` files, removed import and router invocation from `src/index.ts`, cleaned up empty directories.
- Files modified: `services/xstockstrat-config/src/index.ts`, `docs/roadmap/features/011-remove-n8n-references/implementation-spec.md`, `docs/roadmap/features/011-remove-n8n-references/feature.md`
- Deviations: none

## Session 2026-05-18T05:30:00Z — sdd-execute step 5

**Step 5 — service: xstockstrat-indicators — delete webhook routes and standalone file** [done]

- Removed n8n webhook routes from xstockstrat-indicators: deleted `n8n/webhook.py` standalone file and empty `n8n/` directory, removed inline webhook route decorators and functions from `app/http_server.py`, updated module docstring. Verification showed no n8n references in code (CLAUDE.md references remain for later docs updates).
- Files modified: `services/xstockstrat-indicators/app/http_server.py`, `docs/roadmap/features/011-remove-n8n-references/implementation-spec.md`
- Deviations: none

## Session 2026-05-18T05:00:00Z — sdd-execute step 4

**Step 4 — service: xstockstrat-trading — delete webhook handler** [done]

- Removed n8n webhook handler from xstockstrat-trading: deleted `internal/handler/n8n.go`, removed handler instantiation and route registrations from `cmd/server/main.go`, updated HTTP server comment. Go build verification passed.
- Files modified: `services/xstockstrat-trading/cmd/server/main.go`, `docs/roadmap/features/011-remove-n8n-references/implementation-spec.md`
- Deviations: none

## Session 2026-05-18T04:30:00Z — sdd-execute step 3

**Step 3 — service: xstockstrat-identity — delete webhook layer** [done]

- Removed n8n webhook layer from xstockstrat-identity: deleted `src/n8n/webhookRouter.ts` and removed empty `src/n8n/` directory (note: identity has no top-level n8n dir unlike config/ledger), removed import and router invocation from `src/index.ts`, removed webhook dispatch block from HTTP request handler.
- Files modified: `services/xstockstrat-identity/src/index.ts`, `docs/roadmap/features/011-remove-n8n-references/implementation-spec.md`
- Deviations: none

## Session 2026-05-18T04:00:00Z — sdd-execute step 2

**Step 2 — service: xstockstrat-ledger — delete webhook layer** [done]

- Removed n8n webhook layer from xstockstrat-ledger: deleted `src/n8n/webhookRouter.ts` and orphaned `n8n/webhookRouter.ts` files, removed import and router invocation from `src/index.ts`, cleaned up empty directories.
- Files modified: `services/xstockstrat-ledger/src/index.ts`, `docs/roadmap/features/011-remove-n8n-references/implementation-spec.md`
- Deviations: none

## Session 2026-05-18T02:00:00Z — sdd-spec (regeneration)

- Regenerated implementation-spec.md with 16 steps to reflect the revised product spec scope (Track A = delete entirely, Track B = rename path only).
- Status remains `implementation-ready`.
- Key codebase findings confirming revised scope:
  - Track A services confirmed: config `src/index.ts` L67 and L51 reference `n8n` router; ledger L66 and L55; identity L61 and L50; trading `cmd/server/main.go` L134, L138, L139; indicators `app/http_server.py` L60 and L73 define inline `n8n_*` routes.
  - Track B services confirmed: notify `src/n8n/webhookRouter.ts` serves `emit-alert` and `list-alerts` (both kept); analysis `app/http_server.py` L46 `run-backtest` kept + L58 `score-strategy` deleted; ingest `app/http_server.py` L52/L64/L72 all three kept.
  - `n8n/webhook.py` in indicators is a standalone file (NOT imported by http_server.py) — both the standalone file and the inline routes in http_server.py must be deleted.
  - Identity has no top-level `n8n/` directory (unlike config, ledger, notify which all have orphaned top-level `n8n/webhookRouter.ts`).
  - `packages/n8n/` contains 7 workflow JSON files + README — all deleted in Step 9.
  - Integration test `scripts/integration-test.sh` function `section_12_n8n_webhook()` uses old path at L405, L423, L439, L470 (Step 15).
  - `docs/setup/alpaca.md` L212 references deleted `place-order` webhook — Step 14 must update to Connect-RPC equivalent.

## Session 2026-05-18T01:00:00Z — product-spec revision

- Scope expanded beyond rename-only after impl-spec review and user decision.
- Key decision: webhooks that existed solely for n8n are deleted entirely; only endpoints serving the agent MCP server's ingestion goal are preserved (with path rename).
- Track A (delete entirely): config (set-config, rollout, list-keys), ledger (append-event, query-events), identity (validate-token, create-apikey), trading (place-order, cancel-order), indicators (compute-indicator, execute-formula), analysis (score-strategy).
- Track B (keep + rename path): ingest (all 3), notify (emit-alert, list-alerts), analysis (run-backtest).
- `score-strategy` on analysis was evaluated: it is a one-field JSON shim over `ScoreStrategyRequest`; the identical call is already available via Connect-RPC at `/xstockstrat.analysis.v1.AnalysisService/ScoreStrategy`. Deleted.
- `list-alerts` on notify: explicitly kept by user decision (useful for agent observability).
- `N8N_WEBHOOK_SECRET` env var name left unchanged — renaming is out of scope.
- Product-spec.md, feature.md updated. Implementation spec is now stale — must re-run /sdd-spec.
- Next: /sdd-spec remove-n8n-references

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
