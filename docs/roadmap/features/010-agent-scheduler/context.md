# Context: agent-scheduler

**Feature**: `docs/roadmap/features/010-agent-scheduler/feature.md`
**Product Spec**: `docs/roadmap/features/010-agent-scheduler/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/010-agent-scheduler/implementation-spec.md`

---

## Session 2026-05-16T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Phase 2 of two-phase AI agent rollout. Phase 1 is agent-mcp-server (009).
- Hard prerequisite: 009 must ship and system prompt validated through real operator use first.
- Scheduler runs inside xstockstrat-agent alongside the MCP server — same process, shared tool registry.
- Gmail OAuth credentials stored as secret.agent.gmail.oauth_credentials_json (secret.* pattern).
- Run history captured in ledger only (agent.run.started / agent.run.completed) — no new DB table.
- Schedule and enable/disable controlled via config service (live without restart).
- Three open questions captured: catch-up scan on startup, attachment delivery to Claude, max emails per run guard.
