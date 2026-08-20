# Implementation Spec: consolidate-watchlist-signal

**Status**: `pending`
**Created**: 2026-08-20
**Feature**: `docs/roadmap/features/127-consolidate-watchlist-signal/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/consolidate-watchlist-signal`

---

## Execution Summary

This feature wires `ingest_signal(direction="watchlist")` into the real portfolio watchlist across
four surfaces, following `design.md`'s Chosen Approach (system-managed watchlist identified by a
`system_managed` **flag**, not a name; the `EnsureSignalWatchlist` RPC; a `DeleteWatchlist` guard;
per-entry `source` provenance). Order is the standard proto→codegen→migration→backend→consumer chain:
**(1) proto** adds the additive `Watchlist.system_managed` (field 9), `WatchlistBinding.source`
(field 3) + `WatchlistEntrySource` enum, and the `EnsureSignalWatchlist` RPC; **(2) proto-gen**
regenerates Go/Python/TS stubs; **(3) migration 011** adds the two columns and reworks the name
constraint; **(4–5) portfolio** gains the repo/service/handler changes + tests; **(6–8) agent**
gains the best-effort post-commit auto-add side effect (mirroring the existing auto-alert), the
`PORTFOLIO_ENDPOINT` wiring, the `mcp-tools.md` doc parity, and tests; **(9–10) UI** gains the
undeletable affordance and the per-entry signal badge + e2e.

Both consumer surfaces named in the product spec's `## Consumer Surface(s)` are reached (C-14):
the **Agent** `ingest_signal` tool (steps 6/8) and the **UI** `/insights/watchlists` page (steps
9/10). No new UI page/route/nav — the existing feature-058 page is edited, so C-10(a) is already
satisfied and no `PLATFORM_SUBNAV` change is required.

### Scenario Coverage (C-15)

| `@AC-*` | Covered by step(s) |
|---|---|
| AC-1 (FR-1/FR-2 — watchlist signal adds SIGNAL-sourced entry) | Step 8 |
| AC-2 (FR-6 — non-watchlist direction, no mutation) | Step 8 |
| AC-3 (FR-4 — dedup does not re-trigger) | Step 8 |
| AC-4 (FR-3 — portfolio failure never fails ingest, WARN log) | Step 8 |
| AC-5 (FR-5 — docstring + mcp-tools.md both document the side effect) | Step 8 |
| AC-6 (FR-2/FR-7 — EnsureSignalWatchlist idempotent, coexists with same-named manual list) | Step 5 |
| AC-7 (FR-8/FR-9 — cannot delete via API or UI) | Step 5 (API half) + Step 10 (UI half) |
| AC-8 (FR-10 — signal-sourced badge, manual none) | Step 10 |

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): regenerates stubs from the edited `.proto`.
- Steps 3, 4 require Step 2: the portfolio Go code references the regenerated `system_managed`/
  `source` fields and the `EnsureSignalWatchlist` messages.
- Step 5 [test] covers Step 4 [service] (portfolio).
- Step 6 (agent) requires Step 2: `app/client.py` imports the regenerated Python portfolio stubs.
- Step 8 [test] covers Step 6 [service] **and** Step 7 [docs] — the AC-5 parity assertion reads
  BOTH the `ingest_signal` docstring (Step 6, `tools.py`) and the `mcp-tools.md` entry (Step 7), so
  Step 7 must land before Step 8's parity test can pass.
- Step 9 (UI) requires Step 2: the regenerated TS stub carries `Watchlist.systemManaged` and
  `WatchlistBinding.source`.
- Step 10 [test] covers Step 9 [service] (UI e2e), plus the AC-7 UI half.
- **Migration NNN is `011`, not `010`** — per `docs/roadmap/features/merge-order.md` (row 182):
  feature 042 (design-approved) keeps portfolio `010`; 127 renumbers to `011`. Confirmed the local
  tip is `009_bracket_order_ids` and a cross-branch `git ls-remote` scan of all origin heads shows
  no portfolio migration above `009` pushed, but the merge-order decision is authoritative — use
  `011` regardless of merge order between 042 and 127.

---

### Step 1 — proto: additive `Watchlist.system_managed`, `WatchlistBinding.source` + enum, `EnsureSignalWatchlist` RPC

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/portfolio/v1/portfolio.proto` — modify

**Reviewers**: Proto Reviewer — field-number uniqueness per message, no breaking change without deprecation, `buf lint`/`buf breaking` pass; `xstockstrat-portfolio` owner — watchlist ownership/consistency

**Codebase Evidence**:
- `WatchlistBinding` uses fields 1 (`symbol`) and 2 (`strategy_id`) → next free = **3** (`packages/proto/portfolio/v1/portfolio.proto:174-177`).
- `Watchlist` uses fields 1–8 (`bindings = 8` is the last) → next free = **9** (`portfolio.proto:180-191`).
- `PortfolioService` RPC block ends with `RemoveWatchlistSymbols` at `portfolio.proto:26`; `DeleteWatchlist` already declared at `:24`. No enum currently exists in this proto file.
- Enum-value-prefix + zero-sentinel convention (C-04): every enum value must be prefixed with the SHOUTED enum name and carry `_UNSPECIFIED = 0` (root `CLAUDE.md` § Proto Contract Governance; buf `ENUM_VALUE_PREFIX`).

**TDD**: `N/A (proto)`

**Covers**: `—`

**Instructions**:
1. In `message WatchlistBinding` (`portfolio.proto:174-177`), add field 3:
   `WatchlistEntrySource source = 3;` with a comment noting first-writer-wins under
   `ON CONFLICT DO NOTHING` (design Open Risk 2; unspecified→manual on read).
2. In `message Watchlist` (`portfolio.proto:180-191`), add field 9:
   `bool system_managed = 9;` with a comment: system-managed signals watchlist, identified by this
   flag (not by name), delete-protected (FR-7/FR-8).
3. Add the enum (place it near `WatchlistBinding`):
   ```proto
   // Provenance of a watchlist entry (feature 127). Consumers default UNSPECIFIED→MANUAL.
   enum WatchlistEntrySource {
     WATCHLIST_ENTRY_SOURCE_UNSPECIFIED = 0;
     WATCHLIST_ENTRY_SOURCE_MANUAL = 1;
     WATCHLIST_ENTRY_SOURCE_SIGNAL = 2;
   }
   ```
4. Add the RPC to `service PortfolioService` after `RemoveWatchlistSymbols` (`:26`):
   `rpc EnsureSignalWatchlist(EnsureSignalWatchlistRequest) returns (EnsureSignalWatchlistResponse);`
   with a comment: find-or-create the caller's `system_managed=true` watchlist; ownership from
   `x-user-id`, no request body (FR-2).
5. Add the messages (mirroring the "user_id intentionally absent — ownership from header" comment at
   `portfolio.proto:193-194`):
   ```proto
   message EnsureSignalWatchlistRequest {}
   message EnsureSignalWatchlistResponse {
     Watchlist watchlist = 1;
   }
   ```

**Verification**:
```
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/consolidate-watchlist-signal"
```
Both must pass (all changes additive → `buf breaking` reports no breakage).

---

### Step 2 — proto-gen: regenerate Go/Python/TS stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/portfolio/v1/**` — modify (generated)
- `packages/proto/gen/python/**` — modify (generated)
- `packages/proto/gen/ts/**` — modify (generated)

**Reviewers**: Proto Reviewer — field-number uniqueness, `buf lint`/`buf breaking` pass; `xstockstrat-portfolio` owner (inherited from Step 1)

**Codebase Evidence**:
- Codegen entry point is `./scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs — "generates TypeScript, Python, and Go stubs and compiles the TS package").
- `CI proto-freshness` job enforces an empty `git diff packages/proto/gen/` after regen (root `CLAUDE.md` § Proto Contract Governance).

**TDD**: `N/A (proto-gen)`

**Covers**: `—`

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root (uses the Docker codegen container; see
   `docs/runbooks/codegen-toolchain-host-setup.md` for the host fallback if Docker/GH-releases egress
   is blocked).
2. Stage the full regenerated tree under `packages/proto/gen/` (Go, Python, TS + compiled
   `gen/ts/dist/`). Do not hand-edit generated files.

**Verification**:
```
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
```
Exit 0 after staging = stubs reproduce byte-for-byte from the `.proto` source.

---

### Step 3 — migration: portfolio `011` — `system_managed` column, name-constraint rework, `source` column

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/migrations/011_watchlist_system_managed_source.up.sql` — create
- `services/xstockstrat-portfolio/migrations/011_watchlist_system_managed_source.down.sql` — create

**Reviewers**: DBA — NNN numbering (no gap/conflict), up+down pair present, index correctness; `xstockstrat-portfolio` owner — watchlist schema consistency

**Codebase Evidence**:
- Local tip is `009_bracket_order_ids.up.sql` (`ls services/xstockstrat-portfolio/migrations/`); `010` is claimed by feature 042 per `docs/roadmap/features/merge-order.md:182` → 127 uses **011**.
- Current watchlists table has an inline `UNIQUE (user_id, name)` constraint (`migrations/007_watchlists.up.sql:8-13`) — Postgres auto-names an inline table constraint `watchlists_user_id_name_key` (schema qualifier not part of the constraint name). Verify the exact name at execute with `\d portfolio.watchlists` if the drop fails.
- `watchlist_symbols` gained `strategy_id TEXT NOT NULL DEFAULT ''` in `migrations/008_watchlist_symbol_strategy.up.sql`; PK is `(watchlist_id, symbol)` (`007_watchlists.up.sql`).
- Design Open Risk 4: all existing `watchlists` rows are `system_managed=false` by the `DEFAULT`, so the new `WHERE NOT system_managed` unique is equivalent to the old constraint for existing data — no pre-existing violation possible on up-migration.

**TDD**: `N/A (migration)`

**Covers**: `—`

**Instructions** (`.up.sql`):
1. `ALTER TABLE portfolio.watchlists ADD COLUMN system_managed BOOLEAN NOT NULL DEFAULT false;`
2. `ALTER TABLE portfolio.watchlists DROP CONSTRAINT IF EXISTS watchlists_user_id_name_key;`
3. `CREATE UNIQUE INDEX watchlists_user_name_not_system_uidx ON portfolio.watchlists (user_id, name) WHERE NOT system_managed;`
   (the system list's name is cosmetic, so it coexists with a user's own same-named list — design round-2 name-collision fix, FR-7).
4. `CREATE UNIQUE INDEX watchlists_user_system_uidx ON portfolio.watchlists (user_id) WHERE system_managed;`
   (one system list per user, race-safe — the `ON CONFLICT (user_id) WHERE system_managed` target).
5. `ALTER TABLE portfolio.watchlist_symbols ADD COLUMN source SMALLINT NOT NULL DEFAULT 0;`
   (the `WatchlistEntrySource` enum value; `0` = unspecified→manual).

**Instructions** (`.down.sql`, reversing in inverse order):
1. `ALTER TABLE portfolio.watchlist_symbols DROP COLUMN IF EXISTS source;`
2. `DROP INDEX IF EXISTS portfolio.watchlists_user_system_uidx;`
3. `DROP INDEX IF EXISTS portfolio.watchlists_user_name_not_system_uidx;`
4. `ALTER TABLE portfolio.watchlists ADD CONSTRAINT watchlists_user_id_name_key UNIQUE (user_id, name);`
5. `ALTER TABLE portfolio.watchlists DROP COLUMN IF EXISTS system_managed;`

**Verification** (offline, no DB — per spec-template § migration verification):
```
ls services/xstockstrat-portfolio/migrations/011_*.up.sql services/xstockstrat-portfolio/migrations/011_*.down.sql
```
Then read both: confirm every `ADD COLUMN`/`CREATE INDEX`/`DROP CONSTRAINT` in `.up` has an inverse
`DROP COLUMN`/`DROP INDEX`/`ADD CONSTRAINT` in `.down`. Real apply/rollback runs in CI/deploy.

---

### Step 4 — service: portfolio repo/service/handler — `EnsureSignalWatchlist`, column plumbing, `DeleteWatchlist` guard

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L/snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `scanWatchlist` scans `watchlist_id, user_id, name, description, created_at, updated_at` (`watchlist_repo.go:278-294`); the two `SELECT` sites that feed it are `GetByID` (`:61-64`) and `ListByUser` (`:85-90`).
- `listBindings` scans `symbol, strategy_id` (`watchlist_repo.go:221-237`); `insertBindingsTx` inserts `(watchlist_id, symbol, strategy_id) … ON CONFLICT (watchlist_id, symbol) DO NOTHING` (`:266-276`).
- `Create` inserts `(user_id, name, description)` (`watchlist_repo.go:44-47`).
- Service: `requireUserID` (`portfolio_service.go:1189-1195`, `CodeInvalidArgument` on empty), `loadOwned` (`:1199-1214`), `CreateWatchlist` (`:1217`), `DeleteWatchlist` (`:1311-1326` — currently discards the `loadOwned` result: `if _, err := s.loadOwned(...)`), `AddWatchlistSymbols` (`:1329-1353`).
- Handler adapter methods wrap each service call (`portfolio_handler.go:133-183`, gRPC adapter `:270-319`); `EnsureSignalWatchlist` needs a new handler method + a new `grpcPortfolioAdapter` method mirroring `DeleteWatchlist` at `:165-172` / `:302-308`.
- A module constant for the default display name (design: "Signals") — declare as a Go `const` in `portfolio_service.go` (no config key; FR / design C-05/F-07).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. **Repo — column plumbing.** In `watchlist_repo.go`:
   - Extend the `SELECT` in `GetByID` (`:63`) and `ListByUser` (`:86`) to append `, system_managed`; extend `scanWatchlist` (`:278-294`) to scan a `bool systemManaged` into `Watchlist.SystemManaged`.
   - Extend `listBindings` (`:222-223`) `SELECT` to `symbol, strategy_id, source`; scan `int16`/`int32` into `WatchlistBinding.Source` (cast to `portfoliov1.WatchlistEntrySource`).
   - Extend `insertBindingsTx` (`:269-271`) to `INSERT ... (watchlist_id, symbol, strategy_id, source) VALUES ($1,$2,$3,$4) ON CONFLICT (watchlist_id, symbol) DO NOTHING`, passing `int16(b.GetSource())`.
2. **Repo — `EnsureSystemManaged`.** Add a new method:
   `EnsureSystemManaged(ctx, userID, defaultName string) (*portfoliov1.Watchlist, error)` that runs
   `INSERT INTO portfolio.watchlists (user_id, name, system_managed) VALUES ($1,$2,true) ON CONFLICT (user_id) WHERE system_managed DO NOTHING RETURNING watchlist_id`, and on an empty return (row already existed) `SELECT`s the existing `system_managed=true` row's id for the user — then returns `GetByID`. This is the round-2 TOCTOU-free find-or-create (design § EnsureSignalWatchlist handler).
3. **Service — `EnsureSignalWatchlist`.** Add
   `func (s *PortfolioService) EnsureSignalWatchlist(ctx, req *portfoliov1.EnsureSignalWatchlistRequest) (*portfoliov1.EnsureSignalWatchlistResponse, error)`:
   call `requireUserID(ctx)` (hard-reject empty per `:1189-1195`), then `s.watchlists.EnsureSystemManaged(ctx, userID, signalWatchlistDefaultName)`; wrap errors `CodeInternal`; return the watchlist. Add the module const `signalWatchlistDefaultName = "Signals"`.
4. **Service — `DeleteWatchlist` guard (FR-8, C-10(c)).** In `DeleteWatchlist` (`:1311-1326`), capture the currently-discarded `loadOwned` result: `wl, err := s.loadOwned(...)`; if `wl.GetSystemManaged()`, return `connect.NewError(connect.CodeFailedPrecondition, errors.New("cannot delete a system-managed watchlist"))` **before** the `Delete` call. (The caller owns it → refused on resource state, not authz.)
5. **Handler.** Add `EnsureSignalWatchlist` to `PortfolioHandler` (mirror `DeleteWatchlist` at `portfolio_handler.go:165-172`) and to `grpcPortfolioAdapter` (mirror `:302-308`), delegating to `s.svc.EnsureSignalWatchlist`.
6. `RemoveWatchlistSymbols`/`UpdateWatchlist` are left unguarded (design: "anything but delete" — an empty system list is fine, re-populated on the next signal).

**Verification**:
```
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Build + lint clean. Behavioral coverage is in Step 5.

---

### Step 5 — test: portfolio — `EnsureSignalWatchlist` idempotency + `DeleteWatchlist` guard

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service_test.go` — modify or create (co-located with existing service tests)

**Reviewers**: `xstockstrat-portfolio` owner — concurrent write safety, watchlist consistency

**Codebase Evidence**:
- Go coverage `coverpkg` **excludes** `service/`, `repository/`, and `handler/` packages (spec-template coverage command: `grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)'`). `EnsureSignalWatchlist` and the delete guard land entirely in `service/` + `repository/`, so **no coverage-threshold delta applies** — a paired test step is still required (C-08), and it must fail red first (P-06).
- Existing watchlist service tests establish the fixture/mock-repo pattern to reuse; the delete guard mirrors the C-10(c) delete-protection pattern from features 063/115 (design § Delete guard).

**TDD**: `red-green required`

**Covers**: `AC-6, AC-7`

**Instructions**:
1. **AC-6** (`EnsureSignalWatchlist` idempotent + coexists): with a fake/in-memory watchlist repo (or the existing test double), assert that two `EnsureSignalWatchlist` calls for `"user-42"` return the **same** `watchlist_id`, that exactly one `system_managed=true` row exists for the user, and that it coexists with a pre-created manual watchlist named `"Signals"` for the same user (no `UNIQUE(user_id, name)` collision — the manual list is `system_managed=false`).
2. **AC-7 (API half)** (`DeleteWatchlist` guard): given a `system_managed=true` watchlist owned by `"user-42"`, assert `DeleteWatchlist` returns `connect.CodeFailedPrecondition` and that the underlying repo `Delete` was **not** called (row still exists). Add a companion happy-path case: a non-system watchlist still deletes (guard has teeth — does not block ordinary deletes).
3. **C-13 test data:** the `user-42`/`"Signals"` literals have a single consumer (this test file) → inline is compliant; no `internal/testdata/` home needed.

**Verification**:
```
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/... -run 'EnsureSignalWatchlist|DeleteWatchlist' -race -count=1
```
Must fail before Step 4, pass after. New logic is in coverage-excluded packages (`service/`,
`repository/`) — no threshold applies; the targeted `go test` run is the verification. Lint gate
(`golangci-lint run --modules-download-mode=mod`) already satisfied by Step 4.

---

### Step 6 — service: agent — portfolio client methods, `PORTFOLIO_ENDPOINT` wiring, `ingest_signal` auto-add side effect

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify (Environment Variables list)
- `docker-compose.yml` — modify (agent block env)
- `.do/app.yaml` — modify (agent block envs)
- `.do/app.dev.yaml` — modify (agent block envs)

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name/params/return unchanged), `mcp-tools.md` parity, no secret leakage; Platform Lead — new agent→portfolio inter-service edge, dependency-graph correctness

**Codebase Evidence**:
- `ingest_signal` tool currently takes **no `ctx: Context`** — its signature starts `source: str, ...` (`app/tools.py:258-268`). The MCP-injected `ctx` precedent to copy: `emit_alert` (`:336-337`), `manage_formula` (`:645-646`) take `ctx: Context` as the first param and call `_caller_user_id(ctx, tool)` (`:109-124`).
- Existing best-effort **auto-alert** side effect to mirror: `app/tools.py:296-333` — post-commit, gated `not result.get("deduplicated")` (`:312`), wrapped `try/except → log.warning` (`:316-332`); `result` is `{"signal_id", "deduplicated"}` from `client.ingest_signal` (`:285-295`).
- `client.py` endpoint constants at `:20-26` (**no `PORTFOLIO_ENDPOINT`**); `_metadata()` returns `[]` (`:29-30`); user-scoped calls append `("x-user-id", user_id)`, e.g. `metadata=[*_metadata(), ("x-user-id", user_id)]` at `client.py:281` (run_backtest). Ephemeral-channel + lazy-stub pattern: `client.ingest_signal` (`:151-188`), `client.emit_alert` (`:191-226`).
- `_authorized` publishes verified claims on the ASGI scope (`app/main.py:146-174`); `_caller_user_id` raises `RuntimeError` only when claims carry no `user_id` (stdio-local transport) (`tools.py:119-123`).
- `PORTFOLIO_ENDPOINT` is **absent from the agent block** in all three deploy files (present only in the trading/analysis/ui blocks): docker-compose agent env block is `docker-compose.yml:519-528` (INGEST/NOTIFY/ANALYSIS/IDENTITY/INDICATORS/CONFIG only); `.do/app.yaml` agent block `:265-290` and `.do/app.dev.yaml` agent block `:269-...` likewise omit it. The value is the fixed internal endpoint `xstockstrat-portfolio:50052` (identical across all environments — Service Registry).
- **Header propagation (C-03):** the new agent→portfolio calls reuse the exact user-scoped forwarding pattern at `client.py:281`/`:485` — `[*_metadata(), ("x-user-id", user_id)]`. Portfolio resolves ownership from `x-user-id` header-side (`portfolio_service.go:1189-1195`); no `x-access-scope`/`x-trace-id` needed for these ownership-gated calls (matches every existing user-scoped agent client method).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. **`client.py` — endpoint + methods.** Add `PORTFOLIO_ENDPOINT = os.environ.get("PORTFOLIO_ENDPOINT", "xstockstrat-portfolio:50052")` beside the other constants (`:20-26`). Add two methods on the ephemeral-channel/lazy-stub pattern (lazy `from gen.portfolio.v1 import portfolio_pb2, portfolio_pb2_grpc`):
   - `ensure_signal_watchlist(user_id: str) -> str` — opens a channel to `PORTFOLIO_ENDPOINT`, calls `EnsureSignalWatchlist(EnsureSignalWatchlistRequest())` with `metadata=[*_metadata(), ("x-user-id", user_id)]`, returns `resp.watchlist.watchlist_id`.
   - `add_watchlist_symbol(user_id: str, watchlist_id: str, symbol: str) -> None` — calls `AddWatchlistSymbols(AddWatchlistSymbolsRequest(watchlist_id=..., bindings=[WatchlistBinding(symbol=symbol, strategy_id="", source=WATCHLIST_ENTRY_SOURCE_SIGNAL)]))` with the same `x-user-id` metadata.
2. **`tools.py` — `ctx` param.** Add `ctx: Context` as the **first** parameter of `ingest_signal` (`:258`), matching `emit_alert`/`manage_formula`. `ctx` is MCP-injected and excluded from the client-facing schema — a non-breaking change to the tool contract (same as those tools). Update the docstring `SIDE EFFECT:` block (`:278-284`) to also document the watchlist auto-add (FR-5): "when `direction='watchlist'` and the signal is not deduplicated, the symbol is added to your system-managed signals watchlist (best-effort; a failure is logged, never fails the ingest)."
3. **`tools.py` — second side effect.** After the existing auto-alert block (`:333`, before `return result`), add a second post-commit best-effort side effect, structurally identical to the auto-alert:
   ```python
   if direction == "watchlist" and not result.get("deduplicated"):
       try:
           user_id = _caller_user_id(ctx, "ingest_signal")
           wl_id = await client.ensure_signal_watchlist(user_id)
           await client.add_watchlist_symbol(user_id, wl_id, symbol)
       except Exception as e:
           log.warning(
               "Watchlist auto-add failed after ingest_signal (signal already ingested): %s", e
           )
   ```
   Gated on `direction == "watchlist" and not deduplicated` (FR-6/FR-4); `_caller_user_id` raising on the unauthenticated stdio transport is caught here → add skipped, signal still ingested (design fallback). Log the original gRPC error so a `UNIQUE`-collapsed `INTERNAL` is diagnosable (design § Agent).
4. **Deploy parity (C-1).** Add `PORTFOLIO_ENDPOINT: xstockstrat-portfolio:50052` to the agent `environment:` block in `docker-compose.yml` (after the CONFIG_ENDPOINT line in the agent block, ~`:524`); add the `- key: PORTFOLIO_ENDPOINT` / `value: xstockstrat-portfolio:50052` entry to the agent block `envs:` in `.do/app.yaml` (`:265-290`) and `.do/app.dev.yaml` (`:269-...`), matching the existing endpoint-key shape those blocks use.
5. **`CLAUDE.md`.** Add `PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052` to the Environment Variables block in `services/xstockstrat-agent/CLAUDE.md` (after `CONFIG_ENDPOINT`).

**Verification**:
```
grep -n "PORTFOLIO_ENDPOINT" docker-compose.yml .do/app.yaml .do/app.dev.yaml   # now present in the agent block too
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```
Endpoint present in all three deploy files' agent blocks; ruff clean. Behavioral coverage in Step 8.

---

### Step 7 — docs: `mcp-tools.md` — document the `ingest_signal` watchlist side effect (FR-5)

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: None

**Codebase Evidence**:
- `ingest_signal` reference entry is `docs/runbooks/mcp-tools.md:195-227` — the auto-alert prose is at `:197`, the `deduplicated: true` suppression note at `:227`. This is the surface the design pins to parity with the in-code docstring (`tools.py:278-284`) via the Step 8 parity test.
- Ledger `fails.md` 2026-08-02 (`mcp-tools-alignment-triage`): a hand-maintained tool doc that drifts from the code is a repeat failure on this exact tool → the parity test in Step 8 guards it.

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
1. In the `ingest_signal` entry (`mcp-tools.md:195-227`), extend the side-effect prose at `:197` (or add an adjacent sentence in the same paragraph) to document: when `direction="watchlist"` and the response is not deduplicated, the symbol is auto-added to the caller's system-managed signals watchlist (best-effort; a portfolio failure is logged and never fails the ingest). Keep the wording aligned with the `tools.py` docstring so the Step 8 parity assertion (both surfaces mention the watchlist auto-add) passes.
2. If the entry has an "error / edge cases" table row for `deduplicated: true` (`:227`), note it also suppresses the watchlist auto-add (mirrors the auto-alert suppression already stated there).

**Verification**:
```
grep -in "watchlist" docs/runbooks/mcp-tools.md | grep -i "add\|system-managed"
```
Confirms the watchlist side-effect sentence exists in the `ingest_signal` entry.

---

### Step 8 — test: agent — auto-add behavior, non-blocking, dedup/direction gates, doc parity

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_ingest_signal_watchlist.py` — create (or extend the existing `ingest_signal` test module if present)

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability + `mcp-tools.md` parity

**Codebase Evidence**:
- Agent CI coverage threshold is **40%** (`app/` measured); ruff lint runs in CI (`services/xstockstrat-agent/CLAUDE.md` § Running Tests; `.github/workflows/ci.yml` `python-lint`/`python-test`).
- The descriptor/parity-test precedent for the AC-5 doc-parity assertion is `tests/test_backtest_view.py::test_summary_key_set_covers_every_proto_field` (insights.md 2026-08-02; fails.md 2026-08-02) — assert both the docstring and `mcp-tools.md` mention the side effect.
- `client.ingest_signal`/`client.emit_alert`/`client.ensure_signal_watchlist`/`client.add_watchlist_symbol` are patch points (module-level async funcs in `app/client.py`); the existing auto-alert tests already patch `client.*` and inject `ctx` claims — reuse that harness.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5`

**Instructions**:
1. **AC-1**: call `ingest_signal` with `direction="watchlist"`, `symbol="NVDA"`, an authenticated `ctx` for `"user-42"`, and a patched `client.ingest_signal` returning `{"signal_id": 1, "deduplicated": False}`. Assert `client.ensure_signal_watchlist("user-42")` was awaited and `client.add_watchlist_symbol` was awaited with the returned `wl_id`, `symbol="NVDA"`, and a `WatchlistBinding` whose `source == WATCHLIST_ENTRY_SOURCE_SIGNAL` (assert the request the client method builds, or assert the client method's `symbol`/source args).
2. **AC-2**: `direction="buy"` → assert `client.ensure_signal_watchlist` / `client.add_watchlist_symbol` were **not** called.
3. **AC-3**: `direction="watchlist"` but patched ingest returns `{"deduplicated": True}` → assert neither watchlist client method called.
4. **AC-4**: `direction="watchlist"`, non-dedup, but `client.ensure_signal_watchlist` raises a `grpc.aio.AioRpcError` (or generic `Exception` carrying a gRPC code) → assert `ingest_signal` still returns `{"signal_id": ..., "deduplicated": False}`, no exception propagates, and a `WARNING` log line records the failure (use `caplog`, assert level `WARNING` and that the message/exception carries the original code).
5. **AC-5 (doc parity)**: read the `ingest_signal` tool docstring (via the registered tool or `inspect.getdoc`) **and** `docs/runbooks/mcp-tools.md` text; assert BOTH contain the watchlist auto-add side effect (e.g. both match a case-insensitive `watchlist` + `add`/`system-managed` phrase). This fails until Step 6 (docstring) and Step 7 (mcp-tools.md) both land.
6. **C-13 test data:** `user-42`/`NVDA` literals are single-consumer (this file) → inline compliant.

**Verification**:
```
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run pytest tests/test_ingest_signal_watchlist.py -q && uv run pytest --cov=app --cov-fail-under=40
```
Targeted tests fail before Steps 6/7, pass after; suite-wide coverage stays ≥ 40%; ruff clean.

---

### Step 9 — service: UI — undeletable affordance + per-entry signal badge on `/insights/watchlists`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, Connect-RPC call safety, no unsafe mutation affordance

**Codebase Evidence**:
- `WatchlistDetail.tsx` renders the delete affordance as an `AlertDialog` (`:187-207`) whose trigger `Button variant="destructive"` has `aria-label={`Delete ${watchlist.name}`}` (`:189`); the component receives the full `watchlist` object (used at `:189`, `:195`, `:201`).
- Per-symbol rows render in `WatchlistReadiness.tsx` (passed `bindings` from `WatchlistDetail.tsx:245-253`); it already imports `Badge` (`WatchlistReadiness.tsx:5`) and defines `type Binding = { symbol: string; strategyId: string }` (`:21`).
- The regenerated TS stub (Step 2) carries `Watchlist.systemManaged` and `WatchlistBinding.source` (Connect-JSON camelCase); these flow through `getWatchlist`/`listWatchlists` BFF forwards (`src/lib/insightsBff.ts:90-95`) unchanged (typed passthrough — no new BFF route, design § UI).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. **Undeletable (FR-9, C-10(c) UI half).** In `WatchlistDetail.tsx`, gate the delete `AlertDialog` (`:187-207`) on `!watchlist.systemManaged` — omit it (or render the trigger `Button` `disabled` with an explanatory `title`) when `watchlist.systemManaged` is true. Leave rename/add/remove affordances (`:181-186`, `:214-237`) untouched.
2. **Per-entry badge (FR-10).** In `WatchlistReadiness.tsx`, add `source?: number` to the `Binding` type (`:21`) and, in each rendered symbol row, render the existing `Badge` (imported `:5`) when `source === WATCHLIST_ENTRY_SOURCE_SIGNAL` (value `2`; use the generated enum, not a magic number). No badge for `MANUAL`/unspecified. Give the badge a stable `data-testid` (e.g. `signal-source-badge`) and accessible text (e.g. "Signal") for the e2e in Step 10.
3. The `WatchlistDetail` `watchlist` prop and `WatchlistReadiness` `bindings` already carry the new fields once the typed client is regenerated (Step 2) — no BFF/route change.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm build
```
Lint + build clean (build proves the new `systemManaged`/`source` fields resolve on the regenerated
types). Behavioral coverage in Step 10.

---

### Step 10 — test: UI e2e — undeletable system-managed list + signal-provenance badge

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify
- `services/xstockstrat-ui/e2e/helpers/watchlistMock.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, e2e fixture discipline (C-12)

**Codebase Evidence**:
- Watchlist e2e lives in `e2e/insights/watchlists.spec.ts`; the stateful mock is `e2e/helpers/watchlistMock.ts` — `MockWatchlist` (`:18-25`) and `MockBinding = { symbol: string; strategyId: string }` (`:17`), catalogued in `e2e/fixtures/INVENTORY.md:25`.
- Auth helpers: `addAuthCookie` / `addAdminCookie` / `addCookieWithRoles` (`e2e/helpers/auth.ts:51,65,70`) — specs never re-sign JWTs (C-12).

**TDD**: `red-green required`

**Covers**: `AC-7, AC-8`

**Instructions**:
1. **Fixture (C-12).** Extend `MockWatchlist` (`watchlistMock.ts:18-25`) with `systemManaged?: boolean` and `MockBinding` (`:17`) with `source?: number`; have the mock echo both fields on the CRUD responses (mirror the `sync`/`toBindings` mapping at `:42-67`). Seed one `system_managed: true` list containing an `NVDA` binding with `source: 2` (SIGNAL) and an `MSFT` binding with `source: 1` (MANUAL). Update the `INVENTORY.md:25` row to note the system-managed + source-tagged additions (C-12 catalog parity).
2. **AC-7 (UI half).** In `watchlists.spec.ts`, render the system-managed list and assert the delete affordance (`aria-label="Delete …"` / the `AlertDialog` trigger) is **hidden or disabled**, while the rename, add-symbol, and remove-symbol controls remain **enabled**.
3. **AC-8.** Assert the `NVDA` row shows the signal-provenance badge (`data-testid="signal-source-badge"` / accessible "Signal" text) and the `MSFT` row shows **no** such badge.
4. Reuse `addAuthCookie` from `e2e/helpers/auth.ts` for the session — do not inline a JWT.

**Verification**:
```
cd services/xstockstrat-ui && pnpm exec playwright test e2e/insights/watchlists.spec.ts
```
New assertions fail before Step 9, pass after. Lint gate satisfied by Step 9 (`pnpm run lint`).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
