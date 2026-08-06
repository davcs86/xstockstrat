# Context: remove-n8n-references  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Not a pure rename — scope pivoted mid-flight into a two-track split: 6 services (config, ledger, identity, trading, indicators, +analysis's `score-strategy`) had their n8n webhook layer deleted entirely with no replacement, while 3 endpoint groups (ingest's 3, notify's 2, analysis's `run-backtest`) survived with only the `/n8n/` path segment dropped, because they're the agent MCP server's (009) actual ingestion callers (product-spec.md:19-41; context.md 2026-05-18T01:00:00Z).
**Why (irrecoverable rationale)**: n8n was never implemented as orchestrator, so almost every webhook had zero real callers — the "rename" framing from `/sdd-story` masked that most of these routes were dead weight (context.md 2026-05-16). The Track A/B split only emerged after impl-spec review forced a per-endpoint audit (context.md 2026-05-18T01:00:00Z).
**Rejected alternatives**:
- Keep `score-strategy` (rename path like the others) — lost because it's a one-field JSON shim over `ScoreStrategyRequest`, already reachable via Connect-RPC at the same shape; deleting it avoided a redundant caller path (context.md 2026-05-18T01:00:00Z).
- Backward-compat alias for old `/webhooks/n8n/` paths — rejected: zero existing callers, so no compat layer was needed (product-spec.md:75, FR-9).
**Scars & gotchas**:
- Four Node services (config, ledger, notify, identity-partial) each carried **two** copies of the n8n router: a live `src/n8n/webhookRouter.ts` (imported) plus an orphaned top-level `n8n/webhookRouter.ts` (dead `express.Router()`, never imported) — only discoverable by grep at execute time (context.md 2026-05-18T00:00:00Z, T02:00:00Z).
- indicators' `n8n/webhook.py` was standalone, *not* imported by `http_server.py`, which defined its own separate inline n8n routes — both deleted independently (context.md 2026-05-18T02:00:00Z).
**Permanent deviations**:
- product-spec.md FR-2's Track B table states notify's "list-alerts route removed", but FR-1 and shipped code kept it, per the user's explicit decision for agent observability (context.md 2026-05-18T01:00:00Z, T06:00:00Z) — the spec was internally contradictory; context.md's decision is what shipped.
- `implementation-roadmap.md`/`phase6-deviations.md` deliberately left untouched (declared historical) rather than updated per FR-6's letter (context.md 2026-05-18T12:00:00Z).

**Process-integrity gap**: `/sdd-spec` was run 2026-05-18T00:00:00Z while feature.md still read `draft` — the product-spec review gate (draft → spec-ready) had never actually completed — and the session proceeded "per implicit user confirmation via skill invocation" (context.md:175). This bypass exists only in this prose; feature.md's Status History and product-spec.md show no trace of it.
**Cross-feature signal**: Root `CLAUDE.md` attributes `N8N_WEBHOOK_SECRET` removal to this feature, but product-spec.md (Out of Scope, line 81) and context.md (2026-05-18T01:00:00Z) explicitly left that var untouched — likely a later feature (e.g. 097) did it; attribution needs correcting.
**Deferred follow-ons**: DO app-spec n8n vars and `add-data-source.md` open questions (product-spec.md:136-137) never confirmed resolved in context.md.
**Ledger entries written**: insights.md (2), fails.md (3) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - Root CLAUDE.md `N8N_WEBHOOK_SECRET` attribution error — route to context-scrubber/context-constitution-findings for verification.
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f5abed5.
