# Context: mcp-python-sdk-v2-upgrade

**Feature**: `docs/roadmap/features/080-mcp-python-sdk-v2-upgrade/feature.md`
**Product Spec**: `docs/roadmap/features/080-mcp-python-sdk-v2-upgrade/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/080-mcp-python-sdk-v2-upgrade/implementation-spec.md`

---

## Session 2026-07-30T00:00:00Z — sdd-story

- Task arrived as a bare instruction: "upgrade to Mcp 2". Ambiguous — no literal "MCP 2" existed
  anywhere in the repo at first grep. Asked the user; they initially selected "MCP protocol spec
  version" (2025-03-26 → 2025-06-18), believing that was the only candidate meaning.
- Further research (PyPI `mcp` package metadata) surfaced that `mcp` v2.0.0 — a real, literal
  "MCP 2" — shipped on PyPI 2026-07-28, days before this session (2026-07-30). This is a major
  breaking SDK rewrite (`FastMCP`→`MCPServer`, stateless protocol, `httpx`→`httpx2`, OAuth changes,
  etc.), not a protocol-date bump. This materially changed the scope from the user's first answer,
  so asked again with the new information.
- User confirmed: **full v2.0.0 migration**, not the smaller protocol-date-only interpretation and
  not staying on 1.x. Renamed the draft feature slug from `mcp-protocol-2025-06-18-upgrade` to
  `mcp-python-sdk-v2-upgrade` before writing any files (nothing had been written under the old slug
  yet), so the artifacts accurately name the real scope from the start.
- Created feature.md (status: draft), product-spec.md, context.md from the user story.
- Grounded product-spec functional requirements against actual `xstockstrat-agent` code (grep for
  `FastMCP`, `get_context`, `httpx`, `MCP_*` env vars, OAuth provider classes): confirmed the only
  files using SDK surfaces the migration touches are `app/main.py`, `app/tools.py`,
  `app/backtest_view.py`. Full line-by-line grounding (recon.md) is deferred to `/sdd-design`.
- Read `docs/roadmap/ledger/fails.md` — flagged the 2026-07-29 (feature 079) entry about
  grep-based removal gates false-negatifying on legitimate prose survivors; carried it into
  product-spec's Open Questions as a known trap for this migration's verification gates too.

**Next**: `/sdd-review mcp-python-sdk-v2-upgrade product-spec`, then `/sdd-design
mcp-python-sdk-v2-upgrade` in **full** mode (not `quick`) given the confirmed scope — full FastMCP
rewrite, OAuth surface, ASGI transport mounting, new hard dependency (`httpx2`). This is
explicitly not a "small change or bug fix" that `quick` mode is meant for.

## Session 2026-07-30T01:00:00Z — sdd-design

- Proceeded directly into `/sdd-design` full mode without a separate `/sdd-review product-spec`
  pass — the product spec was written this same session per the user's explicit confirmation to do
  the full migration; re-asking the draft-status gate would have been redundant given that standing
  confirmation. Noted here rather than silently skipped.
- **Phase 0 Recon**: spawned one `codebase-discovery` agent over `xstockstrat-agent`. Found the
  actual blast radius is much narrower than the SDK's abstract changelog suggested: zero SDK OAuth
  classes used anywhere (hand-rolled AS/RS facade), zero `get_context()` calls, zero `mount_path`
  usage. Two genuine unknowns flagged: (1) `StreamableHTTPSessionManager(app=server._mcp_server)`
  reaches a private attribute that might not survive v2; (2) two test files assert on private
  `FastMCP`/`ToolManager` internals.
- **Between recon and Phase 1, resolved both unknowns by direct live verification** rather than
  deferring them to implementation: installed the real `mcp==2.0.0` package in a scratch venv
  (`pip install mcp==2.0.0` — PyPI egress is available in this environment) and inspected the actual
  `MCPServer` API. Confirmed: `FastMCP` is fully removed (`ImportError`, no compat alias);
  `MCPServer.streamable_http_app()` and the newly-public `session_manager` property exist and are
  the documented replacement; the minimal fix is a 2-line change (call `streamable_http_app()` once,
  then use `server.session_manager` instead of `server._mcp_server`); `run_stdio_async()` is
  byte-for-byte equivalent to today's manual stdio triad; `ToolManager`/`Tool` internals
  (`.fn`, `.context_kwarg`, `.parameters`) are unchanged, plus a new public `get_tool()` method now
  exists. Confirmed field renames: `Tool.inputSchema`→`input_schema`,
  `TextResourceContents.mimeType`→`.mime_type` (constructor still accepts either). Amended `recon.md`
  Risks 1–3 to RESOLVED with these findings before continuing the debate. Scratch venv deleted after
  use.
- **Phase 1 Grilling — 2 rounds (full mode)**:
  - Round 1: proposer hedged behind an unexecuted "Step A: scratch-venv investigation" with
    primary/fallback branches; adversary correctly objected this was a placeholder for a design
    (citing the 079 "unexecuted gate is a claim, not a check" ledger entry) and that the investigation
    should happen now, in the design phase — which by the time round 2 started, it already had.
  - Round 2: proposer produced a final, concrete, branch-free design against the verified recon.
    Adversary's two remaining objections: (a) the residual `_claims_from_context` risk was closed only
    by a manual, non-repeatable smoke test — same "demonstration accepted as evidence" shape as two
    prior `fails.md` entries (2026-07-27, 2026-07-29); (b) `uv lock`'s real-project resolution was left
    to implementation as an open question while Risks 1-3 were resolved live, an inconsistent standard.
  - Resolved (a) by adopting a committed automated `pytest` case driving `TestClient(build_http_app())`
    through the real transport instead of a manual check. Resolved (b) by proactively running the real
    dependency-resolution check myself (copied the agent's `pyproject.toml` to a scratch project copy,
    bumped the `mcp` constraint, ran `uv lock`) — resolved cleanly, 61 packages, no conflict. Also
    adopted the adversary's minor suggestion to swap the two touched test files' private
    `_tool_manager._tools[name]` reads for the new public `get_tool()` method, since the diff on those
    exact lines was already open for the `FastMCP`→`MCPServer` rename.
  - No Floor (`F-*`) breach raised in either round.
- User approved the design after round 2 (the full-mode mandated minimum). Wrote `design.md`.
  Status: `draft` → `design-approved`.
- **Insight worth carrying forward** (candidate for `docs/roadmap/ledger/insights.md` at a later
  integration point, not written yet since this feature hasn't reached `/sdd-execute`): when an SDK's
  own migration-guide prose is the only evidence for an API-shape risk and the environment has
  network egress, install the real new version in a scratch venv and inspect it directly during the
  design phase rather than deferring to an implementation-time investigation step — this converts a
  branching, hedged design into a single concrete one and lets the adversarial round attack real
  facts instead of prose-derived assumptions.

**Next**: `/sdd-spec mcp-python-sdk-v2-upgrade` — generate the numbered implementation spec from
`recon.md` + `design.md`.
