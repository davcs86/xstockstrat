# Context: screener-agent-tool

**Feature**: `docs/roadmap/features/061-screener-agent-tool/feature.md`
**Product Spec**: `docs/roadmap/features/061-screener-agent-tool/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/061-screener-agent-tool/implementation-spec.md`

---

## Session 2026-06-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md. Feature 4 of 6 (optional).
- Mirrors the existing `run_backtest` agent tool exactly (FastMCP decorator → per-call grpc.aio
  channel, `x-mcp-secret` metadata, no connection pool). Read-only / non-admin.
- Split out as its own feature per the 053 precedent of deferring the agent tool from the core feature.
