# Context: remove-x-mcp-secret-header  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped as a pure-subtraction removal of the unenforced `x-mcp-secret` gRPC header (agent code) plus its dead infra wiring (notify/ingest/analysis env blocks) and a repo-wide doc correction, while deliberately keeping `MCP_AGENT_SECRET` alive as the single-purpose OAuth `txn` HMAC key. Landed as one integration PR (#857) with no intermediate PRs, per explicit requester instruction, on a harness-assigned branch instead of the usual `feature/<slug>` convention (feature.md:6; context.md:25-33).
**Why (irrecoverable rationale)**: `MCP_AGENT_SECRET` looked deletable but wasn't — recon surfaced it as dual-purposed (outbound header + OAuth signing key), and a naive grep-and-delete pass would have broken `/oauth/authorize` (product-spec.md:190-194). The fix scope narrowed to "remove the header, keep the var, correct the docs" rather than a full rename/removal.
**Rejected alternatives**:
- Delete `_metadata()` entirely, inline `[]` at ~32 call sites — lost to diff-size-for-zero-behavior-gain (design.md:95-98).
- Delete the now-orphaned `MCP_AGENT_SECRET` module reads in `client.py`/`auth.py` — lost because it would force touching `conftest.py`'s monkeypatch fixture for a cosmetic-only gain; left symmetrically in both files (design.md:99-106).
- Blanket zero-hit grep across whole repo as AC-1 — lost to the same trap `079-remove-mcp-sse-transport` hit 3x; replaced with hard-zero (app/) + reviewed historical-exemption sweep (design.md:107-111).
- Renaming `MCP_AGENT_SECRET` to reflect single purpose — deferred, out of scope: needs coordinated DO dashboard secret changes outside repo control (design.md:115-118).
**Scars & gotchas**:
- A removal step's own *replacement wording* can defeat its own zero-hit Verification if it re-quotes the removed literal even in past-tense framing — caught only at execute time (context.md:247-252; already captured in insights.md:523).
- Docker daemon could not start in this sandbox (`ulimit: Operation not permitted`); the mandated live `docker compose up`/`ps` smoke check was substituted with `docker compose config` (no-daemon), flagged for a human/CI check before merge (context.md:227-235) — reinforces the recurring Docker-unavailable-in-sandbox family already in `fails.md:300` and `:169`.
- Final repo-wide sweep found an out-of-scope survivor (`docs/context-constitution-findings.md:37`) no recon pass had named — already captured in insights.md:523-549.
- `/context-scrubber scan` (mandated by root CLAUDE.md Teardown) was unavailable in-session despite showing enabled at account level (`ListPlugins` vs `Skill` mismatch); substituted a manual grep review and named the gap in the PR body rather than skipping silently (context.md:303-315).

**Permanent deviations**: none — recon's draft "dual-purpose" framing for `AGENT-6` was superseded by design.md's "single-purpose" framing before code landed (context.md:146-148), not a shipped-vs-design divergence.
**Permanent deviations**: none
**Cross-feature signal**: none beyond what's already ledgered.
**Deferred follow-ons**: rename `MCP_AGENT_SECRET` to reflect OAuth-only purpose (product-spec.md:85-88); a real `/context-scrubber scan` once the plugin is available; live-daemon confirmation of the Step 2 smoke check.
**Ledger entries written**: insights.md (0), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
