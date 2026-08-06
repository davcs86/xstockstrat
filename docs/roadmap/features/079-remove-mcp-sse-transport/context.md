# Context: remove-mcp-sse-transport  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped as one 8-step PR (not 8 stacked step PRs) removing the legacy `/sse` + `POST /messages` MCP transport, replacing it with a pre-auth 404 branch, and making `MCP_TRANSPORT`/`MCP_SSE_PORT` deprecated aliases rather than a hard cutover — so no deployment file *had* to change for the agent to keep serving MCP (feature.md:19; context.md:246-301).
**Why (irrecoverable rationale)**: The SSE tool-call channel was unauthenticated at the transport layer — `handle_mcp` returned for `path == "/messages"` before the `_authorized` gate, so auth was checked only once at stream-open, never per message. Feature 073 had already been forced to restrict `set_config` to Streamable HTTP solely because of this hole; 079 removes the need for that workaround rather than plumbing auth through SSE too, verified against the installed SDK that both transports *do* get a Starlette `Request` — the gap was authentication, not request access (context.md:7-19).
**Rejected alternatives**:
- Hardening SSE with per-message re-auth — rejected up front: SSE is spec-deprecated in favor of Streamable HTTP, so hardening a dying channel spends effort twice (product-spec.md problem statement).
- Staged/deprecation-window rollout — rejected because the only client (one operator's own `claude_mcp_config.json`) is fully controlled, the surviving transport is already served on the same port/process, and leaving the auth hole open for a deprecation window defeats the point (context.md:247-252).
- `importlib.reload` and `monkeypatch.setattr(main, "MCP_TRANSPORT", …)` for testing env resolution — both silently broke other fixtures or left the alias logic unreachable (design.md Rejected Alternatives, being deleted).
**Scars & gotchas**: [DUP:docs/roadmap/ledger/insights.md:356, insights.md:381, fails.md:109] — AC-5 grep-gate unsatisfiability (3 real failures) and the `main()` extraction lesson are already fully captured there.
**Permanent deviations**: none — design.md explicitly logged D-1/D-2/D-3 as within-plan deviations, all reconciled before merge (context.md:271-282).
**Cross-feature signal**: The `feature-overlap` subagent (invoked during `/sdd-review`) drew a false hard-ordering conclusion against feature 073 by reading the local git reflog instead of `origin/main-dev` — 073 was actually already merged. Not yet recorded anywhere else (context.md:85-91).
**Deferred follow-ons**:
- Operator action: any connector with a saved `/sse` URL 404s until trimmed to the bare `AGENT_PUBLIC_URL` — flagged in PR body and `docs/runbooks/mcp-tools.md`, not enforceable by CI (feature.md:61).
- `/context-scrubber scan` was never run (context-forge plugin unavailable in that session) — stated in the PR body per teardown rule rather than silently skipped (context.md:297-298).
**Ledger entries written**: insights.md (0), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none — `context-constitution-findings.md:18`'s open finding is already tracked in-place (not a new PLAT-*/AGENT-* candidate).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
