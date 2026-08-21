# Context: mcp-watchlist-tools  (archived 2026-08-21)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-21 — /sdd-archiver

**What**: Shipped four ownership-gated MCP agent tools — `list_watchlists`, `get_watchlist`,
`manage_watchlist` (create/update/delete), `manage_watchlist_symbols` (add/remove) — as a pure
agent-surface addition over the pre-existing, unchanged `PortfolioService` watchlist RPCs (features
058/097/127). Zero proto/config/DB/portfolio change; the backend was already fully in place. The
agent's tool count moved 24→28 in lockstep across every inventory surface.

**Why (irrecoverable rationale)**: The one genuine design fork was the `manage_watchlist update`
contract. Recon grounded — at the DB layer — that `UpdateWatchlist` is replace-all and requires a
non-empty name, so a name-only update would WIPE the symbol set (the F-12/RC-1 footgun,
`WatchlistRepo.Update` DELETE-then-reinsert). This fork was surfaced to the user via `AskUserQuestion`
(C-11/P-04 gate) and the user **explicitly approved the read-modify-write merge**: `update` first
`GetWatchlist`s, then resends `name`/`description`/`bindings` as `supplied ?? current`, so name-only
updates preserve every stock and bulk symbol mutation is routed to `manage_watchlist_symbols`. It was
a human-gated choice, not a default. `add` stamps `source = WATCHLIST_ENTRY_SOURCE_MANUAL`
deliberately, to keep agent-user curation provenance distinct from the SIGNAL-sourced adds the
`ingest_signal(direction='watchlist')` side-effect path writes — `source` exposure was net-new to the
agent tool surface.

**Rejected alternatives**:
- Metadata-only update — safe but drops the bulk symbol-set-replace capability; user chose the merge.
- Raw `UpdateWatchlist` passthrough — reintroduces the symbol-wipe footgun.
- One-tool-per-RPC (7–8 tools) — violates the `manage_<noun>`-verb convention and bloats the surface;
  four tools map exactly to the user's four verbs.
- Exposing `EnsureSignalWatchlist` as a tool — internal find-or-create for the signal path, not user
  curation.

**Scars & gotchas**: The read-modify-write merge is **non-atomic** (GetWatchlist → UpdateWatchlist):
a concurrent symbol add in the gap can be lost on the resend. Accepted as fine for single-user,
low-concurrency agent curation and documented in the tool docstring rather than solved.

**Permanent deviations**: none — the tools shipped exactly as the approved design described.

**Cross-feature signal**: Mirrors feature 133 (`get_strategy`/`manage_strategy`) ownership-gating
verbatim and reuses the `get_backfill_status` pagination model — confirms `manage_<noun>` verb-tool +
`_caller_user_id` + `x-user-id` forwarding is the settled agent-tool idiom; no new auth plumbing
invented.

**Deferred follow-ons**: none.

**Process deviations (procedural memory)**: `/sdd-review product-spec` was **not run** (status went
`draft → design-approved` directly). The feature was implemented **directly on the harness branch**
`claude/mcp-watchlist-tools-0dz096` with one PR to main-dev, **consolidating `/sdd-spec` +
`/sdd-execute` into a direct implementation** of the approved design — so **no `implementation-spec.md`
was ever written** (absent by design, not lost). The context-forge `/context-scrubber` plugin was
unavailable; the teardown scan was done manually (tool-count consistency + no stale "twenty-four").

**Ledger entries written**: insights.md (0), fails.md (0). The one reusable lesson — read-modify-write
merge over a REPLACE-semantics backend RPC — was already recorded at design time
(`docs/roadmap/ledger/insights.md`, 2026-08-21 `mcp-watchlist-tools — reuse`); the synthesizer
confirmed it as a DUP and no new entry was warranted.

**Runtime-invariant recommendations (→ /context-constitution)**: none. The `UpdateWatchlist`
replace-all-wipes-symbols behavior is a real cross-module scar but remains grep-able from
`services/xstockstrat-portfolio/internal/repository/watchlist_repo.go` and is already covered by the
F-12/RC-1 ledger class.

**Scenarios promoted (C-16)**: `@AC-1..@AC-9` promoted into
`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature` (CREATE), each tagged
`@feature-148`. `@AC-10` (tool-registry inventory + endpoint tool-count assertion) deliberately not
promoted — build-hygiene/meta, not a durable behavioral rule.

**Pruned artifacts**: product-spec.md, recon.md, design.md — last present at aec97408.
(implementation-spec.md never existed for this feature — see Process deviations.)
