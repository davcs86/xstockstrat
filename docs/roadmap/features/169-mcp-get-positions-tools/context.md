# Context: mcp-get-positions-tools  (archived 2026-09-09)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-09 — /sdd-archiver

**What**: Two standalone MCP tools (`get_positions`, `get_positions_by_account_id`) backed by `ListPositions` RPC. Consolidated legacy unpaginated `list_account_positions` into paginated `list_positions`. Both user-bound with portfolio backend ownership enforcement.

**Why (irrecoverable rationale)**: Consolidation eliminates the 056 dual-path trap. `total_count` deliberately not exposed (backend never populates it).

**Rejected alternatives**: Single tool with optional `account_id` (less discoverable); client-side ownership guard (TOCTOU gap); keep old method as wrapper (dual-path trap); `including_default_value_fields=True` (shape change).

**Scars & gotchas**: F-09 prevented `--cov-fail-under` in per-step commands; AC-4 corrected pre-execution (PERMISSION_DENIED → empty list).

**Permanent deviations**: None.

**Cross-feature signal**: First proactive C-10(b) application.

**Deferred follow-ons**: None.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-09-09 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: None.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 6c53133e315c7978a97fa36aa05fcdf11aca00a9.
