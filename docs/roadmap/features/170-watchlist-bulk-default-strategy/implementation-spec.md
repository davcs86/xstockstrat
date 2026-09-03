# Implementation Spec: watchlist-bulk-default-strategy

**Status**: `pending`
**Created**: 2026-09-03
**Feature**: `docs/roadmap/features/170-watchlist-bulk-default-strategy/feature.md`
**Total Steps**: 15 (Step 10 split into 10 + 10b to keep each step ≤3 files — advisory review 2026-09-03)
**Feature Branch**: `feature/watchlist-bulk-default-strategy`

---

## Execution Summary

Implements five additive slices from `design.md` in dependency order: (1) proto (additive
`default_strategy_id` fields + `google.protobuf.FieldMask update_mask` on `UpdateWatchlistRequest` +
a new atomic `UpdateWatchlistBindings` RPC), (2) proto-gen, (3) portfolio migration `015`, then three
cohesive `xstockstrat-portfolio` service slices each with a paired Go test — (4/5) persist+read the
watchlist-level default and apply the add-time default at the single `requestBindings` chokepoint,
(6/7) the presence-gated field-mask partial `UpdateWatchlist`, (8/9) the set-based bulk
`UpdateWatchlistBindings`. Then the two named consumer surfaces (C-14): (10/11) the `/insights` UI
multi-select + bulk action bar + default-strategy control with a Playwright e2e, and (12/13) the
`xstockstrat-agent` `manage_watchlist` default field + a new `"assign"` verb on
`manage_watchlist_symbols` with a paired pytest, closing with (14) the `mcp-tools.md` doc-parity
update (C-10 tool-doc parity, same PR).

Backend goes first because both consumer surfaces call the new RPC/fields. No new env vars or ports
are introduced (all wiring is over the existing portfolio gRPC endpoint), so **no** `docker-compose.yml`
/ `.do/app.yaml` / `.do/app.dev.yaml` changes are required — confirmed against the design's
"Inter-service edges: unchanged" and "New env vars / ports: none" (`recon.md` Dependencies).

### Scenario Coverage (Constitution C-15)

| @AC | Scenario | Covered by step(s) |
|---|---|---|
| AC-1 | Bulk-remove selected symbols (UI) | 11 |
| AC-2 | Bulk-assign one strategy atomically | 9 (backend), 11 (UI) |
| AC-3 | Bulk-assign unbound sentinel clears | 9 (backend), 11 (UI) |
| AC-4 | Bulk-assign rejects absent symbol, no partial write | 9 |
| AC-5 | Bulk-assign scoped to owning user | 9 |
| AC-6 | Set and read a watchlist default strategy | 7 (backend), 11 (UI) |
| AC-7 | Adding a bare symbol binds to default at add time | 5 |
| AC-8 | Explicit per-symbol strategy overrides default | 5 |
| AC-9 | Changing default does not retroactively rebind | 5, 7 |
| AC-10 | CreateWatchlist applies default to initial bare symbols | 5 |
| AC-11 | Agent manage_watchlist round-trips default | 13 |
| AC-12 | Agent bulk-assigns across selected symbols | 13 |
| AC-13 | Switching active watchlist clears pending selection | 11 |

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto) — stubs are generated from the changed `.proto`.
- Steps 4, 6, 8 (portfolio service) require Step 2 — they use the regenerated Go types
  (`default_strategy_id`, `update_mask`, `UpdateWatchlistBindingsRequest/Response`).
- Steps 4/6/8 require Step 3 (migration 015) at runtime (the column must exist); the Go tests
  (Steps 5/7/9) run offline against `fakeWatchlistStore` and do not need the DB.
- Step 5 [test] covers Step 4 [service]; Step 7 covers Step 6; Step 9 covers Step 8.
- Step 10 (UI data layer: hooks + BFF + e2e mock) requires Step 2 (proto stubs power the browser
  typed client) and Steps 6+8 (it wires the masked `UpdateWatchlist` and `UpdateWatchlistBindings`).
  Step 10b (UI components) requires Step 10 (consumes the new hooks). Step 11 [test] covers 10 + 10b.
- Step 12 (agent) requires Steps 6+8 (masked update + bulk RPC). Step 13 [test] covers Step 12.
- Step 14 (docs) requires Step 12 (documents the shipped tool surface) — same PR as the agent change
  (C-10 tool-doc parity).
- **Open risk carried from `design.md`** — the bulk NOT_FOUND count-parity check compares the
  **post-`normalizeSymbols` (deduped)** count (Step 8 / asserted in Step 9); existing UI+agent
  `UpdateWatchlist` flows must keep `update_mask` unset to stay on the legacy replace-all path
  (asserted in Steps 11 and 13); the anti-rebind guarantee is SQL-level (`insertBindingsTx` ON
  CONFLICT DO NOTHING) and only fake-modeled in the Go tests (caveat recorded in Step 5).

---

### Step 1 — proto: additive default_strategy_id fields, update_mask, and UpdateWatchlistBindings RPC

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/portfolio/v1/portfolio.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking change (additive only), `buf lint`/`buf breaking` pass; xstockstrat-portfolio owner — concurrent write safety of the new atomic RPC shape. (Consumers `xstockstrat-ui` + `xstockstrat-agent` owners are affected surfaces.)

**Codebase Evidence**:
- `Watchlist` message fields 1–9, next free **10**: `portfolio.proto:224-238` (`system_managed = 9` is the last field).
- `CreateWatchlistRequest` fields 1–4, next free **5**: `portfolio.proto:242-248`.
- `UpdateWatchlistRequest` fields 1–5, next free **6**: `portfolio.proto:269-276`.
- Single-row RPC to mirror: `rpc UpdateWatchlistBinding(...)` at `portfolio.proto:39`; its req/resp `UpdateWatchlistBindingRequest{watchlist_id=1, symbol=2, strategy_id=3}` / `UpdateWatchlistBindingResponse{binding=1, updated_at=2}` at `portfolio.proto:318-326`.
- `WatchlistBinding{symbol=1, strategy_id=2, source=3}`: `portfolio.proto:215-221`.
- FieldMask precedent (import + usage) confirmed in three sibling protos: `import "google/protobuf/field_mask.proto";` at `analysis.proto:9`, `ingest.proto:10`, `indicators.proto:9`.
- Existing imports at head of file: `import "google/protobuf/timestamp.proto";` + `import "common/v1/common.proto";` (`portfolio.proto:7-8`).

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. Add `import "google/protobuf/field_mask.proto";` alongside the existing imports at `portfolio.proto:7-8`.
2. In `Watchlist` (`:224-238`), append after `bool system_managed = 9;`:
   `string default_strategy_id = 10;  // "" = none (feature 170). Add-time-only default for bare symbols; never a read-time fallback.`
3. In `CreateWatchlistRequest` (`:242-248`), append `string default_strategy_id = 5;` after `bindings = 4`.
4. In `UpdateWatchlistRequest` (`:269-276`), append `string default_strategy_id = 6;` and
   `google.protobuf.FieldMask update_mask = 7;` after `bindings = 5`. Add a comment that when
   `update_mask` is present the update is a scalar partial write over `{name, description,
   default_strategy_id}` and, when absent, the legacy replace-all semantics are unchanged.
5. Add the new RPC to the `PortfolioService` block, immediately after `UpdateWatchlistBinding` (`:39`):
   `rpc UpdateWatchlistBindings(UpdateWatchlistBindingsRequest) returns (UpdateWatchlistBindingsResponse);`
   with a comment mirroring the single-row RPC (ownership from `x-user-id`; atomic set-based rebind;
   `NOT_FOUND` if any requested symbol is absent).
6. Add the two new messages near `UpdateWatchlistBindingRequest/Response` (`:318-326`):
   - `UpdateWatchlistBindingsRequest { string watchlist_id = 1; repeated string symbols = 2; string strategy_id = 3; }` — comment: `user_id intentionally absent — ownership from x-user-id (feature 170)`.
   - `UpdateWatchlistBindingsResponse { repeated WatchlistBinding bindings = 1; google.protobuf.Timestamp updated_at = 2; }` — comment: `bindings = the changed rows only; updated_at = list-level watchlists.updated_at, bumped once in-tx`.

**Verification**:
```
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/watchlist-bulk-default-strategy"
```
Both must pass (all changes additive → `buf breaking` green). If the feature branch has no prior
proto commit to diff against, run `buf breaking --against ".git#branch=main-dev"`.

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/portfolio/v1/*` — modify (generated)
- `packages/proto/gen/python/portfolio/v1/*` — modify (generated)
- `packages/proto/gen/ts/portfolio/v1/*` (+ compiled `gen/ts/dist/`) — modify (generated)

**Reviewers**: Proto Reviewer — inherited from Step 1 (same reviewers).

**Codebase Evidence**:
- Codegen entrypoint: `./scripts/buf-gen.sh` (root CLAUDE.md § Generating Proto Stubs — generates TS/Python/Go and compiles the TS package).

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root (Docker codegen container). Do not hand-edit any file under `packages/proto/gen/`.
2. Commit the full regenerated tree so the CI `proto-freshness` job stays green.

**Verification**:
```
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
```
Expect a **non-empty** diff staged (the new field/RPC types), then a clean tree after staging — i.e.
re-running `buf-gen.sh` a second time produces **no** further diff (idempotent generation).

---

### Step 3 — migration: 015 add portfolio.watchlists.default_strategy_id

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/migrations/015_watchlist_default_strategy.up.sql` — create
- `services/xstockstrat-portfolio/migrations/015_watchlist_default_strategy.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps, up+down pair present), additive ADD COLUMN, run-order compliance; xstockstrat-portfolio owner — schema ownership.

**Codebase Evidence**:
- Last migration is `014_positions_fees_accum` (confirmed via `ls services/xstockstrat-portfolio/migrations/`) → next free is **015**.
- ADD COLUMN precedent (same table family, `TEXT NOT NULL DEFAULT ''`): `008_watchlist_symbol_strategy.up.sql` = `ALTER TABLE portfolio.watchlist_symbols ADD COLUMN IF NOT EXISTS strategy_id TEXT NOT NULL DEFAULT '';`; its down = `ALTER TABLE portfolio.watchlist_symbols DROP COLUMN IF EXISTS strategy_id;`.
- Base watchlists table lives in `007_watchlists.up.sql` (per recon `migrations/007_watchlists.up.sql:6-14`).

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. `015_watchlist_default_strategy.up.sql`:
   `ALTER TABLE portfolio.watchlists ADD COLUMN IF NOT EXISTS default_strategy_id TEXT NOT NULL DEFAULT '';`
   with a header comment (feature 170; `''` = none; add-time-only default). Mirror the `008` header style.
2. `015_watchlist_default_strategy.down.sql`:
   `ALTER TABLE portfolio.watchlists DROP COLUMN IF EXISTS default_strategy_id;`

**Verification** (offline, no DB — per `reference/spec-template.md` § Migration step verification):
```
ls services/xstockstrat-portfolio/migrations/015_*.up.sql services/xstockstrat-portfolio/migrations/015_*.down.sql
```
Then read both files: confirm the `.up` `ADD COLUMN` has an inverse `DROP COLUMN` in the `.down`, and
`015` is the next number after `014`. Do **not** spin up Postgres — the real apply/rollback runs in CI/deploy.

---

### Step 4 — service: persist+read default_strategy_id and apply the add-time default (portfolio)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: xstockstrat-portfolio owner — concurrent write safety, provenance preservation (SIGNAL untouched), no read-time fallback.

**Codebase Evidence**:
- `scanWatchlist` scans `watchlist_id, user_id, name, description, created_at, updated_at, system_managed` and builds the `Watchlist` proto: `watchlist_repo.go:380-397`. Both SELECT sites feeding it: `GetByID` `watchlist_repo.go:92` and `ListByUser` `watchlist_repo.go:115` (exactly two consumers — design F-04 note).
- `Create` INSERT of `(user_id, name, description)`: `watchlist_repo.go:47-50`. `Update` SET of `name, description, updated_at`: `watchlist_repo.go:164-166` (does **not** touch `default_strategy_id` — kept out of the legacy SET so it is preserved-for-free, per design slice 4).
- `EnsureSystemManaged` INSERT omits new columns, relies on DEFAULT: `watchlist_repo.go:71-75` (leave unchanged — design C-16 PRESERVE `@AC-6 feature-127`).
- The single add-time chokepoint `requestBindings` (two return branches: `bindings` present `:1315`; legacy `symbols` `:1321`): `portfolio_service.go:1313-1322`; `normalizeBindings` preserves `Source` at `:1300-1304`.
- `CreateWatchlist` builds bindings at `portfolio_service.go:1378` then calls `s.watchlists.Create(...)` `:1391`.
- `AddWatchlistSymbols` `loadOwned`s the existing row at `:1557` then builds `add := requestBindings(...)` `:1561`.
- Legacy replace-all `UpdateWatchlist` builds bindings at `:1480` (must pass `""` as the default — never write the persisted default here).
- `WatchlistStore` interface `Create`/`Update` signatures: `portfolio_service.go:1242`/`:1245`.
- `fakeWatchlistStore.Create`/`Update` (build the returned `Watchlist`): `watchlist_service_test.go:67-74`/`:94-102`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Read path** — widen `scanWatchlist` (`watchlist_repo.go:380`) to scan a trailing `default_strategy_id` and set `DefaultStrategyId` on the returned proto. Add `, default_strategy_id` to the SELECT column lists in `GetByID` (`:92`) and `ListByUser` (`:115`) so both scan sites match.
2. **Write path (Create)** — extend `WatchlistRepo.Create` to accept and INSERT `default_strategy_id` (add it to the `(user_id, name, description)` INSERT at `:48-50`, `$4`). Thread a new `defaultStrategyID string` param through the `WatchlistStore.Create` interface method (`portfolio_service.go:1242`), the real repo, and `fakeWatchlistStore.Create` (`watchlist_service_test.go:67`).
3. **Add-time default helper** — add `func applyDefaultStrategy(bindings []*portfoliov1.WatchlistBinding, defaultStrategyID string) []*portfoliov1.WatchlistBinding` that, for each binding, fills `StrategyId = defaultStrategyID` **only when** `b.GetStrategyId() == "" && b.GetSource() != portfoliov1.WatchlistEntrySource_WATCHLIST_ENTRY_SOURCE_SIGNAL` (Option B, MANUAL-only — design Fork 1). Wrap **both** return branches of `requestBindings` (or apply at each call site right after `requestBindings`) so `CreateWatchlist` and `AddWatchlistSymbols` share one path (closes fails.md:37/056 dual-path divergence).
4. **Wire the effective default per caller**: `CreateWatchlist` (`:1378`) → `req.GetDefaultStrategyId()`, and pass that same value to `s.watchlists.Create(...)` (`:1391`) so it persists on the row. `AddWatchlistSymbols` (`:1561`) → the persisted `existing.GetDefaultStrategyId()` from the `loadOwned` row (`:1557`). Legacy `UpdateWatchlist` (`:1480`) → `""` (never applies/persists the default; the field mask path in Step 6 owns default writes).
5. Preserve every existing invariant: `normalizeBindings` still runs (uppercases/dedupes/keeps `Source`); the per-list cap check stays; SIGNAL-sourced bare adds stay unbound.
6. Run `ruff`? No — this is Go. Lint command is in the paired test step (Step 5).

**Verification**: covered by Step 5's Go test + lint run (test-step pairing). No standalone command here.

---

### Step 5 — test: add-time default + row round-trip (portfolio)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify

**Reviewers**: xstockstrat-portfolio owner — test correctness, coverage threshold.

**Codebase Evidence**:
- Existing table-style watchlist tests + helpers to mirror: `TestUpdateWatchlistBinding_RebindsOneSymbol` `watchlist_service_test.go:657`, `_AbsentSymbolNotFound` `:713`, `_NonOwnerDenied` `:732`, `_EmptyStrategyUnbinds` `:751`; seed helpers `seedWatchlist` `:639`, `storeBinding` `:647`, `newSvc(store, cfg, ledger)` `:222`.
- `fakeWatchlistStore.AddSymbols` models `ON CONFLICT DO NOTHING` (existing binding wins): `watchlist_service_test.go:112-130` — the anti-rebind model.
- Test data stays **inline** (C-13): portfolio has no `internal/testdata/`; watchlist literals live in this file. One consumer → inline is compliant.

**TDD**: `red-green required` — write these to fail against the pre-Step-4 tree first.

**Covers**: `AC-7, AC-8, AC-9, AC-10`

**Instructions**:
1. `TestCreateWatchlist_AppliesDefaultToBareSymbols` (**AC-10**): create with `default_strategy_id="breakout"` and bare symbols AAPL, MSFT → resulting bindings both `→"breakout"`; assert the returned watchlist's `DefaultStrategyId == "breakout"` (row round-trip).
2. `TestAddWatchlistSymbols_BareSymbolInheritsDefault` (**AC-7**): seed a list with `DefaultStrategyId="swing"`; add bare AMD → binding `AMD→"swing"`.
3. `TestAddWatchlistSymbols_ExplicitStrategyOverridesDefault` (**AC-8**): same seed; add AMD with an explicit binding `strategy_id="breakout"` → `AMD→"breakout"` (explicit wins).
4. `TestAddWatchlistSymbols_SignalSourceSkipsDefault` (Fork 1 Option B guard): add a bare symbol with `Source=SIGNAL` to a list with a non-empty default → stays unbound (`strategy_id==""`), `Source` unchanged.
5. `TestUpdateWatchlist_DefaultChangeDoesNotRebindExisting` (**AC-9**): seed bindings AAPL→"", MSFT→"swing"; assert the legacy replace-all `UpdateWatchlist` (no mask) leaves both bindings unchanged and never writes the default (the mask path in Step 7 covers the set-default case). **Record on this test the design caveat**: the no-retroactive-rebind guarantee ultimately rests on `insertBindingsTx` `ON CONFLICT (watchlist_id,symbol) DO NOTHING` (`watchlist_repo.go:368`) and is here **modeled** by `fakeWatchlistStore.AddSymbols`, not DB-tested (add a comment so a future `DO UPDATE` change is flagged).
6. Extend `fakeWatchlistStore.Create` (and any other affected fake method) for the new `defaultStrategyID` param and to store/echo `DefaultStrategyId`.

**Verification**:
```
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
Confirm the new tests pass and total coverage stays ≥ 40%. **Note**: the new logic lives in the
`service`/`repository` packages, which CI excludes from coverage measurement (`COVERPKGS` filter) —
so no coverage threshold applies to it directly; the tests exercise it via `fakeWatchlistStore` and
the overall `total:` must remain ≥ 40%.

---

### Step 6 — service: field-mask partial UpdateWatchlist (portfolio)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: xstockstrat-portfolio owner — dynamic-SET safety (static allowlist, never interpolated columns), replace-all legacy path unchanged.

**Codebase Evidence**:
- `UpdateWatchlist` servicer: `portfolio_service.go:1468-1493`; name-empty guard at `:1477`; `loadOwned` gate at `:1474`.
- Legacy replace-all `WatchlistRepo.Update` (byte-for-byte unchanged when mask absent): `watchlist_repo.go:157-183` (SET `name, description, updated_at` then DELETE+reinsert bindings).
- `touchWatchlistTx` (bump `updated_at`, returns it): `watchlist_repo.go:351-363`.
- `WatchlistStore` interface: `portfolio_service.go:1241-1258` (add `UpdatePartial`).
- `scanWatchlist` now returns `DefaultStrategyId` after Step 4 — `GetByID` re-read is how the servicer returns the updated row.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Gate `UpdateWatchlist` on `req.UpdateMask != nil` (mirrors ingest `servicer.py:1168` / analysis `servicer.py:2444`, implemented natively in Go — design slice 4). When the mask is **absent (nil)**: run the existing replace-all path **byte-for-byte unchanged** (name-required guard at `:1477`, `requestBindings`, cap check, `s.watchlists.Update(...)`). Additionally: if the mask is absent **and** `req.GetDefaultStrategyId() != ""`, return `InvalidArgument("default_strategy_id requires update_mask")` (loud-fail; no silent no-op) so a caller cannot set the default via the legacy path.
2. When the mask is **present**: build the maskable write from a **package-level static allowlist map** `path→column` over `{"name":"name", "description":"description", "default_strategy_id":"default_strategy_id"}`. Columns come from the map (never interpolated from the mask string); values are `$N`-parameterized. Guards: an unknown/unlisted path (incl. `bindings`/`symbols`) → `InvalidArgument`; an empty-but-present mask → `InvalidArgument`; the name-empty guard fires **only** when `"name"` ∈ mask (`description`/`default_strategy_id` may be cleared to `""`).
3. Add `WatchlistRepo.UpdatePartial(ctx, watchlistID string, cols map[string]any) (*Watchlist, error)` that writes only the masked columns **plus always** `updated_at = now()` in one inline pgx tx (pattern `watchlist_repo.go:40-59`), `RowsAffected()==0 → ErrWatchlistNotFound`, then returns `r.GetByID(...)`. Do **not** clear bindings on the partial path.
4. Add `UpdatePartial` to the `WatchlistStore` interface (`:1241`) and to `fakeWatchlistStore` (Step 7).

**Verification**: covered by Step 7's Go test + lint run.

---

### Step 7 — test: field-mask partial update (portfolio)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify

**Reviewers**: xstockstrat-portfolio owner — mask-path correctness, legacy-path preservation.

**Codebase Evidence**:
- Seed/assert helpers as in Step 5 (`seedWatchlist:639`, `newSvc:222`).
- Legacy path assertion baseline: existing `UpdateWatchlist` behavior in `portfolio_service.go:1468`.

**TDD**: `red-green required` — fail against the pre-Step-6 tree.

**Covers**: `AC-6, AC-9`

**Instructions**:
1. `TestUpdateWatchlist_SetDefaultViaMask` (**AC-6**): `UpdateWatchlist` with `update_mask=["default_strategy_id"]`, `default_strategy_id="swing"` → the re-read watchlist has `DefaultStrategyId=="swing"`; existing bindings untouched (partial write does not clear symbols).
2. `TestUpdateWatchlist_MaskChangeDoesNotRebind` (**AC-9**): seed bindings AAPL→"", MSFT→"swing"; set default to "breakout" via mask → existing bindings unchanged.
3. `TestUpdateWatchlist_NoMaskLegacyReplaceAllUnchanged`: a no-mask update still replaces name/description/bindings exactly as before (regression guard on the legacy path).
4. `TestUpdateWatchlist_NoMaskWithDefaultRejected`: no-mask request carrying `default_strategy_id!=""` → `InvalidArgument`.
5. `TestUpdateWatchlist_UnknownMaskPathRejected`: mask `["bindings"]` (or empty mask) → `InvalidArgument`.
6. Implement `fakeWatchlistStore.UpdatePartial` mirroring the real repo (merge masked cols, bump timestamp, keep bindings).

**Verification**:
```
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
New tests pass; `total:` ≥ 40% (new logic is in the coverage-excluded `service`/`repository`
packages — no direct threshold; overall total must hold).

---

### Step 8 — service: atomic bulk UpdateWatchlistBindings RPC (portfolio)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify

**Reviewers**: xstockstrat-portfolio owner — atomicity (single tx, single updated_at bump), ownership scoping, zero-partial-write on absent symbol.

**Codebase Evidence**:
- Mirror target servicer (single-row): `UpdateWatchlistBinding` `portfolio_service.go:1496-1525` — `requireUserID` → `loadOwned` (NotFound/PermissionDenied) → normalize symbol → repo call → `emitEvent` → response with `timestamppb.New(updatedAt)`.
- Mirror target repo (single-row set-based UPDATE ... RETURNING + `touchWatchlistTx`): `watchlist_repo.go:247-281`; `pgx.ErrNoRows → ErrBindingNotFound` at `:263`.
- Set-based DELETE precedent using `symbol = ANY($2)`: `RemoveSymbols` `watchlist_repo.go:230-235`.
- `normalizeSymbols` (uppercase/trim/dedupe, first-seen order): `portfolio_service.go:1268-1283`.
- `loadOwned` service-layer ownership gate (repo stays ownership-agnostic — closes fails.md:1147): `portfolio_service.go:1352-1367`.
- `WatchlistStore` interface: `portfolio_service.go:1241-1258` (add `UpdateBindings`).
- Two-layer handler pattern to replicate: `PortfolioHandler.UpdateWatchlistBinding` `portfolio_handler.go:230-236` + `grpcPortfolioAdapter.UpdateWatchlistBinding` `:391-397` (both needed; adapter maps errors via `toGRPCError`).
- `fakeWatchlistStore.UpdateBinding` model to mirror set-wise: `watchlist_service_test.go:156-168`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Repo** — add `func (r *WatchlistRepo) UpdateBindings(ctx, watchlistID string, symbols []string, strategyID string) ([]*portfoliov1.WatchlistBinding, time.Time, error)`: one inline pgx tx running
   `UPDATE portfolio.watchlist_symbols SET strategy_id=$3 WHERE watchlist_id=$1 AND symbol = ANY($2) RETURNING symbol, strategy_id, source`, collect the returned rows, then `touchWatchlistTx` once (`:351`) for the single `updated_at` bump; commit; return the changed bindings + timestamp. Do not clear or insert rows (rebind only).
2. **Servicer** — add `UpdateWatchlistBindings` mirroring `UpdateWatchlistBinding` (`:1496`): `requireUserID` → `loadOwned` (NotFound/PermissionDenied — **AC-5**) → `deduped := normalizeSymbols(req.GetSymbols())`; if `len(deduped)==0` → `InvalidArgument`; call `s.watchlists.UpdateBindings(ctx, id, deduped, strings.TrimSpace(req.GetStrategyId()))`; **if `len(returned) != len(deduped)` → `NotFound` and the tx must have rolled back with zero writes (AC-4)** — the count comparison is against the **deduped** count (design Open Risk: a duplicate symbol must not falsely trip NOT_FOUND). `strategy_id==""` passes through as a valid bulk unbind (**AC-3**). Emit the existing `portfolio.watchlist.updated` event (as `UpdateWatchlistBinding` does at `:1518`). Return `UpdateWatchlistBindingsResponse{Bindings: returned, UpdatedAt: timestamppb.New(updatedAt)}`.
   - To keep the "zero partial writes" guarantee, perform the count check **inside** the repo tx (roll back before commit when the matched-row count ≠ requested), or return the rows and have the servicer signal rollback — implement the check where it can abort the tx (repo-side is simplest; the fake models it in Step 9).
3. **Interface + fake** — add `UpdateBindings` to `WatchlistStore` (`:1241`) and `fakeWatchlistStore` (Step 9).
4. **Handler** — add `PortfolioHandler.UpdateWatchlistBindings` (`portfolio_handler.go` after `:236`) and `grpcPortfolioAdapter.UpdateWatchlistBindings` (after `:397`), both mirroring the single-row pair verbatim (adapter routes errors through `toGRPCError`).
5. **Header propagation**: this RPC makes **no new outbound gRPC call** to another backend (it only reads/writes portfolio's own DB + the existing `emitEvent` ledger path, which already propagates). No new propagation wiring needed — confirm no `grpc.Dial`/client stub is added in this step.

**Verification**: covered by Step 9's Go test + lint run.

---

### Step 9 — test: bulk UpdateWatchlistBindings (portfolio)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify

**Reviewers**: xstockstrat-portfolio owner — atomicity + ownership + dedup-count-parity assertions.

**Codebase Evidence**:
- Mirror the single-row cases: `_AbsentSymbolNotFound` `:713`, `_NonOwnerDenied` `:732`, `_EmptyStrategyUnbinds` `:751`; seed helpers `:639`/`:647`.

**TDD**: `red-green required` — fail against the pre-Step-8 tree.

**Covers**: `AC-2, AC-3, AC-4, AC-5`

**Instructions**:
1. `TestUpdateWatchlistBindings_AssignsAcrossSelection` (**AC-2**): seed AAPL→"", MSFT→"", NVDA→"swing"; bulk-assign ["AAPL","MSFT"] → "swing" → bindings AAPL→"swing", MSFT→"swing", NVDA→"swing"; assert exactly one `updated_at` bump (the fake returns one timestamp) and the ledger emit fired once.
2. `TestUpdateWatchlistBindings_UnboundSentinelClears` (**AC-3**): seed AAPL→"swing", MSFT→"swing"; bulk-assign ["AAPL","MSFT"] → "" → both `→""`.
3. `TestUpdateWatchlistBindings_AbsentSymbolNotFoundNoPartialWrite` (**AC-4**): seed AAPL→"", MSFT→""; bulk-assign ["AAPL","GOOG"] → "swing" → `NotFound`, and AAPL remains "" (no partial write).
4. `TestUpdateWatchlistBindings_DuplicateSymbolDoesNotTripNotFound` (design Open Risk): bulk-assign ["AAPL","AAPL"] on a list containing AAPL → succeeds (count compared against the **deduped** set, not the raw request).
5. `TestUpdateWatchlistBindings_NonOwnerDenied` (**AC-5**): U2 calls for U1's list → `NotFound`/`PermissionDenied` (mirror `_NonOwnerDenied` `:732`); U1's binding unchanged.
6. `TestUpdateWatchlistBindings_EmptySymbolsRejected`: normalized-empty selection → `InvalidArgument`.
7. Implement `fakeWatchlistStore.UpdateBindings` modeling the set-based UPDATE: match `symbol = ANY(deduped)`; if the matched count ≠ requested deduped count, return an error that maps to NOT_FOUND **without mutating** any binding (models the tx rollback / zero-partial-write); otherwise rewrite `strategy_id` on the matched rows and return them + a single timestamp.

**Verification**:
```
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
New tests pass; `total:` ≥ 40% (new logic is in coverage-excluded packages — overall total must hold).

---

### Step 10 — service: UI data layer — bulk/default hooks, BFF proxy, e2e mock (`/insights`)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify
- `services/xstockstrat-ui/src/hooks/useWatchlists.ts` — modify
- `services/xstockstrat-ui/e2e/helpers/watchlistMock.ts` — modify

**Reviewers**: xstockstrat-ui owner — Connect-RPC call safety, no-whole-list-invalidate preservation.

**Codebase Evidence**:
- BFF `forward()` proxy (one line per portfolio RPC; header-propagating): `insightsBff.ts:101-109` (`updateWatchlistBinding` at `:109` is the mirror line).
- Browser typed client is generated off proto (no change needed): `insightsPortfolioClient` referenced in `useWatchlists.ts:2`.
- Hooks: `WATCHLIST_WRITE_KEY` `useWatchlists.ts:13`; `UNBOUND`/`toApiStrategyId` `:23-26`; `useCreateWatchlist` `:41`; `useUpdateWatchlist` `:59`; single-row cache-patch `useUpdateWatchlistBinding` (no invalidate — the model for the bulk hook) `:116-150`; `useInvalidatingMutation` import `:3`.
- e2e mock handlers keyed on RPC path + `MockWatchlist`/`MockBinding` types: `watchlistMock.ts:17-27`, `UpdateWatchlistBinding` handler `:118-138`, `UpdateWatchlist` handler `:78-89`, `CreateWatchlist` `:62-76`.

**TDD**: `red-green required` (paired e2e is Step 11).

**Covers**: —

**Instructions**:
1. **BFF** — add one `forward()` line in `insightsBff.ts` after `:109`:
   `updateWatchlistBindings: forward((req, opts) => portfolioClient.updateWatchlistBindings(req, opts)),`
   (reuses `forward` → `backendHeaders` propagation, C-03; no new outbound-header wiring).
2. **Hook — bulk assign** — add `useUpdateWatchlistBindings()` in `useWatchlists.ts` modeled on `useUpdateWatchlistBinding` (`:116-150`): a plain `useMutation` carrying `mutationKey: WATCHLIST_WRITE_KEY`, calling `insightsPortfolioClient.updateWatchlistBindings({ watchlistId, symbols, strategyId })`; on success **cache-patch** the changed rows into `['watchlists']` from the response `bindings` array (map each returned binding onto the matching symbol) with **no** `invalidateQueries` (preserves the AC-6 feature-167 "no whole-list invalidate" guarantee).
3. **Hook — default strategy** — extend `useCreateWatchlist` (`:41`) input with optional `defaultStrategyId` (sent on `createWatchlist`), and `useUpdateWatchlist` (`:59`) to accept an optional `updateMask?: string[]` + `defaultStrategyId`, forwarding `updateMask`/`defaultStrategyId` to `updateWatchlist`. **Existing callers must keep `updateMask` unset** so they stay on the legacy replace-all path (design Open Risk — asserted in Step 11).
4. **e2e mock** — in `watchlistMock.ts` add `defaultStrategyId?: string` to `MockWatchlist` (`:18-27`), teach the `CreateWatchlist`/`UpdateWatchlist` handlers to persist/echo it (UpdateWatchlist must honor an `updateMask` partial write for `default_strategy_id` without clearing bindings), and add an `UpdateWatchlistBindings` handler (mirror the `UpdateWatchlistBinding` handler `:118-138`) that patches `strategy_id` on every requested symbol and returns `{ bindings: <changed rows>, updatedAt: <RFC3339 string> }`.

**Verification**: `cd services/xstockstrat-ui && pnpm run lint` (type/lint clean); behavior covered by Step 11.

---

### Step 10b — service: UI multi-select, bulk action bar, and default-strategy control (`/insights`)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx` — modify

**Reviewers**: xstockstrat-ui owner — C-17 tokens/primitives/a11y, no-whole-list-invalidate preservation.

**Codebase Evidence**:
- `WatchlistDetail`: `writeInFlight` guard `:81-85`; add-form strategy `Select` pattern to reuse for the default control `:224-236`; `useStrategyDefinitions`→`allStrategies`/`liveStrategies` `:67-72`; passes props to `WatchlistReadiness` `:242-251`.
- `WatchlistReadiness`: stateless rows; `data-testid={`readiness-row-${symbol}`}` `:234`/`:288`; `BindingRowControls` `:88-142`; symbol cell `:236`/`:290`.
- New hooks from Step 10: `useUpdateWatchlistBindings`, `useUpdateWatchlist({updateMask})` in `useWatchlists.ts`.
- Selection reset is **free**: `WatchlistDetail` is remounted per watchlist via `key={selected.watchlistId}` `page.tsx:198-201` (any in-detail selection state auto-resets on switch — closes fails.md:1372, **AC-13**). Page-level guard `anyWatchlistWriteInFlight` `page.tsx:29-30`.
- `ui/checkbox.tsx` primitive **exists** (`services/xstockstrat-ui/src/components/ui/checkbox.tsx`) — reuse it (C-17, no near-duplicate).

**TDD**: `red-green required` (paired e2e is Step 11).

**Covers**: —

**Instructions**:
1. **Default-strategy control** — in `WatchlistDetail.tsx` add a watchlist-level `Select` (reuse the `:224-236` add-form Select pattern + `useStrategyDefinitions`), unique `aria-label="Default strategy for new symbols"`, firing `useUpdateWatchlist({ watchlistId, updateMask: ['default_strategy_id'], defaultStrategyId: toApiStrategyId(v) })`; show the current `watchlist.defaultStrategyId`. Use design tokens only (C-17).
2. **Multi-select + bulk bar** — lift selection state (a `Set<string>` of symbols) into `WatchlistDetail` (resets free on the `key` remount — AC-13); pass a checkbox column into `WatchlistReadiness` rows via `ui/checkbox.tsx`, each with unique `aria-label={`Select ${symbol}`}` and a "Select all symbols" header checkbox. Render a bulk action bar (shown only when the selection is non-empty) using `ui/button.tsx` + tokens: **"Remove selected"** → `useRemoveWatchlistSymbols` with the selected array (**AC-1**), and a strategy `Select` + **"Apply strategy"** → `useUpdateWatchlistBindings` (**AC-2/AC-3**). Both bulk actions must honor `writeInFlight` (`:81`) and the page-level `anyWatchlistWriteInFlight` (`page.tsx:29`); clear the selection on success.

**Verification**: `cd services/xstockstrat-ui && pnpm run lint`; behavior covered by Step 11 (Playwright
e2e). `xstockstrat-ui` has no unit-coverage threshold for this component logic (e2e-covered) — the
lint gate + the Step 11 scenario-completeness gate are the code-quality check.

---

### Step 11 — test: Playwright e2e for bulk ops + default strategy (`/insights`)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify

**Reviewers**: xstockstrat-ui owner — e2e correctness, fixture reuse (C-12).

**Codebase Evidence**:
- Spec structure + `mockWatchlists(page, seed?)` usage: `watchlists.spec.ts:3` (import), `:33` describe, per-test `await mockWatchlists(page, ...)` (e.g. `:36`, `:330` seeded system list).
- Selection-reset scenario precedent (watchlist switch): existing `:137` "inline rename + watchlist-switch resets local state".
- Test data comes from the mock + inline seeds (C-12/C-13): `MockWatchlist` seeds are the canonical shape; reuse `mockWatchlists` rather than new inline literals; auth via `e2e/helpers/auth.ts` if a login step is needed (follow existing specs).

**TDD**: `red-green required` — author the assertions to fail against the pre-Step-10 UI.

**Covers**: `AC-1, AC-2, AC-3, AC-6, AC-13`

**Instructions**:
1. **AC-1** — seed a list AAPL/MSFT/NVDA/TSLA; check the MSFT+TSLA row checkboxes; click "Remove selected"; assert the detail lists exactly AAPL and NVDA and the selection cleared (checkboxes unchecked, bulk bar hidden).
2. **AC-2** — seed bindings AAPL→"", MSFT→"", NVDA→"swing"; check AAPL+MSFT; pick "swing" in the bulk Select; click "Apply strategy"; assert all three now read "swing" (the mock patches the requested rows in one call).
3. **AC-3** — seed AAPL→"swing", MSFT→"swing"; check both; pick "Unbound"; "Apply strategy"; assert both become unbound.
4. **AC-6** — set the watchlist default via the default-strategy `Select` (fires the masked `useUpdateWatchlist`); assert the control reflects "swing" after the round-trip; **assert the outbound `UpdateWatchlist` request carries `updateMask` (and existing non-default edits do NOT)** — e.g. via a `page.route` spy on the RPC body — to close the legacy-path mask-discipline open risk.
5. **AC-13** — check two rows in one list, switch to another seeded list; assert no rows are checked in the second list and the bulk bar is hidden until a new selection is made (the `key`-remount reset).
6. Reuse `mockWatchlists`; do not add duplicate inline domain literals (C-12) — extend the seed array shape (`MockWatchlist`).

**Coverage gate (C-15 — the e2e equivalent of a numeric threshold):** `xstockstrat-ui` Playwright e2e
has no line-coverage gate by design (it is behavioral, not unit-covered). The gate for this step is
therefore **scenario completeness**: every `@AC` listed in **Covers** above (AC-1, AC-2, AC-3, AC-6,
AC-13) MUST have a named, passing spec in this file, and each spec must fail against the pre-Step-10/10b
UI (red-before-green). A missing or non-red scenario is the gate failure — this replaces the numeric
`--cov-fail-under` used by the coverage-gated services (portfolio/agent).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm test:e2e -- watchlists
```
(or `../../scripts/run-e2e.sh` for the hermetic Docker run). All five AC scenarios above pass; existing
watchlist e2e stays green.

---

### Step 12 — service: agent default_strategy_id + bulk "assign" verb

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name/params/return shape), tool-count statements unchanged (new verb, not a new tool), ownership-only `x-user-id` forwarding.

**Codebase Evidence**:
- `manage_watchlist` tool (create/update/delete dispatch): `tools.py:1416-1482`; calls `client.create_watchlist` `:1458` and `client.update_watchlist` `:1468`.
- `manage_watchlist_symbols` tool (add/remove dispatch, unknown-verb guard): `tools.py:1485-1522`; dispatch at `:1512-1520`, unknown-verb reject at `:1520`.
- `client.create_watchlist` (builds `CreateWatchlistRequest`): `client.py:387-407`.
- `client.update_watchlist` RMW merge (GetWatchlist → UpdateWatchlist, replace-all): `client.py:410-451`; request build at `:444-449`.
- `client.add_watchlist_symbols` / `remove_watchlist_symbols`: `client.py:470-501`.
- Binding builder `_watchlist_bindings_pb(symbols, bindings, source)`: `client.py:333-354`.
- Return projection `_watchlist_to_dict = MessageToDict(wl, preserving_proto_field_name=True)`: `client.py:328-330` — this **automatically echoes `default_strategy_id`** on every watchlist-returning call when non-empty (satisfies the C-14 read-surface echo open risk; assert in Step 13).
- Caller identity via `_metadata(("x-user-id", user_id))` (ownership-only, no admin scope): e.g. `client.py:406`, `:437`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **manage_watchlist default field** — add `default_strategy_id: str | None = None` to the `manage_watchlist` signature (`tools.py:1416`). On `create`, pass it through to `client.create_watchlist`. On `update`, pass it to `client.update_watchlist` **with an `update_mask`** so a default-only edit does not go through the replace-all RMW path for that field. Document the new arg in the docstring.
2. **client.create_watchlist** (`client.py:387`) — accept `default_strategy_id: str = ""` and set it on `CreateWatchlistRequest` (`:397`).
3. **client.update_watchlist** (`client.py:410`) — accept `default_strategy_id: str | None = None`; when provided, set `default_strategy_id` **and** `update_mask` (a `google.protobuf.field_mask_pb2.FieldMask(paths=[...])` covering the supplied scalar fields — at minimum `default_strategy_id`) on `UpdateWatchlistRequest` (`:444`). Keep the existing name/description/bindings RMW behavior for the **no-mask** path so an unrelated name-only edit stays byte-for-byte on the legacy path (design Open Risk — asserted in Step 13). Prefer: send a mask only when the caller is editing masked scalars; keep the current replace-all path (no mask) when only symbols/bindings/name/description are being merged, to avoid regressing feature-148 `@AC-4/@AC-5`.
4. **Bulk "assign" verb** — add an `"assign"` branch to `manage_watchlist_symbols` dispatch (`tools.py:1512`): require `watchlist_id` + a non-empty `symbols` + a `strategy_id` arg (add `strategy_id: str = ""` to the signature), call a new `client.update_watchlist_bindings(user_id, watchlist_id, symbols, strategy_id)`. Update the unknown-verb error string at `:1520` to `expected add/remove/assign` (EXTEND feature-148 `@AC-9` — `"replace"`/unknown still reject).
5. **client.update_watchlist_bindings** — add to `client.py` (mirror `add_watchlist_symbols` `:470`): build `UpdateWatchlistBindingsRequest(watchlist_id=..., symbols=..., strategy_id=...)`, call `stub.UpdateWatchlistBindings(req, metadata=_metadata(("x-user-id", user_id)))` (ownership-only forwarding), return `{"watchlist": _watchlist_to_dict(...)}` **or** the response's changed bindings — return a `get_watchlist`-shaped dict for tool consistency (re-`GetWatchlist` if the RPC returns only changed rows, or map `resp.bindings`; choose the shape the Step 13 test asserts).
6. Tool count stays **35** (a new verb, not a new tool) — do not change the "thirty-five tools" statement in the agent CLAUDE.md or the six-inventory-surface tool-count statements.

**Verification**: covered by Step 13's pytest + ruff.

---

### Step 13 — test: agent default round-trip + bulk assign

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_watchlist_tools.py` — modify
- `services/xstockstrat-agent/tests/test_watchlist_client.py` — modify

**Reviewers**: xstockstrat-agent owner — tool dispatch + client builder correctness, fixture reuse (C-13 via `tests/conftest.py`).

**Codebase Evidence**:
- Tool-dispatch test patterns (`_tool_fn(server, "manage_watchlist")`, `_ctx(TRADER)`, AsyncMock on the client): `test_watchlist_tools.py:98-151`.
- Client builder tests (fake stub, assert request fields, RMW merge): `test_watchlist_client.py:100-260` (`test_update_name_only_preserves_existing_bindings:126`, `test_update_with_symbols_replaces_the_set:163`).
- Fixtures `TRADER`, `_ctx` from `tests/conftest.py` (C-13 canonical home) — reuse, do not inline.

**TDD**: `red-green required` — fail against the pre-Step-12 tree.

**Covers**: `AC-11, AC-12`

**Instructions**:
1. **AC-11** (tool + client) — `test_manage_watchlist_update_sets_default_strategy`: `manage_watchlist(operation="update", watchlist_id=..., default_strategy_id="swing")` dispatches to `client.update_watchlist(..., default_strategy_id="swing")`; and a client-level test that the built `UpdateWatchlistRequest` carries `default_strategy_id="swing"` **and** an `update_mask` including `default_strategy_id` (masked path), while a name-only update still sends **no** mask (legacy path preserved — feature-148 `@AC-4/@AC-5` regression guard).
2. **AC-11 read echo** — `test_get_watchlist_echoes_default_strategy_id`: a `GetWatchlist` fake returning a watchlist with `default_strategy_id="swing"` → `get_watchlist` output includes `default_strategy_id: "swing"` (confirms `_watchlist_to_dict` surfaces it; C-14 read surface).
3. **AC-12** (tool + client) — `test_manage_watchlist_symbols_assign_dispatches`: `manage_watchlist_symbols(operation="assign", watchlist_id=..., symbols=["AAPL","MSFT"], strategy_id="swing")` calls `client.update_watchlist_bindings(user_id, watchlist_id, ["AAPL","MSFT"], "swing")`; and a client test that the built `UpdateWatchlistBindingsRequest` carries the symbols + strategy_id and forwards `x-user-id` only (no admin scope).
4. `test_manage_watchlist_symbols_unknown_verb_rejected` — extend the existing unknown-verb assertion: `"replace"` still rejects with `expected add/remove/assign` (EXTEND feature-148 `@AC-9`).
5. Reuse `conftest.py` fixtures; no new inline domain literals unless a scenario one-off.

**Verification**:
```
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40
```
New tests pass; coverage ≥ 40%.

---

### Step 14 — docs: mcp-tools.md parity for the new agent surface

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none (docs step).

**Codebase Evidence**:
- `manage_watchlist` reference table + verb notes: `mcp-tools.md:1065-1099`.
- `manage_watchlist_symbols` reference table + verb notes + error strings: `mcp-tools.md:1103-1125`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. In the `manage_watchlist` section (`:1065-1099`): add a `default_strategy_id` parameter row and note that `create` sets it and `update` sets it via a field-masked partial write (so a default-only update never clobbers name/description/stocks).
2. In the `manage_watchlist_symbols` section (`:1103-1125`): add the `assign` verb (with the new `strategy_id` parameter) to the `operation` cell and the verb list, describe the atomic bulk rebind (single `updated_at` bump; `NOT_FOUND` if any symbol is absent, no partial write), and update the error string to `expected add/remove/assign`.
3. Keep the tool inventory count at **35** (no new tool added).

**Verification**:
```
grep -n "default_strategy_id\|assign\|add/remove/assign" docs/runbooks/mcp-tools.md
```
Confirm the new parameter/verb/error text is present in both tool sections. This lands in the **same
PR** as Steps 12–13 (C-10 tool-doc parity).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
