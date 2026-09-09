# Context: watchlist-bulk-default-strategy  (archived 2026-09-09)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-09 — /sdd-archiver

**What**: Multi-select bulk operations (remove symbols, reassign strategy) + watchlist-level default strategy. FieldMask on `UpdateWatchlist` for surgical writes. Add-time-only default (no retroactive rebind), source-aware at `requestBindings` chokepoint. Entire feature story-through-launch in one day.

**Why (irrecoverable rationale)**: FieldMask chosen over dedicated RPC (single-purpose, doesn't generalize) and over folding into replace-all (a default-only edit would clobber name/description/bindings unless every caller resent the full snapshot — wipe footgun). Bindings excluded from maskable path set `{name, description, default_strategy_id}` because bindings collide with the bulk RPC's empty-set semantics and the UI hook's always-sent `bindings:[]` would wipe the list. Presence-gating (not emptiness-gating) because Connect-JSON empty FieldMask is present-but-empty. Add-time default scoped to MANUAL-only to avoid C-16 CHANGE to signal-add contract. No-mask request carrying `default_strategy_id != ""` returns loud `InvalidArgument` (not silent no-op) so a caller cannot accidentally set the default via the legacy path. Legacy replace-all path isolated from `default_strategy_id` in both directions: (a) `default_strategy_id` deliberately excluded from legacy `WatchlistRepo.Update` SET clause so a no-mask edit preserves an already-set default "for free" without the caller knowing the column exists; (b) legacy path passes `""` as `defaultStrategyID` to `applyDefaultStrategy` so delete-and-reinsert of all bindings doesn't accidentally inherit the persisted default — without this reasoning, both the column's absence from the SET clause and the hardcoded `""` read like bugs to fix.

**Rejected alternatives**: Fork 1 Option A (default applies to SIGNAL adds); single-row loop-in-tx (N round-trips + wider deadlock window); fold into replace-all (wipe footgun); dedicated `SetWatchlistDefaultStrategy` RPC (mask generalizes); narrow/wide maskable scope; dedicated agent bulk tool.

**Scars & gotchas**: Playwright `waitForRequest` dot vs slash for Connect-RPC paths; `analysis.pb.go` comment-whitespace delta from codegen (committed to keep proto-freshness green); anti-rebind `ON CONFLICT DO NOTHING` only fake-modeled; bulk `NOT_FOUND` must compare post-dedup count; harness branch constraint forced single integration branch.

**Permanent deviations**: None.

**Cross-feature signal**: FieldMask presence-gate proven in Go. `key={watchlistId}` remount pattern confirmed.

**Deferred follow-ons**: Cross-service `default_strategy_id` validation; real DB test for anti-rebind.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-09-09 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: None.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 6c53133e315c7978a97fa36aa05fcdf11aca00a9.
