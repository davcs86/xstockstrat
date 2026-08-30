# Context: snapshot-offline-positions

**Feature**: `docs/roadmap/features/163-snapshot-offline-positions/feature.md`
**Product Spec**: `docs/roadmap/features/163-snapshot-offline-positions/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/163-snapshot-offline-positions/implementation-spec.md`

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

## Session 2026-08-30 — sdd-design

- Phase 0 Recon: wrote recon.md (services: trading, portfolio, agent, ledger, packages/proto/pnl).
  Key reuse patterns: the ConfirmOrder→account.positions.synced recompute+emit path; the shared
  pnl.Fold/RealizedDelta engine (extended via an additive FoldFrom sibling); credentials_json
  blob-as-string. C-16 read surfaced a NEW hard requirement: deregister must purge the baseline
  table (@AC-15 full-purge) → added FR-8 + AC-18.
- Phase 1 Grilling: 3 rounds (full). Chosen approach: trading-owned baseline table + seeded FoldFrom
  via an extracted foldInto + provenance computed in trading's emit loop + statement-sealed realized
  reset + audit account.positions.baseline_set + agent snapshot_positions op. Rejected: synthetic-orders
  baseline, lot-lineage provenance, provenance-on-portfolio-read, carry-forward realized, lock-inside-producer.
- User decisions at the gates (P-04):
  - Mixed-lot provenance → PositionSource MIXED=3, **symbol-level** semantic (seeded symbol + any
    post-T0 fill → MIXED regardless of surviving baseline shares; flatten-refill → MIXED). AC-13/AC-17.
  - Realized on re-snapshot → **statement-sealed reset** (later snapshot reseats realized via the
    replace-not-accumulate UpsertOfflineRealized). AC-14 asserts the observable 600→0.00 transition.
- Round-3 blocker (new, not in the ledger): the snapshot handler must hold s.confirmLock(accountID)
  around persist+recompute+emit — ConfirmOrder already holds it (trading.go:912) and @AC-10 idempotency
  depends on a serialized recompute; the extracted producer stays lock-free (caller-holds-lock).
  Baked into design.md; @AC-10 concurrency test required.
- Other resolutions baked in: fail-closed baseline load (rows→baseline / zero→fold-all / ERROR→skip-emit,
  never fold-all on error); producer-level seam test (drive recomputeAndEmitOfflinePositions, not just
  FoldFrom); non-empty user_id on the shared emit (add-ikbr trap); warnings triggered by any NEW offline
  order at snapshot time.
- Constitution rules touched: C-01/C-03/C-04/C-07/C-08/C-10(b)/C-14/C-15/C-16/P-03/P-06; Floor F-01/F-04/F-06/F-07 all honored (no breach).
- Deferred to /sdd-spec (grounded search required): deregister purge site path:line; portfolio
  migration number via a CROSS-REMOTE-BRANCH max(NNN) scan (fails.md 2026-07-29/081 numbering trap;
  recon shows 012 last → likely 013).
- Status: spec-ready → design-approved.

## Session 2026-08-30 — sdd-spec

- Generated implementation-spec.md with 14 steps. Status → implementation-ready.
- Consumed recon.md + design.md as authoritative inputs; reused recon's Codebase Map directly and
  only re-discovered the three groundings design.md deferred to /sdd-spec.
- Key codebase findings (grounded this session):
  - **Migration numbers via cross-remote-branch scan** (fails.md 2026-07-29/081 trap): trading max
    NNN = `008` across ALL remote branches → next `009`; portfolio max = `012` → next `013`. No
    collision on any branch. (Local `ls` alone would have been unsafe; scanned `git ls-remote` heads.)
  - **Deregister purge site grounded**: `DeregisterBrokerAccountSvc` at `trading.go:2736`; OFFLINE
    branch at `:2758`; the `account.deregistered` emit at `:2759`. `DeleteBaselinesByAccount` must run
    synchronously in that branch, fail-the-RPC, BEFORE the emit.
  - **Recompute/emit block to extract**: `trading.go:934-980` (ConfirmOrder), already fail-closed on
    query error (`:937-943`); `confirmLock` at `:842-857`, acquired `:912-914`. Extracted producer
    `recomputeAndEmitOfflinePositions` stays lock-free (caller-holds-lock; ConfirmOrder holds the
    non-reentrant mutex — internal acquire would deadlock).
  - **pnl engine**: `Fold` loop body `pnl.go:59-90`; extract `foldInto(accs, fills)`, add
    `FoldFrom(baseline, fills)` sibling; `FoldFrom(nil, fills)==Fold(fills)` by construction. Signed
    `Lot.CostBasis` (`:38-41`); `RealizedDelta` reduce/flip (`:17-28`) handles the seam unchanged.
  - **Handler twin**: trading has a Connect handler + `grpcTradingAdapter` (`internal/handler/trading.go:69,158`);
    new RPC needs a method on both plus the service. `extractUserID(ctx)` sets trusted user_id (`:75`).
  - **Portfolio read-path parity (C-10(b))**: the shared `positionColumns` SELECT constant
    (`portfolio_repo.go:285`) drives BOTH `ListPositions` (`:117`) and `ListPositionsByAccount`
    (`:498`, behind `buildAccountPortfolio`/`ListPortfolios`) — one edit surfaces provenance on both
    paths; parity test pins it (AC-12). `positionSyncPayload` at `portfolio_service.go:826-851`;
    `processPositionSync` upsert loop `:925-952`; realized gate `:948` (replace-not-accumulate).
  - **Proto slots free** (overlap-scan confirmed): `Position.as_of=22`, `Position.source=23`
    (message tops at 21). New RPC + PositionBaseline/RejectedBaselineRow/Request/Response on
    TradingService. Response carries BOTH `rejected` (per-row) and `warnings` (NEW-order advisory).
  - **Agent consumer surface**: `manage_offline_account` at `tools.py:1468`, dispatch ladder
    `:1508-1542`; `confirm_offline_order`/`list_account_positions` at `client.py:1685,1742`.
    `list_account_positions` uses `MessageToDict` → `source`/`as_of` ride through with NO client
    change once the proto carries them (verify, don't assume). `credentials_json` blob-as-string
    precedent `client.py:1638` reused for `positions_json`.
  - **Tool count unchanged**: `snapshot_positions` is a new OPERATION on an existing tool, not a new
    tool — `mcp-tools.md:3,37` "thirty tools" must NOT change (recorded as an absence claim to verify).
  - **buf breaking form** (from ci.yml:109-123): `cd packages/proto && buf lint . && buf breaking .
    --against '../../.git#branch=main-dev,subdir=packages/proto'`.
- **Out-of-repo surface (P-03)**: the `xstockstrat-trade-confirm-ingest` skill named in the product
  spec Consumer Surface is session/marketplace-managed, NOT in the repo tree (`find` returns nothing;
  only `plugins/strat-lab/` is in-tree, and the root CLAUDE.md strat-lab rule does not list
  `manage_offline_account`). Updating that external skill is a follow-up outside this PR's reach; the
  in-repo doc surfaces (Step 14) are the complete repo-side C-14 documentation. Flag at execute time.
- All 18 acceptance scenarios (AC-1..18) mapped to covering test steps (4, 9, 11, 13) — see the
  Scenario Coverage table in the Execution Summary. C-15 satisfied.

## Session 2026-08-30 — sdd-review impl-spec (advisory)

- Result: 0 blockers, 1 warning, 2 notes (advisory — did not block). No Floor risk. All 18 acceptance
  scenarios (AC-1..18) trace to a covering RED test step (Steps 4, 9, 11, 13). Overlap scan CLEAN
  (trading migration 009 / portfolio 013 / Position fields 22,23 all next-free; no merge-order entry).
- All findings ADDRESSED in the spec before /sdd-execute (F-09 not yet in effect):
  - [x] Step 10 (C-01 evidence precision): INSERT edit was cited at `UpsertPosition`
    (`portfolio_repo.go:57-115` / INSERT `:59`, the order.filled path) but the sync-path provenance
    keys flow through `UpsertPositionFromSync` (`:307-317` / INSERT `:309-313`). Citation corrected in
    the Codebase Evidence and Instruction 2, with an explicit "do not touch UpsertPosition" guard.
  - [x] Execution Summary merge-order prose: reworded — only the portfolio migration (Step 6) is
    order-critical before the trading emit (Step 8); the consumer (Step 10) may follow (unmapped
    source/as_of keys default safely to source=0 / null as_of).
  - [x] Step 4 (coverage formality): added a note that the ≥40% coverage gate for trading-service code
    is asserted in Step 9, not here (pnl is coverpkg-excluded).
- Nothing carried into execution unaddressed.

## Session 2026-08-30 — sdd-execute (sequential mode, Steps 1-5)

- Execution started in sequential mode (§5.1–§5.8). Branch: `claude/snapshot-positions-contract-1fcdmt`.
- **Step 1 (proto)**: Added `SnapshotOfflinePositions` RPC, `PositionBaseline`, request/response messages
  to `trading.proto`; added `PositionSource` enum and `as_of=22`/`source=23` fields to `Position` in
  `portfolio.proto`. `buf lint` + `buf breaking` clean. Committed `878407e3^`.
- **Step 2 (proto-gen)**: Ran `./scripts/buf-gen.sh` with host-native toolchain (PATH fix:
  `export PATH="$(go env GOPATH)/bin:$PATH"`). Reverted `analysis.pb.go` cosmetic diff (known
  tabs-vs-spaces artifact). 20 files changed. Verified `SnapshotOfflinePositions` in Go/Python stubs,
  `PositionSource` in Go/Python/TS stubs.
- **Step 3 (pnl FoldFrom)**: Extracted loop body into unexported `foldInto(accs, fills)`, rewrote
  `Fold` as `foldInto(make(map[string]Lot), fills)`, added `FoldFrom(baseline, fills)` sibling.
  Behavior byte-identical for existing callers; compile verified.
- **Step 4 (pnl test)**: Added `TestPnLFoldFrom_Trading` with 7 table-driven cases + 1 parity sub-test
  covering AC-1/AC-2/AC-3/AC-4/AC-17. All pass with `-race -count=1`. Also added `TestRealizedDelta_Trading`.
- **Step 5 (trading migration 009)**: Created `009_offline_position_baselines.up.sql` (plain table with
  composite PK `(account_id, client_snapshot_id, symbol)`, `as_of` DESC index) and matching `.down.sql`
  (DROP TABLE). Spec status updated for Steps 1-5 → `done`.
- **Deviation**: spec file status updates for Steps 1-4 were deferred to the Step 5 commit (caught up
  in the same commit rather than per-step as §5.5 prescribes). No data loss — all step outcomes recorded.
- Steps since last checkpoint: 5 → step-cap checkpoint triggered (§5.5b).

## Session 2026-08-30 — sdd-execute (sequential mode, Steps 6-8)

- Continuing from checkpoint; Steps 6-8 committed.
- **Step 6 (portfolio migration 013)**: Created `013_positions_provenance.up.sql` adding `source`
  (INTEGER, NOT NULL DEFAULT 0) and `as_of` (TIMESTAMPTZ, nullable) columns to `portfolio.positions`;
  matching `.down.sql` with DROP COLUMN for both.
- **Step 7 (baseline repository)**: Created `offline_baseline_repo.go` with 4 methods on `*TradingRepo`:
  `UpsertBaselineSnapshot` (replace-in-tx DELETE+INSERT, AC-6), `EffectiveBaselineByAccount`
  (greatest as_of with created_at tiebreak, drops qty=0, returns `map[string]pnl.Lot`),
  `DeleteBaselinesByAccount` (FR-8 purge), `HasUnconfirmedOfflineOrders` (AC-16 warning).
  Compile verified.
- **Step 8 (THE BIG STEP)**: Implemented the core service+handler changes in `trading.go` and
  `handler/trading.go`:
  - Extracted recompute-and-emit block from `ConfirmOrder` into private, lock-free
    `recomputeAndEmitOfflinePositions(ctx, accountID, userID)` with `// caller must hold
    s.confirmLock(accountID)` doc comment.
  - Replaced `pnl.Fold(...)` with fail-closed three-branch baseline build: loads
    `EffectiveBaselineByAccount`, filters confirmed orders to `filled_at > asOf` in baseline branch,
    uses `pnl.FoldFrom(seedLots, fills)` for seeded fold, `pnl.Fold(...)` for no-baseline branch.
  - Added symbol-level provenance computation: `MIXED` (baseline + post-T0 fill), `BASELINE`
    (baseline only), `ORDERS` (fills only). `source` and `as_of` added to `posEntries` map.
    Used `portfoliov1.PositionSource_*` (enum is in portfolio.proto, not trading.proto).
  - `ConfirmOrder` now delegates to extracted producer (still under existing confirmLock).
  - Added `SnapshotOfflinePositions` method: offline-only gate (AC-9), per-row validation
    (fault-tolerant, rejects empty symbol/non-finite/negative avg_cost, qty=0 valid per AC-8/AC-15),
    warnings for unconfirmed NEW orders (AC-16), confirmLock serialization (AC-10), persists via
    `UpsertBaselineSnapshot`, emits `account.positions.baseline_set` audit event (FR-6), then calls
    `recomputeAndEmitOfflinePositions`.
  - Added deregister purge: `DeleteBaselinesByAccount` runs BEFORE `account.deregistered` emit in
    `DeregisterBrokerAccountSvc`'s OFFLINE branch (FR-8/AC-18), fail-the-RPC on error.
  - Added handler twin: `TradingHandler.SnapshotOfflinePositions` (sets `req.Msg.UserId` from
    `extractUserID(ctx)`, preserves gRPC status codes) and `grpcTradingAdapter.SnapshotOfflinePositions`.
  - Full build (`cmd/server`) and existing tests pass. No new jscpd duplication.
- **Deviation**: spec file status updates for Steps 6-7 were caught up in the Step 8 commit.

## Session 2026-08-30 — sdd-execute (Steps 9–14)

- **Step 9** (trading snapshot tests): 19 test functions covering AC-1 through AC-18 plus
  validation/concurrency in `trading_offline_test.go`. Enhanced `recordingLedger` with
  `requestsByType()` helper; added `fakeBaselineStore` (~100 lines) enabling test-only scenarios
  without the live DB. All 19 pass with `-race`.
- **Steps 10–11** (portfolio provenance persistence + tests):
  - Extended `positionSyncPayload` inner position entry with `Source int` / `AsOf string` and
    `processPositionSync` passes them through to `PositionValuation`.
  - Extended `PositionValuation` struct, `UpsertPositionFromSync` INSERT/ON CONFLICT with
    `source` ($14) and `as_of` ($15), and `positionColumns` + `scanPositionRow` with the two
    new columns.
  - Created `export_test_helpers.go` (`ExportedPositionColumns()`) for cross-package test assertions.
  - Tests: `TestPositionSyncPayload_AC11_ProvenanceParsing`, `_AC11_LegacyDefaultsZero`,
    `_AC12_ReadPathParity` (pins `positionColumns` to contain `source` and `as_of`).
  - Fixed pgxmock regression in `TestGetPosition_ScopesToRequestedAccount` — scanPositionRow
    now expects 17 columns; mock needed `"source", "as_of"` + `0, nil`.
- **Steps 12–13** (agent snapshot_positions):
  - Added `snapshot_offline_positions()` to `client.py` — parses `positions_json` JSON string,
    builds `PositionBaseline` messages, dials TradingService with `x-user-id` metadata.
  - Added `snapshot_positions` dispatch branch in `tools.py` `manage_offline_account` with
    `as_of`, `client_snapshot_id`, `positions_json` params.
  - 5 agent tests: `test_snapshot_offline_positions_forwards_baseline_and_user`,
    `_no_as_of`, `_bad_json_raises`, `_non_array_raises`,
    `test_list_positions_provenance_passthrough`. All 323 agent tests pass, 78% coverage.
- **Step 14** (docs): Updated `mcp-tools.md` (snapshot_positions operation + provenance note),
  agent CLAUDE.md (tool row), trading CLAUDE.md (offline_position_baselines table +
  `account.positions.baseline_set` ledger event), portfolio CLAUDE.md (source/as_of columns in
  positions table + provenance note in `account.positions.synced` consumer). Tool count
  unchanged at thirty-two.
- **Out-of-repo surface note (P-03)**: the `xstockstrat-trade-confirm-ingest` skill is
  session/marketplace-managed, not a file in this repo. Updating it is a follow-up outside
  this PR's reach; the in-repo doc surfaces (Step 14) are the complete repo-side C-14
  documentation.
- All 14 steps done → status `code-completed`.

## Session 2026-08-30 (CI: feature status automation)

- Promotion PR #1047 merged to main
- Feature promoted and committed: 57e40a310ed09b205ce76ca440ee7a40a87fb7ec
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-30
