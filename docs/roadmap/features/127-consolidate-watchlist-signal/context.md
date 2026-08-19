# Context: consolidate-watchlist-signal

**Feature**: `docs/roadmap/features/127-consolidate-watchlist-signal/feature.md`
**Product Spec**: `docs/roadmap/features/127-consolidate-watchlist-signal/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/127-consolidate-watchlist-signal/implementation-spec.md`

---

## Session 2026-08-11 — sdd-story

- User asked where `ingest_signal` signals tagged `direction="watchlist"` go; research (via
  `codebase-discovery` subagent) found they land in `xstockstrat-ingest`'s `newsletter_signals`
  table as an inert label, non-actionable in `xstockstrat-analysis` scoring, with **no** code link
  to the platform's real `xstockstrat-portfolio` `Watchlist` mechanism (feature 058) — two concepts
  sharing a name only.
- User confirmed they should be consolidated ("otherwise that data goes useless") and, via
  `AskUserQuestion`, chose **auto-add on ingest**: when `ingest_signal` is called with
  `direction="watchlist"`, automatically add the symbol to the relevant portfolio watchlist.
- Created feature.md (status: draft), product-spec.md, context.md from the user story.
- Flagged as an unresolved Open Question (not decided here, per CLAUDE.md "don't assume — surface
  the fork"): `xstockstrat-portfolio` watchlists are strictly user-owned via the propagated
  `x-user-id` header, but `ingest_signal` derives no caller identity today and is called by both
  interactive and fully-automated flows (e.g. `form4-enhanced-ingest` skill) — whose watchlist an
  auto-added symbol belongs to is the central fork `/sdd-design` must resolve before implementation.

## Session 2026-08-19 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Verdict: PASS WITH WARNINGS (no blockers).
- Warnings carried into design/spec (do NOT silently drop):
  - Criterion 9: 4 unchecked Open Questions — accepted as genuine design-owned architectural
    forks (esp. OQ#1 "whose watchlist?" identity fork), NOT force-resolved at product-spec time
    (pre-resolving would violate P-03 and deadlock the draft→spec-ready→design-approved lifecycle).
    `/sdd-design` MUST actually close all four; they may not be carried into `/sdd-spec`.
  - **Scope-reduction items flagged for user sign-off (not trimmed):** OQ#3 (UI distinguishing
    agent-added watchlist entries) is a C-14 override whose deferral needs explicit sign-off; and
    closing OQ#1/OQ#2 by dropping FR-1/FR-2 or the owner-identity requirement would reduce scope —
    take the scope-*adding* resolution (define owner handling / auto-create) at design instead.
  - Trading-domain C-1: agent gains a NEW env var `PORTFOLIO_ENDPOINT` (=`xstockstrat-portfolio:50052`)
    not present in the agent block today — impl-spec must add it to `docker-compose.yml`,
    `.do/app.yaml`, and `.do/app.dev.yaml` agent blocks.
  - C-10(c): if design introduces a system/broadcast ownership sentinel for the target watchlist,
    record it as a governance convention.
- Overlap findings: soft/rebase only (WARN) — no FAIL-level hard collision. Shared MCP-agent surface
  (`services/xstockstrat-agent/app/tools.py` `ingest_signal` handler + docstring, `app/client.py`,
  `docs/runbooks/mcp-tools.md` entry) is co-edited by already-`code-completed` features 085 and 094;
  127 rebases onto whichever lands first, reconciling the `ingest_signal` docstring + mcp-tools.md
  entry, exactly as the existing MCP-alignment cohort note in merge-order.md already prescribes.
  No new merge-order row required. Possible future `agent.signal.watchlist_name` config key shares
  category with existing `agent.signal.alert_threshold` but is a different key (no duplicate-key FAIL);
  re-scan at impl-spec (Mode B) if design chooses the config-key path.
