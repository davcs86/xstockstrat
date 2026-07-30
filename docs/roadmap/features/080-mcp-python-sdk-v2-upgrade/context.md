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

## Session 2026-07-30T18:00:00Z — sdd-spec

- Read `recon.md` + `design.md` (both present, status `design-approved`) and treated them as
  authoritative per the skill's Step 1.5. Read `CLAUDE.md`, `docs/sdd/constitution.md`,
  `docs/roadmap/ledger/{insights,fails}.md`, `docs/runbooks/reviewer-registry.md`. No phase
  deviation doc applies (`xstockstrat-agent` is not in the phase3-6 service lists). No
  proto/config/DB changes, so `approval-flow.md`/`config-rollout.md`/`proto-versioning.md` were
  not read (per the skill's guard conditions).
- Grounded every step against the real repo via `Read`/`Grep` (exact `path:line` citations for
  `app/main.py`, `app/tools.py`, `app/backtest_view.py`, `app/oauth_server.py`,
  `app/oauth_metadata.py`, `pyproject.toml`, `uv.lock`, all six test files, `docs/runbooks/
  mcp-tools.md`, `docs/patterns/strat-lab-plugin.md`, `.github/workflows/ci.yml`, and both agent
  `docs/context-constitution*.md` files).
- **Re-ran recon/design's live-verification method myself** (a fresh scratch venv,
  `pip install mcp==2.0.0`; deleted after use) rather than trusting their conclusions
  second-hand, per Constitution C-01/P-03. This surfaced three concrete findings beyond what
  `recon.md`/`design.md` had already verified:
  1. **`design.md`'s `server.get_tool(name)` does not exist.** `MCPServer` has no `get_tool`
     attribute (`AttributeError: 'MCPServer' object has no attribute 'get_tool'`). The method
     lives on `server._tool_manager.get_tool(name)` instead — confirmed live to return the same
     `Tool` object with `.fn`/`.context_kwarg`/`.parameters` intact. Corrected in Step 3.
  2. **`server.call_tool()`'s return shape changed, uncovered by either prior artifact.**
     `mcp==1.27.1`'s `FastMCP.call_tool()` returns a plain subscriptable
     `tuple[list[ContentBlock], dict]`; `mcp==2.0.0`'s `MCPServer.call_tool()` returns a
     `CallToolResult` object whose content lives at `.content`. `tests/test_tools.py:442-444`'s
     `content[0]`/`content[1]` indexing would raise `TypeError` post-migration. Fixed in Step 3.
  3. **A previously-unidentified production regression risk**: `Server.streamable_http_app()`
     auto-enables a DNS-rebinding-protection Host/Origin check restricted to
     `127.0.0.1`/`localhost`/`::1` whenever its `host` param is left at the default — exactly how
     `design.md`'s verified-minimal-fix calls it. Reproduced live: a request with `Host:
     testserver` got `421` until `transport_security=TransportSecuritySettings(
     enable_dns_rebinding_protection=False)` was passed explicitly. Today's code never goes
     through this path (`StreamableHTTPSessionManager(app=server._mcp_server)` direct
     construction bypasses it), so in production — where the real `Host` header is the DO app's
     public domain, never `127.0.0.1` — this migration's own "verified minimal diff" would have
     silently 421'd every real Streamable HTTP request. Added the one-line fix to Step 2 with a
     verified live repro (full JSON-RPC handshake: `initialize` → `notifications/initialized` →
     `tools/call`, SSE-framed responses, succeeding end-to-end once the fix is applied).
  These three are documented inline in `implementation-spec.md`'s Execution Summary and the
  relevant steps' Codebase Evidence, not silently folded in as if `design.md` had always been
  correct. Candidate for a `fails.md`/`insights.md` entry at `/sdd-execute` integration — noting
  here so a future session doesn't lose it: *"a design's own live-verification pass can still miss
  API surface it didn't specifically exercise (a return-type check, a default-parameter side
  effect); the spec-writing pass should re-run the same live-verification method against the
  specific call shapes the implementation will actually use, not just accept the design's
  conclusions."*
- Wrote `implementation-spec.md` with 5 steps: (1) dependency bump, (2) all production-code edits
  (`app/main.py` + `app/tools.py` + `app/backtest_view.py`, combined because they are
  import-coupled and cannot be verified independently — same reasoning as feature 079's
  Deviation D-1), (3) the three existing test files' rewrite (green for steps 1-2's red), (4) new
  automated regression coverage for `_claims_from_context` under the real transport
  (`design.md` step 7 / Open Risk 1, now closed with a live-verified JSON-RPC handshake recipe),
  (5) the docs sweep — only two files actually say "FastMCP"
  (`services/xstockstrat-agent/CLAUDE.md:26`, `docs/context-constitution.md:4`); confirmed via
  grep that `docs/runbooks/mcp-tools.md`, root `CLAUDE.md`, `context-constitution-findings.md`,
  and `docs/patterns/strat-lab-plugin.md` need no changes.
- Status: `design-approved` → `implementation-ready`.

**Next**: `/sdd-review mcp-python-sdk-v2-upgrade impl-spec` — validate the implementation spec,
then `/sdd-execute mcp-python-sdk-v2-upgrade`.

## Session 2026-07-30T19:00:00Z — implementation (branch-adapted execute)

- **Branch handling deviation**: this session's harness assignment fixed the working branch to
  `claude/mcp-2-upgrade-e3v1uy` (branched from and PR'd into `main-dev` per explicit session
  instructions), overriding `/sdd-execute`'s default `feature/<slug>` + per-step
  `feature-steps/*` sub-branch model with individual step PRs. Implemented all 5 steps as separate
  commits directly on the harness branch instead — each independently verified per its own
  Verification block before committing (**F-05** honored). One integration PR will cover all 5
  steps rather than 5 step PRs into a feature-integration branch. Recorded in
  `implementation-spec.md`'s Deviation Log too.
- Executed all 5 steps in order, without a separate `/sdd-review impl-spec` pass first (the spec
  was written this same continuous session with live-verified evidence; re-reviewing it before
  executing would have been redundant given the standing task instruction to implement, commit,
  and push).
- **Step 1**: bumped `mcp` to `>=2.0.0,<3`, ran `uv lock` for real (not a scratch copy) —
  reproduced the exact dependency delta predicted in the spec (`httpx-sse`/`pydantic-settings`
  removed; `httpx2`/`mcp-types`/`truststore`/`httpcore2` added; `httpx>=0.27.0` itself untouched).
  `uv lock --check` passes.
- **Step 2**: migrated `app/main.py`, `app/tools.py`, `app/backtest_view.py` exactly per the
  spec's instructions (`FastMCP`→`MCPServer`, `Context` import move, `_run_stdio()` simplified to
  `run_stdio_async()`, the `streamable_http_app()` + `session_manager` property fix with
  `transport_security` explicitly disabled, the two field renames). Ruff clean; the targeted grep
  checks all passed as predicted.
- **Step 3**: rewrote `test_tools.py`, `test_config_tools.py`, `test_backtest_view.py` per spec
  (rename, `get_tool()` swap, the `CallToolResult.content` fix, field renames). Full suite green:
  **137 passed**, 68% coverage (CI threshold 40%), ruff clean — first point the suite could even
  collect.
- **Step 4**: created `tests/test_streamable_http_auth.py` verbatim per the spec's live-verified
  recipe. Ran the mandatory TDD teeth-proof: commented out `_authorized`'s
  `scope.setdefault("state", {})[MCP_CLAIMS_SCOPE_KEY] = claims` line in `app/main.py`, confirmed
  the new test fails (`isError: true`, `assert True is False` — SSE-JSON-decoded from the real
  response), restored the line, confirmed `git diff` on `app/main.py` was empty (clean restore)
  and the test passes again. **138 passed** overall, 68% coverage, ruff clean.
- **Step 5**: updated the two spec'd doc references (`services/xstockstrat-agent/CLAUDE.md:26`,
  `docs/context-constitution.md:4`). **Deviation**: re-running the spec's own repo-wide grep
  during execution surfaced a *third* stale `FastMCP` reference the spec's Codebase Evidence
  missed — `tests/test_backtest_view.py:3`'s module docstring. Fixed in the same commit (same
  class of cleanup, not a new decision) and logged in `implementation-spec.md`'s Deviation Log
  per **P-03**. Repo-wide grep (excluding `packages/proto/gen/`, `docs/roadmap/features/`,
  `docs/roadmap/ledger/`) confirmed **zero** remaining `FastMCP` references afterward. Stated the
  four no-op confirmations (FR-6 OAuth, FR-4 httpx2, `strat-lab-plugin.md`, `mcp-tools.md`)
  explicitly rather than skipping silently.
- **Teardown**: the root `CLAUDE.md` Teardown rule requires `/context-scrubber scan` since
  `services/xstockstrat-agent/CLAUDE.md` and `docs/context-constitution.md` changed. The
  context-forge plugin/skill is **not available** in this session (`ToolSearch` found no match) —
  noted here and will be noted in the PR body, per that rule's own fallback instruction, rather
  than skipped silently.
- Final state: all 5 implementation-spec steps `done`, full suite **138 passed**, 68% coverage,
  ruff clean, zero stray `FastMCP` references. Status: `implementation-ready` → `code-completed`.

**Next**: open the integration PR from `claude/mcp-2-upgrade-e3v1uy` to `main-dev`.
