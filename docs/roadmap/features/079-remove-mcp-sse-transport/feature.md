# Feature: remove-mcp-sse-transport

**Lifecycle Status**: `launched`
**Committed to main**: 0eae638104744992c61c8a1ac4bd8cbaac10862b
**Launched date**: 2026-07-29
**Development Branch**: `feature/remove-mcp-sse-transport`
**Created**: 2026-07-29
**Last Updated**: 2026-07-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-29 | `idea` → `draft` | /sdd-story | Backlogged while implementing feature 073, which had to work around the SSE transport's unauthenticated tool-call channel. |
| 2026-07-29 | `draft` → `spec-ready` | /sdd-review | Product spec approved on pass 3 (0 warnings outstanding; 4 advisory warnings closed in-place). Passes 1–2 failed on FR-2 ambiguity and an unverified exhaustiveness claim in FR-4. |
| 2026-07-29 | `spec-ready` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written. Adversary returned NEEDS WORK with 10 objections, no Floor breach; 8 adopted, 1 adopted with a different remedy, 1 rejected. AC-5 restated in product-spec.md — the single-tier grep gate was unsatisfiable. |
| 2026-07-29 | `implementation-ready` → `code-completed` | /sdd-execute | All 8 steps done in one PR. Agent 137 pass / 68% cov, ingest 134, analysis 351; ruff + uv lock clean in all three. AC-5 tier 1 = 0 rows (from a 14-row baseline); tier 2 fully enumerated. 3 deviations logged. |
| 2026-07-29 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps (2 red-green cycles + client config + deployment + comment-only servicers + docs/AC-5 sweep). |

| 2026-07-29 | `code-completed` → `launched` | CI workflow | Promoted via PR #812; committed 0eae638104744992c61c8a1ac4bd8cbaac10862b |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, risks
- [Design](design.md) — chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 8 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Retire the legacy HTTP+SSE MCP transport (`/sse` + `POST /messages`) from `xstockstrat-agent`,
leaving Streamable HTTP as the only remote transport (plus `stdio` for local use).

The motivating defect: **the SSE tool-call channel is not authenticated.** `app/main.py` returns for
`path == "/messages"` *before* the `_authorized` gate, so every tool call arriving that way is
unauthenticated at the transport layer — auth is established once when the stream opens and never
re-checked per message. Feature 073 had to restrict `set_config` to Streamable HTTP for exactly this
reason, and any future tool that needs the caller's identity will hit the same wall.

## Reviewers

Canonical snapshot, deduplicated from all eight steps' `**Reviewers**` values
(`docs/runbooks/reviewer-registry.md`, read 2026-07-29). Stable unless `/sdd-spec` re-runs.

| Role | Review Focus | Steps |
|---|---|---|
| `xstockstrat-agent` (service owner) | Transport removal, MCP client compatibility, `MCP_TRANSPORT` handling, env-var naming and deployment parity | 1–6 |
| Security | Required — this closes an unauthenticated tool-call channel; also covers the pre-auth 404 branch (AC-1/AC-3) and the removal of the `?api_key=` query-string client block | 2, 3, 4, 5 |
| `xstockstrat-ingest` (service owner) | Signal-path role-check docstring accuracy (comment-only) | 7 |
| `xstockstrat-analysis` (service owner) | Strategy-path role-check docstring accuracy (comment-only) | 7 |
| _none_ | `docs` step — no reviewer per the registry governance matrix | 8 |

## Next Action

Integration PR open against `main-dev`. After merge + deploy, trim any saved connector URL ending in `/sse` down to the bare `AGENT_PUBLIC_URL`.
