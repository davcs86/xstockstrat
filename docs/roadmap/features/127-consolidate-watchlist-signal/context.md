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

## Session 2026-08-19 — sdd-design (Phase 0 + Phase 1 round 1)

- Phase 0 Recon: wrote recon.md (agent + portfolio). Central "whose watchlist" fork RESOLVED by user
  intent: a special, system-managed, PER-USER watchlist (owned by the calling user via x-user-id,
  reserved name). No system-owned watchlist concept exists in portfolio (single-user UNIQUE(user_id,
  name)); we are NOT introducing one.
- Phase 1 round 1 (proposer+adversary). Adversary verdict NEEDS WORK, no Floor breach. Proposed: a 2nd
  best-effort post-commit side effect in `ingest_signal` mirroring the auto-alert; add `ctx: Context`
  + `_caller_user_id`; new agent→portfolio client method (List→Create-if-absent→Add, unbound binding);
  PORTFOLIO_ENDPOINT wiring; doc parity.
- **Grounded facts / corrections:**
  - **PREMISE CORRECTION (P-03):** the product spec cites `form4-enhanced-ingest` as the motivating
    flow, but form4 scores `direction="watchlist"` at conviction 0.30 (< 0.6) → `skipped_signals`,
    NEVER calling `ingest_signal` (`.claude/skills/form4-enhanced-ingest/SKILL.md:59-61`). So form4
    triggers this feature ZERO times. The real trigger is any OTHER caller explicitly ingesting a
    `direction="watchlist"` signal (interactive via the connector, or a future flow). design.md must
    NOT cite form4 as the driver.
  - **Identity is fine (P-03):** `_caller_user_id` succeeds for every authenticated Streamable-HTTP
    tool call (`_authorized` publishes claims on the ASGI scope, `app/main.py:174`); it raises ONLY on
    the stdio-local transport. So the skip-fallback is stdio-local-only, NOT a production concern.
    Adding `ctx` as the first param is non-breaking (MCP injects it, excluded from the client schema —
    same as emit_alert/run_backtest).
- **Bake-in fixes (settled):**
  - CreateWatchlist collapses the `UNIQUE(user_id,name)` collision to `CodeInternal` (same as a DB
    outage, `portfolio_service.go:1238-1241`) — so "match the ALREADY_EXISTS code" is impossible; the
    re-List disambiguator IS the only correct path. On the re-raise, `log.warning` with the ORIGINAL
    gRPC code/details so a real misconfig (PERMISSION_DENIED/UNAVAILABLE) is diagnosable.
  - Doc parity (FR-5, ledger mcp-tools-alignment 2026-08-02): add a descriptor/parity-style test
    asserting BOTH the docstring block AND `mcp-tools.md` mention the watchlist side effect — paired
    with (not instead of) the C-08/P-06 behavior test.
  - Reserved-list lookup: paginate `ListWatchlists` until found (or document the `pageSize(100) >
    max_per_user` coupling — a config-raised cap could break a single-page lookup).
  - Prefer a module CONSTANT for the reserved name over `agent.signal.watchlist_name` config key
    (renaming would orphan existing lists → duplicates; no FR needs per-env renaming; C-05/minimum
    scope). If kept as a key it MUST be registered (per-feature log + agent CLAUDE.md default row).
  - Watchlist-cap no-op (user at `max_per_user`, no Signals list → CreateWatchlist INVALID_ARGUMENT →
    best-effort log) = stated known limitation.
- **Two decisions surfaced to the user at the round-1 gate:** (1) reserved-name/collision behavior —
  well-known "Signals" name + accept merge-into-a-user's-same-named-list (with sign-off) vs a
  distinct collision-resistant reserved name; (2) OQ3 (UI distinguishing agent-added entries) — the
  /insights/watchlists surface is already reached (C-14 met), so the visual distinction is an
  enhancement whose deferral needs explicit C-14 sign-off (named follow-up vs explicitly unscoped).
- Round 1 complete; full mode mandates ≥2 rounds. Awaiting user steer before round 2.

## Session 2026-08-19 — sdd-design (Phase 1 round 2 — EXPANDED scope)

- **User decisions (round-1 gate) EXPANDED scope:** (1) a NEW FLAG on the watchlist definition marks
  it system/agent-managed, undeletable (users can do anything but delete) — the agent finds its
  signals watchlist by the FLAG, not a name (dissolves the name-collision footgun); (2) the UI
  distinction is IN scope (not deferred). This grows 127 from agent-only (no proto/DB/UI) into
  **agent + portfolio (proto + migration + delete-guard) + UI**.
- Round-2 proposer designed it; round-2 adversary verdict REVISE, no Floor breach. Design shape
  (settled): `Watchlist.system_managed` flag; dedicated `EnsureSignalWatchlist` RPC (find-by-flag,
  atomic create — chosen over a forgeable `CreateWatchlistRequest.system_managed`); `DeleteWatchlist`
  guard returns `FAILED_PRECONDITION` (C-10(c) — owner refused on resource state, not authz) + the UI
  hides/disables delete when `system_managed`; agent `_caller_user_id` + best-effort
  `EnsureSignalWatchlist`→`AddWatchlistSymbols`; `PORTFOLIO_ENDPOINT` wiring.
- **Round-2 bake-in fixes:**
  - [C-07/081] Migration-NNN collision with 042 CONFIRMED (both claim portfolio 010). Strike the
    literal 010; re-derive across ALL remote branches at /sdd-spec (first-to-merge keeps 010, other→011).
  - [C-01] The name-collision is NOT fixed by an index-only add — `UNIQUE(user_id,name)` still rejects
    Ensure's insert of "Signals" if the user has a manual "Signals". Fix: migration DROPs+RECREATEs it
    as `UNIQUE(user_id, name) WHERE NOT system_managed` (system name is cosmetic — found by flag), plus
    the `(user_id) WHERE system_managed` one-row index. Make Ensure atomic:
    `INSERT ... ON CONFLICT (user_id) WHERE system_managed DO NOTHING RETURNING *`, SELECT on empty.
  - [write-minimum/C-04] DROP the per-entry `WatchlistBinding.source` enum + `watchlist_symbols.source`
    column — the UI distinction is WATCHLIST-LEVEL (`system_managed` already marks the whole list as
    the agent's; every entry is signal-sourced by construction; no manual-add-to-signals path in scope;
    `ON CONFLICT DO NOTHING` makes per-entry source first-writer-wins/unreliable). Removes a proto field
    AND a migration column. (Pending user confirm — faithful minimal reading of "distinguish entries".)
  - [C-14/C-09/approval-flow] The expansion makes the product-spec's "no proto/no schema/no UI" FALSE
    and pulls in new reviewers (proto owner, DBA, UI) — the product spec must be UPDATED and RE-RUN
    through `/sdd-review product-spec`, not just patched. The config-key-rejection rationale (":111-115",
    "renaming orphans lists") is moot under find-by-flag — remove it.
  - Delete-guard residual: `RemoveWatchlistSymbols`/`UpdateWatchlist` can empty-but-not-delete the list
    (acceptable, self-healing via Ensure) — state deliberately in design.md.
- Round 2 complete. Two decisions to the user before finalizing: (a) confirm the per-entry-source DROP
  (watchlist-level distinction) vs keep per-entry badges; (b) the process — update product spec for the
  expanded scope + re-run /sdd-review product-spec, THEN finalize design.md/design-approved.

## Session 2026-08-19 — sdd-design COMPLETION (approved, expanded scope)

- User APPROVED at the round-2 gate (both decisions: keep per-entry `source`; update spec + re-review
  then approve). design.md written. Status: spec-ready → design-approved.
- Product spec was UPDATED for the expanded scope (Proto additive: `Watchlist.system_managed`,
  `WatchlistBinding.source` + `WATCHLIST_ENTRY_SOURCE_*` enum, `EnsureSignalWatchlist` RPC; Database:
  portfolio migration — NNN re-derived at /sdd-spec, `011` (042 holds `010`); Consumer Surfaces:
  Agent + UI; Affected Services: +portfolio +ui; FR-7..10; ACs 6-8; approval gates: proto/DBA/UI) and
  **RE-RUN through /sdd-review product-spec → PASS WITH WARNINGS** (no blockers/Floor breach; 1 warning
  — enum value prefix, FIXED). Overlap: hard portfolio-migration-010 collision with 042 → 127 = `011`;
  **merge-order.md hard row added**; soft/rebase on the code-completed 085/094 MCP-alignment cohort.
- Chosen approach: agent `_caller_user_id` + best-effort side effect (stdio-only skip); portfolio
  `system_managed` flag + atomic `EnsureSignalWatchlist` (ON CONFLICT (user_id) WHERE system_managed) +
  name constraint reworked `WHERE NOT system_managed` + `FAILED_PRECONDITION` delete-guard; per-entry
  `source` (first-writer-wins caveat); UI undeletable affordance + badge; descriptor-parity doc test.
- Constitution rules touched: C-01/P-03, C-03, C-04, C-05/F-07, C-07/F-01, C-09, C-10(a)/C-10(c), C-14,
  C-08/P-06 — all honored; no Floor breach across 2 rounds + re-review.
- Next: /sdd-spec consolidate-watchlist-signal (re-derive migration NNN vs 042 across all remote branches).

### Open Threads (carry to /sdd-spec)
- [ ] Portfolio migration NNN re-derive vs 042 (→ `011`) across all remote branches.
- [ ] Per-entry `source` first-writer-wins caveat (state in UI/tests).
- [ ] Rebase onto the landed 085/094 agent cohort (ingest_signal/client.py/mcp-tools.md).
- [ ] Name-constraint drop+recreate: verify no existing rows violate `WHERE NOT system_managed`.
- [ ] Empty-but-undeletable system list is deliberate (document).
