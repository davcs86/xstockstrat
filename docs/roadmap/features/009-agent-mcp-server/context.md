# Context: agent-mcp-server  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Phase 1 of the AI-agent rollout shipped as a manually-triggered Python MCP server (`xstockstrat-agent`, port 9000) that bridges Claude.ai (via the Gmail MCP server) to existing webhook endpoints (ingest/notify/analysis) — deliberately no scheduler, no Gmail API integration of its own, operator drives every call. Scope grew mid-flight from local-only to a full DO deployment behind nginx SSE with identity-service API-key auth (context.md:44-51).
**Why (irrecoverable rationale)**: Two-phase rollout was chosen so Phase 1 proves the tool surface with a human in the loop before Phase 2 (`agent-scheduler`) automates it (context.md:12, product-spec.md:9). Deterministic (not model-driven) alerting was demanded by the operator mid-execute: the model choosing "when to emit_alert" was judged too unreliable for an irreversible side-effect, so conviction-threshold auto-emit was moved into code (context.md:180-183).
**Rejected alternatives**:
- Model decides whether to call `emit_alert` — rejected for non-determinism; replaced by hardcoded 0.6 threshold (context.md:180-184), then rejected as inflexible → env var `MCP_ALERT_THRESHOLD` (context.md:187-192), then rejected again (didn't fit config-governance model) → config-service key `signal.alert_threshold` (context.md:194-201). Three successive rejections on one requirement.
- Local-only agent (initial design) — rejected in favor of nginx+DO exposure once SSE remote access was wanted (context.md:44-51).
- Direct port 9000 exposure — rejected; SSE routed through nginx `/agent/sse` with `proxy_read_timeout 3600s` and identity `ValidateApiKey` auth (context.md:38-39,48).
- Per-source `extractor_tool` routing config, and routing via 008's `config_json` — both rejected in favor of a type-level `source_type`→`extractor_tool` mapping owned by the agent service, because per-source routing "would require a shadow registry in 009"; the extraction mechanism is treated as definitional of the source type itself, so new mediated-extraction paths require a new 008 type rather than new 009 config (product-spec.md:140, Open Questions).
**Scars & gotchas**:
- `mcp` lowlevel `Server` has no `.tool()` decorator — must use `FastMCP` and call `._mcp_server.run()` for stdio/SSE; discovered only at Step 10 test-writing (context.md:245,266).
- Module-level client vars in `app/client.py`/`tools.py` are read at import time, so tests must `setattr` post-import in the conftest fixture, not just monkeypatch env (context.md:247).
- Config-key double-prefixing bug: `get_config_value` already scopes by `namespace="agent"`, so the key must be `"signal.alert_threshold"`, not `"xstockstrat-agent.signal.alert_threshold"` — caught only after Step 6 was drafted (context.md:211).
- DO app spec must omit `source_dir` for this service (build context needs repo root for proto-stubs COPY) — confirmed only by checking nginx's existing precedent (context.md:225,228).

**Permanent deviations (shipped contradicts design/original scope)**:
- Env var name churned twice post-spec: `N8N_WEBHOOK_SECRET` → `WEBHOOK_SECRET` → `MCP_AGENT_SECRET`, because feature 011 had already deleted the n8n concept the first name referenced (context.md:67-79).
- grpcio pinned `>=1.80.0` vs spec's `>=1.63.0`, matching ingest, operator-approved deviation (context.md:120).
- Service-side `x-mcp-secret` enforcement was explicitly Out of Scope at product-spec time, then pulled in-scope mid-flight "at operator request" (context.md:81-90): added FR-9/Step 12, landing new permanent middleware in three *other* services (ingest, notify, analysis) that this feature's original boundary excluded — a scope expansion that reached beyond the agent service itself, distinct from the local→DO deployment-scope growth above.
**Permanent deviations**: none
**Cross-feature signal**: The multi-round env-var renaming is what drove the root `CLAUDE.md` "Environment Variable Naming Convention" section into existence (context.md:71).
**Deferred follow-ons**: Phase 2, `agent-scheduler`, adds the cronjob/automation layer this feature deliberately left out (context.md:12).
**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f5abed5.
