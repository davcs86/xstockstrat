# Implementation Spec: watchlist-management

**Status**: `pending`
**Created**: 2026-06-27
**Feature**: `docs/roadmap/features/058-watchlist-management/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/watchlist-management`

---

## Execution Summary

Watchlists are owned by `xstockstrat-portfolio`. The contract comes first: add the `Watchlist`
message and 7 additive CRUD RPCs to `PortfolioService` (Step 1), regenerate stubs (Step 2). Then
the schema (Step 3 migration) and the config defaults (Step 4 migration in `xstockstrat-config`).
Step 5 builds the repository + service + handler logic in portfolio; Step 6 tests it (gRPC + auth +
caps). Steps 7–8 wire the `xstockstrat-ui` insights segment (BFF handlers reuse the existing
`PortfolioService` server client, a new `/insights/api`-bound browser client, hooks, and the new
page). Step 9 is the Playwright E2E. Step 10 updates docs (service CLAUDE.md defaults + root config
table). Order is dictated by codegen-then-consume and migration-then-code dependencies.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the new RPCs/messages.
- Step 5 (portfolio service) requires Step 2 (generated Go stubs) and Step 3 (tables exist).
- Step 5 reads config keys, so it requires Step 4 (config defaults seeded) for the defaults to be honored at runtime; the `GetInt(key, default)` fallback means Step 5 compiles/tests independently, but Step 4 must land for production defaults.
- Step 6 (portfolio test) covers Step 5 (portfolio service).
- Step 7 (UI BFF + browser client) requires Step 2 (generated TS stubs expose the new PortfolioService RPCs).
- Step 8 (UI page + hooks) requires Step 7 (browser client + BFF handlers).
- Step 9 (Playwright E2E) covers Steps 7–8.
- Step 10 (docs) requires Step 1 + Step 4 (the proto + config keys must be final).

---

### Step 1 — proto: Add Watchlist message and 7 CRUD RPCs to PortfolioService

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/portfolio/v1/portfolio.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, additive (non-breaking) RPCs/messages, `buf lint`/`buf breaking` pass; `xstockstrat-portfolio` (service owner) — `user_id` ownership shape; `xstockstrat-ui` (service owner) — RPC shape consumed by the insights BFF

**Codebase Evidence**:
- Service name + existing RPCs: `PortfolioService` at `packages/proto/portfolio/v1/portfolio.proto:10`, RPCs at `:11-17`.
- Imports already present (no new imports needed): `google/protobuf/timestamp.proto` and `common/v1/common.proto` at `portfolio.proto:7-8`; timestamps use `google.protobuf.Timestamp` (e.g. `:29`, `:43`).
- Pagination already used in this file: `ListPositionsRequest.page` (`:98`) and `ListPositionsResponse.page` (`:108`), qualified as `xstockstrat.common.v1.PageRequest` / `PageResponse`.
- `common.v1.PageRequest{page_size, page_token}` / `PageResponse{next_page_token, total_count}` confirmed at `packages/proto/common/v1/common.proto:10-18`.
- New messages get fresh field numbers starting at 1 — no collision with existing messages (highest existing in-message field is `Position` field 13 at `:53`).

**Instructions**:
Add to `PortfolioService` (additive — append new RPCs after the existing block at `:17`):
- `rpc CreateWatchlist(CreateWatchlistRequest) returns (CreateWatchlistResponse);`
- `rpc GetWatchlist(GetWatchlistRequest) returns (GetWatchlistResponse);`
- `rpc ListWatchlists(ListWatchlistsRequest) returns (ListWatchlistsResponse);`
- `rpc UpdateWatchlist(UpdateWatchlistRequest) returns (UpdateWatchlistResponse);`
- `rpc DeleteWatchlist(DeleteWatchlistRequest) returns (DeleteWatchlistResponse);`
- `rpc AddWatchlistSymbols(AddWatchlistSymbolsRequest) returns (AddWatchlistSymbolsResponse);`
- `rpc RemoveWatchlistSymbols(RemoveWatchlistSymbolsRequest) returns (RemoveWatchlistSymbolsResponse);`

Add a `Watchlist` message (FR-1, product-spec L65-67):
```proto
message Watchlist {
  string watchlist_id = 1;
  string user_id = 2;
  string name = 3;
  string description = 4;
  repeated string symbols = 5;
  google.protobuf.Timestamp created_at = 6;
  google.protobuf.Timestamp updated_at = 7;
}
```
Add request/response messages. Do **not** put `user_id` in request messages — it is taken from the
propagated `x-user-id` header server-side (FR-2), not the wire:
- `CreateWatchlistRequest { string name = 1; string description = 2; repeated string symbols = 3; }` / `CreateWatchlistResponse { Watchlist watchlist = 1; }`
- `GetWatchlistRequest { string watchlist_id = 1; }` / `GetWatchlistResponse { Watchlist watchlist = 1; }`
- `ListWatchlistsRequest { xstockstrat.common.v1.PageRequest page = 1; }` / `ListWatchlistsResponse { repeated Watchlist watchlists = 1; xstockstrat.common.v1.PageResponse page = 2; }`
- `UpdateWatchlistRequest { string watchlist_id = 1; string name = 2; string description = 3; repeated string symbols = 4; }` (replace semantics for name/description/symbols per FR-1) / `UpdateWatchlistResponse { Watchlist watchlist = 1; }`
- `DeleteWatchlistRequest { string watchlist_id = 1; }` / `DeleteWatchlistResponse {}`
- `AddWatchlistSymbolsRequest { string watchlist_id = 1; repeated string symbols = 2; }` / `AddWatchlistSymbolsResponse { Watchlist watchlist = 1; }`
- `RemoveWatchlistSymbolsRequest { string watchlist_id = 1; repeated string symbols = 2; }` / `RemoveWatchlistSymbolsResponse { Watchlist watchlist = 1; }`

Mirror the qualified pagination reference style already used at `portfolio.proto:98`.

**Verification**:
`cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/watchlist-management"` — both pass (all changes additive: new messages + new RPCs).

---

### Step 2 — proto-gen: Regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/portfolio/v1/` — modify (generated)
- `packages/proto/gen/python/portfolio/v1/` — modify (generated)
- `packages/proto/gen/ts/portfolio/v1/` — modify (generated, incl. compiled `dist/`)

**Reviewers**: Proto Reviewer — field number uniqueness, additive (non-breaking) RPCs/messages, `buf lint`/`buf breaking` pass (inherited from Step 1)

**Codebase Evidence**:
- Codegen script: `./scripts/buf-gen.sh` (root CLAUDE.md § Generating Proto Stubs — generates Go, Python, Connect-ES browser, grpc-js TS, Python grpc and compiles the TS package).
- Generated output dirs: `packages/proto/gen/{go,python,ts}/` (root CLAUDE.md § Key File Paths).

**Instructions**:
Run `./scripts/buf-gen.sh` from repo root. Commit the proto source (Step 1) and the regenerated
stubs together in the same commit (per `docs/runbooks/proto-versioning.md` § PR1). Do not hand-edit
generated files.

**Verification**:
`./scripts/buf-gen.sh && git status --porcelain packages/proto/gen` — shows regenerated stubs;
the new `CreateWatchlist`/`ListWatchlists`/etc. methods appear in the generated Go
`PortfolioServiceServer` interface and the TS `PortfolioService` definition. CI `proto-freshness`
job must be clean (re-running buf-gen produces no diff).

---

### Step 3 — migration: Create watchlists tables (portfolio)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/migrations/007_watchlists.up.sql` — create
- `services/xstockstrat-portfolio/migrations/007_watchlists.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, ownership scoping, index correctness; `xstockstrat-portfolio` (service owner) — P&L/position tables untouched, `user_id` ownership convention

**Codebase Evidence**:
- Confirmed last migration is `006_positions_day_pnl` (`.up.sql`+`.down.sql`); files run `000`–`006`. Next free number = **007** (discovery digest; root CLAUDE.md migration naming `NNN_description.up.sql`).
- Schema style to mirror — `services/xstockstrat-portfolio/migrations/001_portfolio_hypertable.up.sql:7-17`: `CREATE TABLE IF NOT EXISTS portfolio.positions ( position_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id TEXT NOT NULL, ... )` — confirms `portfolio` schema, `gen_random_uuid()` PK, `user_id TEXT NOT NULL`, `IF NOT EXISTS`.
- Watchlists are deliberately NOT mode-scoped (omit `trading_mode`, unlike positions at `internal/repository/portfolio_repo.go:40`) — product-spec L50, Resolved Decision OQ-058-a.

**Instructions**:
Create `007_watchlists.up.sql` (per product-spec L77-84):
```sql
CREATE TABLE IF NOT EXISTS portfolio.watchlists (
  watchlist_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS portfolio.watchlist_symbols (
  watchlist_id UUID NOT NULL REFERENCES portfolio.watchlists (watchlist_id) ON DELETE CASCADE,
  symbol       TEXT NOT NULL,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (watchlist_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_watchlists_user ON portfolio.watchlists (user_id);
```
Create `007_watchlists.down.sql` (reverse order; CASCADE on the symbols FK handles child rows, but
drop child table first for clarity):
```sql
DROP INDEX IF EXISTS portfolio.idx_watchlists_user;
DROP TABLE IF EXISTS portfolio.watchlist_symbols;
DROP TABLE IF EXISTS portfolio.watchlists;
```
No hypertable (watchlists are not time-series). No `trading_mode` / `account_id` column (mode-agnostic).
No new DB pool — reuses portfolio's existing `pgxpool` (connection budget unchanged at 2).

**Verification**:
`./scripts/db-migrate.sh` applies `007` cleanly; then `migrate down` one step drops both tables and
the index without error (acceptance criterion 4). Verify both tables exist in the `portfolio` schema
after `up` and are gone after `down`.

---

### Step 4 — migration: Seed portfolio.watchlist.* config defaults (config)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/006_watchlist_config.up.sql` — create
- `services/xstockstrat-config/migrations/006_watchlist_config.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair; `xstockstrat-config` (service owner) — `portfolio.watchlist.*` key naming (`<service>.<category>.<key>`) / scoping

**Codebase Evidence**:
- Config defaults live ONLY as SQL seed migrations into `config.config_values`; no in-code default map exists (discovery digest).
- Last config migration = `005_ingest_backfill_chunking`; next = **006** (discovery digest).
- INSERT template with env/mode twins — `services/xstockstrat-config/migrations/005_ingest_backfill_chunking.up.sql:5-26`: `('ingest', 'backfill.chunk_max_bars', 'int', '200000', '...', '200000', 'xstockstrat-ingest', 'dev', 'all'),` + a `'production','all'` twin, ending `ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;`.
- Column split: `namespace`='portfolio', `key`='watchlist.max_per_user' (the `<category>.<key>` part); `value_data`/`default_value` are TEXT even for int (`'5'`) — `001_config_tables.up.sql:68`.
- Conflict target `(namespace, key, environment, trading_mode)` — `002_config_environment.up.sql` unique constraint.

**Instructions**:
Create `006_watchlist_config.up.sql` seeding 4 rows (2 keys × dev/production), mirroring the `005`
shape. Both keys: namespace `portfolio`, value_type `int`, consuming_service `xstockstrat-portfolio`,
trading_mode `all`:
- `('portfolio', 'watchlist.max_per_user', 'int', '50', 'Max watchlists a single user may own', '50', 'xstockstrat-portfolio', 'dev', 'all')` + `'production','all'` twin
- `('portfolio', 'watchlist.max_symbols_per_list', 'int', '500', 'Max symbols allowed in one watchlist', '500', 'xstockstrat-portfolio', 'dev', 'all')` + `'production','all'` twin
- End with `ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;`

Create `006_watchlist_config.down.sql` deleting exactly those rows:
```sql
DELETE FROM config.config_values
 WHERE namespace = 'portfolio'
   AND key IN ('watchlist.max_per_user', 'watchlist.max_symbols_per_list');
```

**Verification**:
`./scripts/db-migrate.sh` applies `006`; query `config.config_values` shows the 4 rows
(`SELECT namespace, key, value_data, environment FROM config.config_values WHERE key LIKE 'watchlist.%';`).
`migrate down` removes them. (Config-rollout runbook note: existing deployments pick the new keys up
on the next `WatchConfig` reload; portfolio's `GetInt` fallback covers the pre-seed window.)

---

### Step 5 — service: Watchlist repository + service + handler (portfolio)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go` — create
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (add watchlist methods + wire repo)
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify (add RPC methods to both `PortfolioHandler` and `grpcPortfolioAdapter`)
- (No `docker-compose.yml` / `.do/app.*.yaml` changes — `CONFIG_ENDPOINT` + `LEDGER_ENDPOINT` already present for portfolio at `docker-compose.yml:389-392`, `.do/app.dev.yaml:89,91`; no new env var or port introduced.)

**Reviewers**: `xstockstrat-portfolio` (service owner) — P&L/position tables untouched, concurrent write safety, `user_id` ownership enforcement via propagated `x-user-id`

**Codebase Evidence**:
- Handler is a Connect handler + gRPC adapter; a new RPC needs a method on **both** `PortfolioHandler` (`internal/handler/portfolio_handler.go:21`) and `grpcPortfolioAdapter` (`:133`). RPC signature example: `func (h *PortfolioHandler) ListPositions(ctx context.Context, req *connect.Request[portfoliov1.ListPositionsRequest]) (*connect.Response[portfoliov1.ListPositionsResponse], error)` at `:56`.
- x-user-id read: `userID := middleware.FromContext(ctx).UserID` at `internal/service/portfolio_service.go:859`; extraction from `md.Get("x-user-id")` at `internal/middleware/propagation.go:28-33`.
- Config read: `s.cfg.GetInt("portfolio.snapshot.interval_minutes", 5)` at `internal/service/portfolio_service.go:531`; typed getters `GetInt/GetFloat/GetString/GetBool(key, default)` at `internal/config/config.go:102`.
- Ledger emission: `s.emitEvent(ctx, "portfolio.position.closed", "portfolio:"+fill.UserID, map[string]interface{}{...})` at `internal/service/portfolio_service.go:221`; helper at `:627-666` (builds `AppendEventRequest{SourceService:"portfolio", IdempotencyKey: uuid}`, 4-attempt backoff on `codes.Unavailable`; ledger failure is logged, non-fatal — matches FR-6).
- Repo pattern: `type PortfolioRepo struct { pool *pgxpool.Pool }` at `internal/repository/portfolio_repo.go:19-21`; pool is **unexported** with **no `Pool()` accessor**. Upsert/`ON CONFLICT` example at `:36-44`; keyset pagination at `:65-147`.
- Error mapping: handler returns `connect.NewError(connect.CodeInvalidArgument, ...)` (`portfolio_handler.go:34`); adapter maps to `status.Error(codes.NotFound, ...)` at `:212-223`. **`PermissionDenied` is not yet used anywhere** — this feature introduces the first `connect.CodePermissionDenied` path; add the mapping in the adapter's `toGRPCError` (the `switch` at `:212-223`).
- Positions are mode-scoped (`ON CONFLICT (user_id, symbol, trading_mode, account_id)` at `internal/repository/portfolio_repo.go:40`); watchlist queries must filter by `user_id` only (no `trading_mode`).

**Instructions**:
1. **Repo** (`watchlist_repo.go`): Because the pool is unexported and there is no `Pool()` accessor, add a `Pool() *pgxpool.Pool` accessor on `PortfolioRepo` (or construct `WatchlistRepo` in the same package and read the unexported field directly). Create `WatchlistRepo` with methods: `Create`, `GetByID`, `ListByUser` (keyset-paginated, filtered by `user_id`, mirroring `portfolio_repo.go:65-147`), `Update` (rename/description + replace symbols in a tx: delete-all then insert), `Delete` (relies on `ON DELETE CASCADE`), `AddSymbols`, `RemoveSymbols`, plus `CountByUser` and a per-list `CountSymbols` for cap enforcement. Symbols stored **uppercased and de-duplicated** (FR-3) — uppercase + dedupe in Go before insert, and use `INSERT ... ON CONFLICT (watchlist_id, symbol) DO NOTHING`. Every read/mutate query includes `AND user_id = $N` so a user can only touch their own rows.
2. **Service** (`portfolio_service.go`): add `CreateWatchlist`/`GetWatchlist`/`ListWatchlists`/`UpdateWatchlist`/`DeleteWatchlist`/`AddWatchlistSymbols`/`RemoveWatchlistSymbols`. Each reads `userID := middleware.FromContext(ctx).UserID` (`:859` pattern); reject empty `userID` with `InvalidArgument`. **Ownership (FR-2)**: on Get/Update/Delete/Add/Remove, if the watchlist's `user_id != userID` return `PermissionDenied` (proven by acceptance criterion 2). **Caps (FR-3/FR-7)**: read `maxPerUser := s.cfg.GetInt("portfolio.watchlist.max_per_user", 50)` and `maxSymbols := s.cfg.GetInt("portfolio.watchlist.max_symbols_per_list", 500)` (mirror `:531`); on create, if `CountByUser >= maxPerUser` → `InvalidArgument`; on create/update/add, if resulting symbol count `> maxSymbols` → `InvalidArgument`. Re-read the cap from config on every mutation so lowering it is honored next mutation (acceptance criterion 3). **Ledger (FR-6)**: emit `s.emitEvent(ctx, "portfolio.watchlist.created", "watchlist:"+watchlistID, {...})` on create, `.updated` on update/add/remove, `.deleted` on delete — mirroring `:221`; ledger failure stays non-fatal.
3. **Handler** (`portfolio_handler.go`): add the 7 RPC methods to `PortfolioHandler` (Connect signatures like `:56`) delegating to the service, and the matching 7 methods to `grpcPortfolioAdapter` (`:133`). Extend `toGRPCError` (`:212-223`) to map `connect.CodePermissionDenied → status.Error(codes.PermissionDenied, ...)`.
- **Header propagation**: this step adds no new *outbound* gRPC call beyond the existing `emitEvent` ledger client, which already runs through the established propagation path (`internal/middleware/propagation.go`); no new client/interceptor is introduced. The inbound `x-user-id` is read via `middleware.FromContext` as above.

**Verification**:
`cd services/xstockstrat-portfolio && GOWORK=off go build ./...` compiles. Lint: `cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod`. (Behavioral coverage in Step 6.)

---

### Step 6 — test: Portfolio watchlist RPC tests

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — create (or extend an existing service test file in the package)

**Reviewers**: `xstockstrat-portfolio` (service owner) — concurrent write safety, `user_id` ownership enforcement

**Codebase Evidence**:
- Service business logic (caps, ownership, ledger) lives in `internal/service/portfolio_service.go` — measurable package. Existing config getter `GetInt` (`internal/config/config.go:102`) lets tests inject caps via a fake/stub config watcher.
- Go coverage excludes `cmd/`, `handler/`, `repository/`, `telemetry/`, `service/` packages from the CI `-coverpkg` measurement (see threshold table). The watchlist business rules (uppercase/dedupe, cap checks, ownership) should be placed so they are testable; if a pure helper (e.g. `normalizeSymbols`, cap-check) is extracted into a non-excluded package, it is measured. Otherwise note the exclusion below.

**Instructions**:
Cover the acceptance criteria with table/unit tests against the service layer (stub the repo and a
fake config watcher returning chosen caps):
- AC-1: `CreateWatchlist` → `GetWatchlist` round-trips; symbols stored uppercased + de-duped (pass `["aapl","AAPL","msft"]`, expect `["AAPL","MSFT"]`).
- AC-2: two different `x-user-id`s — user B getting/updating/deleting user A's list returns `PermissionDenied`.
- AC-3: exceeding `max_symbols_per_list` → `InvalidArgument`; exceeding `max_per_user` → `InvalidArgument`; lowering the config cap is honored on the next mutation (mutate config stub between calls).
- Ledger failure is non-fatal: a failing ledger stub does not fail the mutation (FR-6).

If the cap/normalize/ownership logic stays inside the CI-excluded `service/` package, add this note in
the test step: "New logic is in an excluded package (`service/`) — no coverage threshold applies to
it; these unit tests plus the Step 9 E2E provide behavioral verification." A `test` step is still
required and present.

**Verification**:
`cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"` — confirm ≥ 40% (or, if all new logic is in excluded packages, confirm the suite passes and the threshold is unaffected). Also run lint: `cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod`.

---

### Step 7 — service: Insights BFF watchlist handlers + browser client (UI)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify (add watchlist handler methods to the existing `PortfolioService` router block)
- `services/xstockstrat-ui/src/lib/browserClients/insightsPortfolioClient.ts` — create (`/insights/api`-bound PortfolioService client)
- (No env-var/port changes — `PORTFOLIO_ENDPOINT` already set for `xstockstrat-ui`: `docker-compose.yml:457`, `.do/app.yaml:423-424`, `.do/app.dev.yaml:423-424`; server-side `portfolioClient` already exists at `src/lib/connectClients.ts:32`.)

**Reviewers**: `xstockstrat-ui` (service owner) — BFF Connect-RPC call safety, header propagation, no secrets rendered

**Codebase Evidence**:
- Insights BFF already registers `PortfolioService` (currently only `listPortfolios`): `router.service(PortfolioService, { async listPortfolios(req, ctx) { ... return portfolioClient.listPortfolios(req, { headers: backendHeaders(claims, ctx) }); } });` at `src/lib/insightsBff.ts:7,143-148` — adding watchlist RPCs needs only new handler methods here, no new transport.
- Header forwarding already implemented: `'x-user-id': claims.user_id, 'x-access-scope': String(rolesToAccessScope(claims.roles)), 'x-trace-id': ctx.requestHeader.get('x-trace-id') ?? generateTraceId()` at `src/lib/insightsBff.ts:32-38`; `requireSession` JWT verify at `:24-30`.
- Handler-map basePath gotcha: `const PREFIX = '/insights/api';` (`:205`) and `new Map(router.handlers.map((h) => [PREFIX + h.requestPath, h]))` (`:203-206`) — new RPCs auto-register via the same router, no manual map edit needed.
- Browser client template (`/insights/api`-bound): `const transport = createConnectTransport({ baseUrl: '/insights/api' }); export const analysisClient = createClient(AnalysisService, transport);` at `src/lib/browserClients/analysisClient.ts:5-6`. The existing `portfolioClient.ts:5` is bound to `/trader/api` — so a NEW insights-scoped client is required.
- Server-side backend `portfolioClient` already available to the BFF: `src/lib/connectClients.ts:32` (created via `createGrpcTransport` on `PORTFOLIO_ENDPOINT`, default `xstockstrat-portfolio:50052` at `:16`).

**Instructions**:
1. In `src/lib/insightsBff.ts`, inside the existing `router.service(PortfolioService, { ... })` block
   (at `:143`), add async handlers for `createWatchlist`, `getWatchlist`, `listWatchlists`,
   `updateWatchlist`, `deleteWatchlist`, `addWatchlistSymbols`, `removeWatchlistSymbols`, each
   delegating to the server-side `portfolioClient.<method>(req, { headers: backendHeaders(claims, ctx) })`
   exactly like `listPortfolios` at `:143-148` (this reuses the existing header-propagating call path —
   `x-user-id`/`x-access-scope`/`x-trace-id` forwarded via `backendHeaders` at `:32-38`).
2. Create `src/lib/browserClients/insightsPortfolioClient.ts` mirroring `analysisClient.ts:5-6`:
   `createConnectTransport({ baseUrl: '/insights/api' })` + `createClient(PortfolioService, transport)`,
   exported as `insightsPortfolioClient`. (Do not reuse the `/trader/api` `portfolioClient`.)

**Verification**:
Lint: `cd services/xstockstrat-ui && pnpm run lint`. Confirm header propagation is preserved by
grep: `grep -n "x-user-id\|x-access-scope\|x-trace-id\|backendHeaders" services/xstockstrat-ui/src/lib/insightsBff.ts` — the new handlers reuse `backendHeaders` (no separate header plumbing). (E2E behavior in Step 9.)

---

### Step 8 — service: Insights Watchlists page + React-Query hooks (UI)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/watchlists/page.tsx` — create
- `services/xstockstrat-ui/src/hooks/useWatchlists.ts` — create (query + mutation hooks)

**Reviewers**: `xstockstrat-ui` (service owner) — UI correctness, no secret values rendered, Connect-RPC call safety

**Codebase Evidence**:
- Page template: `'use client'` at `src/app/insights/strategies/page.tsx:1`; hook usage `const { data, isLoading, error } = useStrategies();` (`:30`) and `const manage = useManageStrategy();` (`:36`); mutation call `manage.mutate({ ... });` (`:49`).
- React-Query provider already wraps all insights routes: `src/app/insights/providers.tsx:8-11` (`QueryClientProvider` + `createQueryClient()`) — no provider wiring needed for the new page.
- Query hook template: `useQuery({ queryKey: ['analysis-strategies'], queryFn: () => analysisClient.listStrategies({ page: { pageSize: 50 } }), refetchInterval: 30_000 })` at `src/hooks/useStrategies.ts:12-14`.
- Mutation + cache invalidation template: `src/hooks/useStrategyDefinitions.ts:34-48` (`useMutation` + `qc.invalidateQueries`).

**Instructions**:
1. Create `src/hooks/useWatchlists.ts`: a `useWatchlists()` query hook (`queryKey: ['watchlists']`,
   `queryFn: () => insightsPortfolioClient.listWatchlists({ page: { pageSize: 50 } })`, mirroring
   `useStrategies.ts:12-14`) and mutation hooks `useCreateWatchlist`, `useUpdateWatchlist`,
   `useDeleteWatchlist`, `useAddWatchlistSymbols`, `useRemoveWatchlistSymbols` (each `useMutation`
   calling the corresponding `insightsPortfolioClient` method, with `qc.invalidateQueries({ queryKey: ['watchlists'] })`
   on success — mirror `useStrategyDefinitions.ts:34-48`). Import `insightsPortfolioClient` from Step 7.
2. Create `src/app/insights/watchlists/page.tsx` with `'use client'` (mirror
   `strategies/page.tsx:1`): list watchlists, create/rename/delete a list, and add/remove symbols,
   wiring the Step-1 hooks. Use the same AppShell/layout primitives the strategies page uses. Render
   no secret values (FR-5). The page lives under the existing insights `layout.tsx`/`providers.tsx`
   so React-Query context is already present.

**Verification**:
Lint: `cd services/xstockstrat-ui && pnpm run lint`. `cd services/xstockstrat-ui && pnpm run build`
compiles the new route. (E2E in Step 9.)

---

### Step 9 — test: Playwright E2E for the Watchlists page

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — create

**Reviewers**: `xstockstrat-ui` (service owner) — Playwright E2E correctness, header propagation

**Codebase Evidence**:
- E2E template (insights, browser-level mock keyed by gRPC service path): `await page.route('**/xstockstrat.portfolio.v1.PortfolioService/ListPortfolios', async (route) => { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ portfolios: MOCK_PORTFOLIOS }) }); });` at `e2e/insights/account-portfolio.spec.ts:15-28`.
- Auth cookie helper: `e2e/helpers/auth.ts` (`addAuthCookie`); JWT-with-roles at `e2e/insights/strategy-authoring.spec.ts:22-33`.
- Mock backend + config: `e2e/mock-backend.ts`, `e2e/global-setup.ts`; ports/env wiring `playwright.config.ts:60-92` (uses `*_ENDPOINT`, e.g. `PORTFOLIO_ENDPOINT: '127.0.0.1:9091'` at `:74-75`).

**Instructions**:
Create `e2e/insights/watchlists.spec.ts` mirroring `account-portfolio.spec.ts:15-28`: set the auth
cookie via `addAuthCookie`, then `page.route(...)`-mock the new PortfolioService watchlist RPC paths
(`**/xstockstrat.portfolio.v1.PortfolioService/ListWatchlists`, `/CreateWatchlist`,
`/AddWatchlistSymbols`, `/RemoveWatchlistSymbols`, `/DeleteWatchlist`) with JSON fixtures. Drive
acceptance criterion 5: navigate to `/insights/watchlists`, create a list, add two symbols, remove
one, delete the list — asserting the UI reflects each step.

**Verification**:
`cd services/xstockstrat-ui && pnpm test:e2e` (or the insights-scoped Playwright project) — the new
spec passes. No coverage threshold applies to Next.js (E2E covers behavior).

---

### Step 10 — docs: Config defaults in portfolio CLAUDE.md + root config table

**Status**: `pending`
**Service**: `docs` / `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (add `portfolio.watchlist.*` defaults to the Config Keys section)
- `CLAUDE.md` (root) — modify (add a "Recently added keys (feature 058 …)" row to § Config Governance Rules)

**Reviewers**: none

**Codebase Evidence**:
- Portfolio CLAUDE.md documents consumed config keys (namespace `portfolio`) at `services/xstockstrat-portfolio/CLAUDE.md:36-45` — defaults are declared per-service per root CLAUDE.md § Config Governance Rules.
- Root CLAUDE.md § Config Governance Rules carries a per-feature "Recently added keys" table (e.g. the feature 057 / Alpaca-audit blocks) — the convention to append to.

**Instructions**:
- In `services/xstockstrat-portfolio/CLAUDE.md` (config keys section near `:36-45`), add:
  `portfolio.watchlist.max_per_user` (int, default `50`) and `portfolio.watchlist.max_symbols_per_list`
  (int, default `500`), each with a one-line description matching Step 4.
- In root `CLAUDE.md` § Config Governance Rules, append a new block:
  `Recently added keys (feature 058 — watchlist management, owned by xstockstrat-portfolio):` with a
  2-row table for the two keys, matching the existing block format.

**Verification**:
`grep -n "watchlist.max_per_user\|watchlist.max_symbols_per_list" CLAUDE.md services/xstockstrat-portfolio/CLAUDE.md`
— both keys present in both files. Values match Step 4's seeded defaults (50 / 500).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
