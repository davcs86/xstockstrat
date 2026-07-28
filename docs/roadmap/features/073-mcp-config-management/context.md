# Context: mcp-config-management

**Feature**: `docs/roadmap/features/073-mcp-config-management/feature.md`
**Product Spec**: `docs/roadmap/features/073-mcp-config-management/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/073-mcp-config-management/implementation-spec.md`

---

## Session 2026-07-28 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Trigger: while setting up staging paper-trading alerts, hit the fundamentals-pipeline gap
  (features 059/062 disabled by config flags `marketdata.fmp.enabled` /
  `analysis.fundsignal.enabled`, and `secret.marketdata.fmp.api_key` unset) with no MCP tool, CLI
  script, or config-ui path to fix it — only a raw `SetConfig` gRPC call. User asked to add this
  gap to the feature backlog.
- Read `docs/runbooks/feature-workflow.md`, `docs/runbooks/reviewer-registry.md`,
  `docs/roadmap/ledger/fails.md`, `docs/roadmap/ledger/insights.md` per SDD boot sequence.
- Key ledger read applied: 2026-07-20 (`trigger-backfill-mcp-tool`, design) — a new MCP tool has
  multiple discovery/documentation surfaces (tools.py, agent CLAUDE.md, mcp-tools.md, runbooks
  index, and the task-oriented operational runbook — here `config-rollout.md`). Folded into FR-6.
- No directly-applicable `fails.md` entry found for this specific shape (new admin MCP tool over
  an existing RPC); the closest security-relevant registry entry is the `xstockstrat-agent` row's
  standing "no secret values in tool output" invariant, applied here as FR-4.
- Confirmed via direct inspection (this session, prior to /sdd-story) that `GetConfig`,
  `SetConfig`, `ListKeys` RPCs already exist (`packages/proto/config/v1/config.proto:17-27`) — no
  proto changes anticipated for this feature.
- Flagged as an explicit **known trap** in product-spec Out of Scope: `secret.*` config values
  have no real secret-store resolution today (`SetConfig` stores plaintext); this feature must not
  be designed/reviewed as if it adds secret encryption.
