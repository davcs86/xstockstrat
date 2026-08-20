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

## Session 2026-08-20 — sdd-spec

- Generated implementation-spec.md with 10 steps. Status → implementation-ready.
- Followed design.md's Chosen Approach (system_managed flag, EnsureSignalWatchlist RPC, delete guard,
  per-entry source); recon.md's earlier reserved-name/config-key path was superseded by the design and
  NOT used. recon Codebase Map reused for the agent side; portfolio proto/schema/handler/UI evidence
  discovered fresh (recon predated the schema-changing design).
- Key codebase findings:
  - **Migration = 011** (not 010): confirmed local tip `009_bracket_order_ids`; a `git ls-remote` scan
    of all origin heads shows no pushed portfolio migration above 009, but merge-order.md row 182 is
    authoritative — 042 (design-approved) keeps `010`, 127 renumbers to `011` regardless of merge order.
  - **Proto field numbers uncontested**: `WatchlistBinding` uses 1,2 → `source=3`
    (`portfolio.proto:174-177`); `Watchlist` uses 1-8 → `system_managed=9` (`:180-191`). No existing
    enum in the file. `DeleteWatchlist` RPC already at `:24`.
  - **DeleteWatchlist guard site**: `portfolio_service.go:1311-1326` currently *discards* the loadOwned
    result (`if _, err := s.loadOwned(...)`) — the guard captures it and returns FAILED_PRECONDITION on
    `system_managed`. Mirrors the 063/115 C-10(c) pattern.
  - **Repo column plumbing**: `scanWatchlist` (watchlist_repo.go:278) fed by GetByID SELECT (:63) +
    ListByUser SELECT (:86); `listBindings` (:221) + `insertBindingsTx` (:266, ON CONFLICT DO NOTHING)
    carry the new `source` column. EnsureSystemManaged repo method does the round-2 TOCTOU-free
    `INSERT ... ON CONFLICT (user_id) WHERE system_managed DO NOTHING RETURNING` + SELECT-on-empty.
  - **Agent**: `ingest_signal` (tools.py:258) takes NO `ctx: Context` today — must add it (non-breaking,
    like emit_alert :336 / manage_formula :645). Second best-effort side effect mirrors the auto-alert
    at :296-333, gated `direction=="watchlist" and not deduplicated`. New client.py methods mirror the
    ephemeral-channel pattern (ingest_signal :151-188), forwarding `[*_metadata(), ("x-user-id", uid)]`
    (pattern at client.py:281). `PORTFOLIO_ENDPOINT` absent from client.py constants (:20-26).
  - **PORTFOLIO_ENDPOINT deploy-parity confirmed**: absent from the agent block in docker-compose.yml
    (agent env :519-528), .do/app.yaml (agent block :265-290), .do/app.dev.yaml (agent block :269-...).
    Present only in trading/analysis/ui blocks. Value `xstockstrat-portfolio:50052`, uniform across envs.
  - **UI**: delete AlertDialog at WatchlistDetail.tsx:187-207 (gate on `!watchlist.systemManaged`);
    per-symbol rows render in WatchlistReadiness.tsx (already imports Badge :5, Binding type :21 — add
    `source`, badge on WATCHLIST_ENTRY_SOURCE_SIGNAL). BFF forwards unchanged (insightsBff.ts:90-95).
    e2e mock is e2e/helpers/watchlistMock.ts (MockWatchlist :18, MockBinding :17), spec
    e2e/insights/watchlists.spec.ts, INVENTORY row :25.
  - Coverage note: portfolio EnsureSignalWatchlist/guard land in service/+repository/ packages, which
    the Go coverpkg filter excludes — no threshold delta; targeted `go test` is the verification (C-08
    paired test still required, P-06 red-first).

## Session 2026-08-20T06:16:48Z — sdd-review impl-spec (advisory)

- Result: 0 failures, 2 warnings, 1 note (advisory — did not block). Verdict PASS WITH WARNINGS.
- Overlap: no FAIL-level collision. Portfolio migration `011` and proto field numbers
  (`Watchlist.system_managed=9`, `WatchlistBinding.source=3`, `WatchlistEntrySource` enum,
  `EnsureSignalWatchlist` RPC) all confirmed next-free/uncontested. Remaining are file-level
  rebase-only overlaps: `portfolio_service.go` vs 042 (disjoint regions), the three deploy specs vs
  020 (agent block vs notify block — disjoint), and mechanical `packages/proto/gen/**` regen vs 042
  (different source protos). merge-order.md:182 already covers 042↔127; no new hard row needed.
- Unresolved ⚠ / NOTE carried into execution:
  - Step 5: Go test step states no >=N% coverage assertion — justified because `service/` and
    `repository/` are excluded from the coverpkg filter (no threshold delta); C-08 pairing still met
    via the targeted `go test -race`. — [x] CONFIRMED (2026-08-20): `ci.yml:244` excludes
    `/(cmd|handler|repository|telemetry|service)/` from `-coverpkg`, so `EnsureSignalWatchlist`/the
    delete guard (service/) and the repo change (repository/) are outside the threshold — claim accurate.
  - Step 6: touches 6 files (>5) — acceptable (3 are the deploy-parity trio for PORTFOLIO_ENDPOINT). — [x] no action needed (accepted)
  - Note: migration `011` deviates from strict last+1 (`010`) but is a coordinated reservation per
    merge-order.md:182 (042 keeps `010`). Not an F-01 risk (new files). — [x] no action needed (by design)

## Session 2026-08-20 — sdd-execute (steps 1–5, 7)

**Branch-model note (harness constraint):** This session runs under a harness that assigns a
single branch `claude/execute-020-042-127-pfa5cw` and forbids pushing to a different branch
without explicit permission. The SDD per-feature `feature/<slug>` branch + per-step PR model is
therefore adapted: all three features (020, 042, 127) are implemented on the assigned claude
branch with SDD discipline (discovery → red/green TDD → per-step context/spec updates → deviation
log) and will land via a single integration PR into `main-dev`.

**Toolchain:** Docker codegen image build failed at the NodeSource apt step (egress not routed
inside the Docker build), so the host-toolchain fallback (`docs/runbooks/codegen-toolchain-host-setup.md`)
was used: installed buf + pinned Go plugins (protoc-gen-go@v1.36.11, protoc-gen-go-grpc@v1.6.2,
protoc-gen-connect-go@v1.19.2), TS plugins, grpcio-tools==1.80.0. Validated an **empty** `gen/`
diff on the unedited proto before editing — toolchain reproduces committed stubs byte-for-byte.

### Step 1 — proto additive changes [done]
- Added `WatchlistEntrySource` enum, `WatchlistBinding.source` (3), `Watchlist.system_managed` (9),
  `EnsureSignalWatchlist` RPC + req/resp messages to `portfolio.proto`. `buf lint`/`buf breaking`
  (against main-dev) pass (additive).
- Files: `packages/proto/portfolio/v1/portfolio.proto`

### Step 2 — proto-gen [done]
- `./scripts/buf-gen.sh` regenerated Go/Python/TS stubs; diff limited to portfolio stubs only.
- Files: `packages/proto/gen/**`

### Step 3 — migration 011 [done]
- `011_watchlist_system_managed_source.{up,down}.sql`: `system_managed` col, name-constraint
  rework (partial unique indexes), `source` col. Offline up/down parity verified.

### Step 4 — portfolio repo/service/handler [done]
- Column plumbing (system_managed/source), `EnsureSystemManaged` repo method (ON CONFLICT
  find-or-create), `EnsureSignalWatchlist` service+handler+gRPC adapter, `DeleteWatchlist` guard
  (FailedPrecondition on system-managed). Deviation: `normalizeBindings` preserves `source`.
- Build + golangci-lint clean.
- Files: `internal/repository/watchlist_repo.go`, `internal/service/portfolio_service.go`,
  `internal/handler/portfolio_handler.go`

### Step 5 — portfolio tests [done]
- AC-6 (EnsureSignalWatchlist idempotent + coexists with same-named manual list), AC-7 API half
  (delete guard + happy-path delete). In `watchlist_service_test.go` (not the spec's named file).
- `go test ./... -race` + lint green.

### Step 7 — mcp-tools.md doc [done]
- Documented the watchlist auto-add side effect + dedup suppression in the `ingest_signal` entry.

**Next:** Steps 6 (agent), 8 (agent test), 9 (UI), 10 (UI test).
