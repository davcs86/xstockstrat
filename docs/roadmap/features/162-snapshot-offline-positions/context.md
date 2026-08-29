# Context: snapshot-offline-positions

**Feature**: `docs/roadmap/features/162-snapshot-offline-positions/feature.md`
**Product Spec**: `docs/roadmap/features/162-snapshot-offline-positions/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/162-snapshot-offline-positions/implementation-spec.md`

---

## Session 2026-08-29 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Story arrived as a detailed design proposal (effective-dated opening baseline vs. destructive set).
  Before formalizing, ran three read-only recon passes against the live code; findings that reshaped
  the proposal and are baked into the spec:
  - **The offline position fold runs in `xstockstrat-trading`, not `xstockstrat-portfolio`.**
    `ConfirmOrder` folds all confirmed offline orders via the shared engine `packages/proto/pnl/pnl.go`
    (`pnl.Fold`), emits an absolute `account.positions.synced` event; portfolio only *stores* it
    (`ConsumePositionSyncs`). So the baseline change lands in trading + the shared `pnl` engine.
    Source query `ListConfirmedOfflineOrdersByAccount` is already ordered `filled_at ASC NULLS LAST`;
    `filled_at` (migration `008_offline_accounts`) is the T0 anchor. `pnl.Fold` takes only `[]Fill`
    with an empty accumulator → needs a seeded `FoldFrom(baseline, fills)` variant (FR-4).
  - **There is no ledger event-type enum.** `ledger.proto` `event_type` is a free-form `string`
    (deliberate generic-store exception). So "new ledger event type" = a new string constant +
    emitting-service CLAUDE.md table row, **zero proto change** (FR-6). The ledger is physically
    append-only (DB triggers reject UPDATE/DELETE) and its `idempotency_key` is *return-the-original*,
    not overwrite — "replace baseline on re-submit" must be modeled in a plain mutable table
    (`trading.offline_position_baselines`, FR-3), not in the ledger.
  - **`list_positions` already exists** as an operation on `manage_offline_account` → `PortfolioService.ListPositions`;
    the `Position` message already carries `avg_entry_price`/`cost_basis`/`unrealized_pnl`/`account_id`,
    so `as_of`/`source` provenance (FR-7) is additive fields, not a new read path.
  - **`confirm_order` is keyed by `order_id`**, not a client UUID; idempotency is recompute-from-all-confirmed.
    The deterministic nonce lives at `record_order` (`client_order_id`, feature 101). So `client_snapshot_id`
    is a genuinely new idempotency surface, and the mechanism it mirrors is "recompute the projection from
    the current event/baseline set", not a keyed ledger replace — spec framing corrected accordingly.
  - **Storage:** offline fills are `trading.orders` rows (unsigned qty + `side` enum; sign applied at
    fold time via `offlineFillsFromOrders`). Decision: the baseline is a **separate table**, NOT synthetic
    orders — a synthetic sell would register as a closing trade and corrupt realized P&L (FR-3).
- Known traps folded into product-spec Open Questions from `fails.md`:
  - 2026-08-05 (add-ikbr-account-support): `account.positions.synced` shipped missing `user_id` →
    weeks-later production reconciliation bug. This feature consumes+produces reconciliation payloads;
    every reconciler field must be present before launch.
  - 2026-07-01 (056-open-positions-ui → C-10(b)): a displayed value must be surfaced by every read path
    (`ListPositions` AND `buildAccountPortfolio`/`ListPortfolios`) with a parity test — FR-7/AC-12.
- Open design forks left for `/sdd-design` (not silently decided): warn-vs-reject on snapshot over
  unconfirmed NEW orders; audit-event idempotency (append-latest vs content-hash); oversell-past-baseline
  realized correctness (verify `pnl.RealizedDelta` under a seeded accumulator); `filled_at` NULL handling.
- Recon was read-only (no code changed). Consumer surface (C-14): Agent tool `manage_offline_account`
  (`snapshot_positions` op + `list_positions` provenance); UI display deferred as optional, not required.

## Session 2026-08-29 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Verdict: PASS WITH WARNINGS (no blockers, no Floor breach). All 3 warnings addressed in the same pass:
  - Criterion 9 (unchecked `- [ ]` in Open Questions): reworked — the two known-traps are now
    bound-constraint `> Note` blocks (they are FR-6/FR-7-enforced requirements, not open decisions),
    and the four genuine forks moved under `### Deferred to /sdd-design` with leans, no checkbox syntax.
  - C-3 (paper-safety not stated): added to FR-4 — the OFFLINE snapshot/fold is paper-safe and
    independent of the paper/live axis.
  - C-5 (fill-status coverage not stated): added to FR-4 — the fold reads already-confirmed orders
    regardless of PARTIALLY_FILLED vs FILLED.
- Overlap scan: CLEAN. No config-key/proto-field/migration-NNN/file collisions. Concrete free slots
  confirmed for /sdd-spec: trading migration `009` (tips at `008_offline_accounts`); `Position`
  additive fields 22/23 (message tops at 21); `FoldFrom` net-new in `packages/proto/pnl/pnl.go`
  (only `Fold`/`RealizedDelta` exist today). Only concurrent features 084/142 touch disjoint
  resources (deploy/compose, marketdata). Touched services are trunk baseline from launched 157/159.
- Not a re-attempt of any demoted/canceled feature (none semantically related to offline-position snapshots).
