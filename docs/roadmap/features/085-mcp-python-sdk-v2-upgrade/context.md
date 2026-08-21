# Context: mcp-python-sdk-v2-upgrade  (archived 2026-08-19)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-19 — /sdd-archiver

**What**: A one-PR mechanical migration of `xstockstrat-agent` (the monorepo's sole `mcp` consumer) from `mcp` 1.27.1 → 2.0.0 (`FastMCP`→`MCPServer`). The abstract v2 changelog (OAuth SEP changes, stateless protocol, `httpx`→`httpx2`, context injection for all 17 tools) implied a large blast radius, but grounding showed ~2 production files of real change plus test renames: the OAuth surface was 100% hand-rolled and never touched the SDK's client classes (FR-6 no-op), and the only `httpx` call was app-level (FR-4 no-op; `httpx2` arrived only as a transitive dep). The single genuinely risky edit was the ASGI transport reconstruction.

**Why (irrecoverable rationale)**: The task arrived as bare "upgrade to Mcp 2". The user first read it as a protocol-date bump (2025-03-26 → 2025-06-18); PyPI research then surfaced that a literal `mcp` v2.0.0 had shipped 2026-07-28 (two days before the session), a breaking SDK rewrite — a materially larger scope, re-confirmed with the user because of that discovery. Grepping the shipped code shows a completed v2 migration; it does not show that the meaning of the request itself was contested and re-decided. FR-6/FR-4 shipped as deliberate documented no-ops after recon proved the changelog's scary items didn't apply — the absence of OAuth/httpx changes is a reasoned conclusion, not an oversight.

**Rejected alternatives**:
- Staying on 1.x / protocol-date-only bump — lost once the user confirmed the full v2.0.0 scope.
- A hedged design with primary/fallback branches gated behind an unexecuted "scratch-venv investigation" step — lost because it left the highest-risk decision (ASGI transport survival) undecided at design time; the round-1 adversary cited 079's "an unexecuted gate is a claim, not a check".
- Manual/uncommitted smoke test as sole closure of the transport risk — lost as the "demonstration accepted as evidence, never re-run" anti-pattern (fails.md 2026-07-27, 07-29); replaced with a committed `TestClient` JSON-RPC regression test.
- Isolated `mcp`-only scratch venv for the `uv lock` check — lost to copying the whole real project and locking there.
- Renaming the `/api/tools` JSON key `"inputSchema"` → `input_schema` — rejected: that key is the service's own UI-facing contract, not an SDK wire format.

**Scars & gotchas**: DNS-rebinding 421 near-miss (highest value) — `Server.streamable_http_app()` (delegated to by `MCPServer.streamable_http_app()`) auto-enables a DNS-rebinding Host/Origin check restricted to `127.0.0.1`/`localhost`/`::1` whenever its `host` param is left at default, exactly how the "verified minimal diff" called it; in production the real `Host` is the DO public domain, so the migration's own minimal fix would have silently 421'd every real Streamable HTTP request. v1 never hit this (constructed `StreamableHTTPSessionManager(app=server._mcp_server)` directly). Fix: pass `transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False)`; found only by driving a live `TestClient` request. `MCPServer.session_manager` raises `RuntimeError` unless `streamable_http_app()` has been called once first to prime it. Streamable HTTP responses are SSE-framed (`event: message\ndata:{...}`), not plain JSON, and require echoing the `mcp-session-id` header across the 3-message handshake.

**Permanent deviations**: design.md step 6 said `server.get_tool(name)` → shipped `server._tool_manager.get_tool(name)` because `MCPServer` has no `get_tool` (the method lives on `ToolManager`); caught by /sdd-spec re-verification. Neither design nor recon covered that `call_tool()`'s return changed from a subscriptable `tuple[list, dict]` (v1) to a `CallToolResult` with `.content` (v2) — `test_tools.py`'s `content[0]/[1]` indexing would have raised `TypeError`; corrected at spec time. `/api/tools` response key deliberately stays camelCase `"inputSchema"` while the SDK attribute read moved to snake_case `input_schema` — a deliberate split that reads like a bug once design.md is gone. The same camelCase/snake_case shape recurs in `app/backtest_view.py`: the `TextResourceContents` constructor keeps `mimeType=` (:104) while the read side uses `.mime_type` (:118) — a pure pydantic-alias quirk of the pinned `mcp==2.0.0`, noted so a future reader doesn't "fix" it.

**Cross-feature signal**: A case study in three prior ledger lessons recurring and being caught by the ledger — 079's "unexecuted gate is a claim, not a check" (round-1 hedge), the 2026-07-27/07-29 "demonstration-as-evidence" anti-pattern (manual smoke test), and 079 Deviation D-1 "combine import-coupled edits into one reviewable step" (reused as Step 2).

**Deferred follow-ons**: none. (`MCP_AGENT_SECRET`'s feature-073 triple-purpose was noted out-of-scope and untouched.)

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-19 `mcp-python-sdk-v2-upgrade` entries.

**Runtime-invariant recommendations (→ /context-constitution)**: AGENT-* candidate for `services/xstockstrat-agent/docs/context-constitution.md` — `mcp` v2's `MCPServer.streamable_http_app()` auto-enables DNS-rebinding Host/Origin protection (localhost-only allowlist) unless `transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False)` is passed; leaving it default 421s every non-localhost (production) request. Also: `session_manager` requires a prior `streamable_http_app()` call or raises `RuntimeError`. Currently only an inline code comment in `app/main.py`.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 1d97c6c.
