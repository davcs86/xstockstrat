# Context: exit-cooldown  (archived 2026-08-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-16 — /sdd-archiver

**What**: Exit cooldown (`exit_cooldown_days` field, minimum holding period in calendar days) across 4 surfaces: proto (`StrategyDefinition` field 11), `xstockstrat-analysis` (backtest engine + live loop + new migration `012_exit_cooldown` + `entry_backfill.py` boot-time Order-based backfill module + skip-until-known guard), `xstockstrat-agent` (`manage_strategy` tool, partial-update pattern), `xstockstrat-ui` (`StrategyWizard` Step 1, alongside "Re-entry cooldown"). 21 steps. Mirrors feature 069 (`strategy-reentry-cooldown`) for the exit transition.

**Why (irrecoverable rationale)**: Bar-replay fold (`_replay_state`) seeds from hydrated DB anchors, not blank identity — starting from identity silently discards all active cooldowns for open positions and treats the first qualifying bar as the anchor (wrong for positions open before the replay window). `entry_time` is raw `google.protobuf.Timestamp`, not a Python `datetime`. Skip-until-known guard fires when `_last_entry_at.get(key) is None` — not when `last_exit_at` is None (which is valid for a position that never exited, different semantics). Boot backfill uses `ORDER_STATUS_UNSPECIFIED` not `ORDER_STATUS_FILLED` — covers partially-filled-then-cancelled orders that still carry accurate `filled_qty`; FILLED-only would drop those orders. Sentinel-timestamp approach for `NOT NULL` rejected — a sentinel would be silently treated as a real entry anchor by the gate math. `Order.updated_at` used as fill anchor (not `created_at`) — is when the order transitioned to terminal state, not when it was placed. `get_int_present` stub was missing from test helper factories (see Fails). Playwright `test.describe` helpers must be hoisted to module scope, not declared inside the closure — reference errors in later `test()` calls otherwise.

**Rejected alternatives (real, 7)**:
- New `entry_cooldown.py` sibling module — rejected: `cooldown.py`'s gate math is direction-agnostic, renaming the parameter is sufficient (context.md sdd-design rounds 1-2).
- Inferring `_last_state` from last-entry/last-exit timestamp recency — rejected: undecidable for the deploy-day cohort (context.md sdd-design round 2).
- Widening `_LOOKBACK_DAYS` instead of Order-based backfill — rejected: doesn't eliminate the gap for positions older than the window (context.md rounds 2-3).
- Making boot backfill fully blocking — rejected: reintroduces the startup-latency problem the async design solves (context.md round 4).
- Accepting the >365-day-position gap as documented — rejected: user explicitly required a real fix ("do not accept the gap") after round 2 (context.md round 3 steer).
- Extracting `_apply_transition` as a shared helper — deferred for a later architectural pass; not an immediate requirement (context.md design.md §Chosen Approach).
- Server-side enforcement only — mentioned for completeness; not a genuine debate point (no round citation).

**Scars & gotchas**:
- `get_int_present` stub missing from test helper factories — surfaces only at runtime, not at spec time.
- `ORDER_STATUS_UNSPECIFIED` in boot backfill (not `ORDER_STATUS_FILLED`) — covers partially-filled-then-cancelled orders with accurate `filled_qty`; a FILLED-only filter would drop valid entry anchors.
- `entry_time` is raw `google.protobuf.Timestamp` — no automatic conversion to Python `datetime`; convert explicitly at use sites.
- Bar-replay fold must be seeded with hydrated DB anchors, not blank identity — see Ledger insight.
- Playwright `test.describe` helpers must be hoisted to module scope — helpers declared inside the closure are not accessible from sibling `test()` calls.

**Permanent deviations**: none post-ship; all design-debate items were resolved in the spec.

**Cross-feature signal**: feature 069 (`strategy-reentry-cooldown`, archived) is the symmetric entry-side gate — `cooldown.py`'s pure gate functions are reused verbatim, renamed to direction-neutral parameters.

**Deferred follow-ons**: `_apply_transition` architectural extraction (noted for a future cleanup pass, not urgent). `>365-day-position` gap is closed by the Order-based boot backfill; no residual gap.

**Ledger entries written**: insights.md 1 NEW (fold init from hydrated anchors not identity) + 2 DUPs skipped (insights.md:1274, insights.md:1279); fails.md 1 NEW (get_int_present not stubbed) + 2 DUPs skipped (fails.md:765, fails.md:788).

**Runtime-invariant recommendations (→ /context-constitution)**:
- ANALYSIS-COOLDOWNS-1: boot backfill uses `ORDER_STATUS_UNSPECIFIED` not `ORDER_STATUS_FILLED` — covers partially-filled-then-cancelled orders with accurate `filled_qty`; do not narrow to FILLED without accounting for this cohort.
- ANALYSIS-LIVLOOP-1: skip-until-known guard fires on `_last_entry_at.get(key) is None`, not on `last_exit_at is None` — these have different semantics; do not conflate.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at this commit; recoverable via `git show <pre-archive-SHA>:<path>`.
