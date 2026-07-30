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
