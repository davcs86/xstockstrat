# Context: screener-agent-tool  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped exactly as designed — an eleventh MCP tool, `screen_symbols`, added to `xstockstrat-agent` as a pure delegating wrapper (`tools.py`) over a new client method (`client.py`) that mirrors `run_backtest`'s per-call `grpc.aio` channel pattern verbatim: no pooling, no admin `x-access-scope`, only `_metadata()`'s `x-mcp-secret`. Zero deviations recorded at execute time (implementation-spec.md:334-347).
**Why (irrecoverable rationale)**: Split into its own feature rather than folded into 060 (screener-engine) "per the 053 precedent of deferring the agent tool from the core feature" (context.md:14) — i.e. an established, deliberate house pattern of decoupling MCP-tool exposure from the engine that implements it, not visible anywhere in code.
**Rejected alternatives**:
- `watchlist_id` resolution path in the tool (auto-resolving a watchlist to symbols server-side) — rejected in favor of explicit-symbol-list-only, to match 060's own resolved OQ-060-a; watchlist resolution deliberately kept at the UI/agent caller layer, deferred as an "additive follow-up" (product-spec.md:74-77, context.md:13).
- A dedicated `_admin_metadata()` helper — the initial product-spec draft referenced this phantom function; sdd-review caught it (no such symbol exists) and corrected FR-3 to the real inline pattern `list(_metadata()) + [("x-access-scope","7")]` (context.md:27-28). Signal that spec drafts can hallucinate helper names that must be verified against the codebase before they reach implementation-ready.
**Scars & gotchas**:
- Tool count/enumeration is duplicated across four independent locations (agent `CLAUDE.md`, `docs/runbooks/mcp-tools.md`, `docs/runbooks/CLAUDE.md` index line, and `app/tools.py`'s own docstring header) and they drift silently — `mcp-tools.md` already said "nine" while `CLAUDE.md` said "ten" *before* this feature even touched it (context.md:54-56, implementation-spec.md:300-304). Every tool-adding feature must grep all four for stale counts, not just update the one it touched.
- Hard build-order gate: could not `/sdd-execute` until 060's proto stubs existed — branched off `origin/feature/screener-engine` instead of `main-dev`, PR targeted the parent feature branch, not `main-dev` directly (context.md:70-73). Recoverable going forward from `merge-order.md`, but the *mechanic* (branch off the sibling feature branch, PR into it) is a pattern worth remembering for any future dependent-feature pair.
**Permanent deviations**: none — implementation-spec.md:334 confirms no deviations.
**Cross-feature signal**: Confirms a repeatable house pattern (also seen in 053): when a core engine feature lands, exposing it as an MCP agent tool is deliberately split into a *separate*, later, thin feature that mirrors an existing tool's exact structure — reducing design risk to near-zero (this feature never ran `/sdd-design`; went `spec-ready` → `implementation-ready` directly, feature.md:16-18).
**Deferred follow-ons**: - `watchlist_id` convenience resolution for `screen_symbols` (and for 060's `ScreenSymbols` RPC itself) remains an open, unscheduled additive follow-up.
**Ledger entries written**: insights.md (2), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f871138.
