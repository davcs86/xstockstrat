# Context: agent-mcp-server

**Feature**: `docs/roadmap/features/009-agent-mcp-server/feature.md`
**Product Spec**: `docs/roadmap/features/009-agent-mcp-server/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/009-agent-mcp-server/implementation-spec.md`

---

## Session 2026-05-16T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Phase 1 of two-phase AI agent rollout. Phase 2 is agent-scheduler (scheduled cronjob).
- No scheduler, no Gmail API — operator pastes email content into Claude.ai manually.
- All tool calls go via existing HTTP webhook endpoints; no new gRPC connections from this service.
- MCP server sends x-webhook-secret header on all downstream calls — first caller to honour the documented-but-unimplemented webhook secret convention.
- Prerequisite: signal-source-registry (008) must ship first so list_signal_sources returns valid slugs.
- Port 9000 assigned; requires Platform Lead approval as new service addition.
