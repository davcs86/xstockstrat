# Recon: fix-grpc-status-mapping

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: detached @ c4fd48b0a ≡ origin/main-dev (no `feature/fix-grpc-status-mapping` branch existed at recon time)
**Affected services**: xstockstrat-marketdata, xstockstrat-portfolio; consumer surfaces (C-14) xstockstrat-ui, xstockstrat-agent (`manage_watchlist`)

---

## Objective

Two Go gRPC error boundaries collapse distinct error classes into `INTERNAL`. In marketdata,
`toGRPCError` maps only six connect codes, and raw context errors from the RPCs that return service
errors raw fall to the `Internal` default. In portfolio, `CreateWatchlist` wraps a SQLSTATE 23505
duplicate-name violation as `CodeInternal`. The fix makes both boundaries classify faithfully:
the full connect→gRPC mapping, context errors mapped to DEADLINE_EXCEEDED/CANCELLED, and a duplicate
non-system watchlist name returned as ALREADY_EXISTS. Other DB failures stay INTERNAL.

## Codebase Map

- **`xstockstrat-marketdata`** (Go, gRPC 50053)
  - Translator: `toGRPCError` — `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:513`. It is a `switch connectErr.Code()` over InvalidArgument, NotFound, PermissionDenied, FailedPrecondition, ResourceExhausted and Unavailable, with the default `return status.Error(codes.Internal, err.Error())` at `:531`. The imports `errors`, `connect`, `codes` and `status` are already present (`:3-15`). `status.FromContextError` is not used anywhere in marketdata.
  - Callers: 19 `grpcMarketDataAdapter` methods call `toGRPCError` (`:316-500`).
  - **Raw-return handlers**: these return the service error unwrapped, so a raw `context.DeadlineExceeded` reaches `toGRPCError` as a non-connect error and hits the Internal default.
    - GetHistoricalFundamentals `:133-139`
    - BackfillFundamentals `:142-148`
    - GetCurrentSector `:151-157`
    - GetEtfFlags `:160-166`
    - GetSymbolServability `:169-175`
    - GetSectorAsOf `:178-184`
    - GetSectorHistory `:187-193`, which returns `err` raw at `:189-190` (the AC-2 path)
  - **Blanket-Internal handlers**: `connect.NewError(connect.CodeInternal, err)` discards the original code and any context error before `toGRPCError` runs.
    - GetBars `:90`
    - GetLatestQuote `:102`
    - GetLatestPrice `:114`
    - BackfillBars `:126`
    - GetDataCoverage `:202`
    - ListAssets `:228`
    - DeleteBackfilledData `:219`, which forwards connect-coded errors first via `errors.As` at `:215`
  - `forwardConnectErr` — `:294-300`. It forwards a `*connect.Error` unchanged and wraps everything else as Internal (`:299`). It is used by GetFundamentals, GetFundamentalsMulti, GetLatestQuotes, BatchGetBars and BatchGetLatestPrice, so a raw `context.DeadlineExceeded` from these is also wrapped as Internal.
  - Streaming methods return `grpcStream.Context().Err()` raw (`:440`, `:460`).
  - Last migration: not checked; none needed.
  - Config-read pattern: not applicable (no config key involved).
- **`xstockstrat-portfolio`** (Go, gRPC 50052)
  - Defect site: `CreateWatchlist` — `services/xstockstrat-portfolio/internal/service/portfolio_service.go:2194-2196`. `s.watchlists.Create(...)` is followed by `return nil, connect.NewError(connect.CodeInternal, err)`.
  - Repo insert: `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go:52`, `return nil, fmt.Errorf("insert watchlist: %w", err)`. It wraps with `%w`, so `errors.As(err, &*pgconn.PgError)` works from the service.
  - Index to classify: `watchlists_user_name_not_system_uidx` — `services/xstockstrat-portfolio/migrations/011_watchlist_system_managed_source.up.sql:20`.
  - Sibling index: `watchlists_user_system_uidx` (`:26`), one system list per user. It is reached by `EnsureSystemManaged` via `ON CONFLICT (user_id) WHERE system_managed DO NOTHING` (`watchlist_repo.go:70`), so it does not raise 23505 on that path.
  - **Handler translator (not in the product spec): portfolio has its own `toGRPCError`** — `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go:443`. Its switch maps InvalidArgument, NotFound, PermissionDenied, Unavailable, FailedPrecondition, DeadlineExceeded and Canceled, and every other code falls to `status.Error(codes.Internal, err.Error())`. **It has no `CodeAlreadyExists` case.** `grpcPortfolioAdapter.CreateWatchlist` (`:323-326`) routes through it, so a service-side `connect.CodeAlreadyExists` would **still reach the gRPC client as INTERNAL** unless this translator gains the case. AC-3 cannot pass from a service-only change.
  - Handler passthrough: `PortfolioHandler.CreateWatchlist` — `portfolio_handler.go:166-167`.
  - Rename path, same Internal wrap: `UpdateWatchlist` — `portfolio_service.go:2337-2339` (`s.watchlists.Update(...)` then `CodeInternal`). A rename to an existing name can hit the same index. It is outside AC-1..AC-4, so scoping it is a design question.
  - Other key symbols:
    - `classifyConsumerErr` — `portfolio_service.go:1470`, with `errors.As(err, &pgErr)` at `:1484`. It is a retry classifier, not a gRPC mapper.
    - `classifyGetPnLError` — `portfolio_handler.go:~425-441`. It is a handler-level connect-code classifier that checks `ctx.Err()` first.
  - Last migration: `018_watchlist_signal_expiry.up.sql` (`services/xstockstrat-portfolio/migrations/`). None is needed.
- **`xstockstrat-ui`** (Next.js, consumer surface)
  - Create hook: `services/xstockstrat-ui/src/hooks/useWatchlists.ts:37` (`useCreateWatchlist`). It is a passthrough with no code mapping.
  - BFF: `services/xstockstrat-ui/src/lib/insightsBff.ts:136`, `createWatchlist: forward(...)`. A downstream `ConnectError` is forwarded (`src/lib/bffShared.ts`, comment ~`:197`).
  - Render: `services/xstockstrat-ui/src/app/insights/watchlists/page.tsx:60` calls `createWl.mutate` with no `onError`, and `:119-120` renders `(createWl.error as Error).message`. A code change from INTERNAL to ALREADY_EXISTS keeps the same message path.
  - Second caller: `src/app/insights/screener/page.tsx:71`.
  - Browser transport: `src/lib/browserClients/transport.ts` reacts only to `Unauthenticated` (refresh, then login redirect).
- **`xstockstrat-agent`** (Python, consumer surface)
  - `_PASS_THROUGH_CODES` — `services/xstockstrat-agent/app/tools.py:226-237`. It already includes `ALREADY_EXISTS` (`:231`), UNAUTHENTICATED and ABORTED.
  - `_grpc_error_message` — `app/tools.py:247`. Its pass-through return is at `:273-274`, and INTERNAL and other codes outside the set are withheld at `:277-282`.
  - `manage_watchlist` — `app/tools.py:2162`. Create calls `client.create_watchlist` at `:2217`, and the `except grpc.aio.AioRpcError` mapping is at `:2242-2250`.
  - `client.create_watchlist` — `app/client.py:457-474`. It is unwrapped, so the `AioRpcError` propagates to the tool.

## Patterns to REUSE

- Full connect→gRPC mapping in marketdata → extend the existing `switch connectErr.Code()` in `toGRPCError` (`marketdata_handler.go:513`) with the six missing cases, mirroring portfolio's already-wider switch at `portfolio_handler.go:443`. A generic `codes.Code(connectErr.Code())` cast is an alternative for the debate: connect codes are numerically aligned with gRPC codes. It is not an existing repo pattern, so cite it as a proposal, not a reuse.
- Context-error mapping before the Internal default → `status.FromContextError` (product-spec expectation). The closest in-repo precedent is the ctx-first classifier `classifyGetPnLError` (`portfolio_handler.go:~428-433`).
- SQLSTATE classification → mirror the `var pgErr *pgconn.PgError` / `errors.As(err, &pgErr)` idiom in `classifyConsumerErr` (`portfolio_service.go:1470-1496`; pgconn import at `:19`). Narrow it with `pgErr.ConstraintName == "watchlists_user_name_not_system_uidx"` if design wants AC-3 precision.
- Forwarding an already-coded error → the `errors.As(err, &cErr)` idiom in `forwardConnectErr` (`marketdata_handler.go:294`) and DeleteBackfilledData (`:215`).
- Tests:
  - marketdata: `services/xstockstrat-marketdata/internal/handler/marketdata_handler_test.go` (package `handler`, stdlib `testing`, one test `TestGetLatestQuotes_EmptySymbolsRejected` at `:15`). A table test on `toGRPCError` covers AC-1 with no service. AC-2 can be a `toGRPCError(context.DeadlineExceeded)` case, because `svc` is the concrete `*service.MarketDataService` with no interface seam.
  - portfolio service: `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` provides `fakeWatchlistStore` (`:32`), whose `Create` at `:82` can inject `&pgconn.PgError{Code: "23505"}` (precedent: `portfolio_sync_retry_test.go:162`). It also has `newSvc` (`:329`) and `ctxWithUser` (`:334`), and tests assert with `connect.CodeOf(err)` (as at `:497`).
  - portfolio handler: AC-3 end to end additionally needs a `toGRPCError` case/test in `portfolio_handler_test.go`.
  - agent: `tests/test_tool_errors.py:54` already has the parametrized row `("ae", "ALREADY_EXISTS", "dup", {}, "ALREADY_EXISTS: dup")`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-53` "allow_partial opts in to returning stored bars when the live fetch fails" (`services/xstockstrat-marketdata/acceptance/offline-account-full-pnl.feature`). The strict (`false`) example pins gRPC INTERNAL "whose message carries the live-fetch error". Do NOT blanket-remap raw errors. A plain (non-connect, non-context) error stays INTERNAL with its message, and only connect codes and context errors are remapped. Design must state this explicitly.
- **PRESERVE** `@AC-54` "allow_partial budgets the live fetch from the caller's deadline" (same suite). This is partial success within a 1000 ms deadline, and context mapping must not turn it into an error.
- **PRESERVE** `@AC-14` "Partial BatchGetBars still fetches servable cold symbols within the deadline" and `@AC-12` "Strict BatchGetBars omits unservable cold symbols without a live fetch" (`services/xstockstrat-marketdata/acceptance/filter-otc-symbols.feature`).
- **PRESERVE** `@AC-5` / `@AC-7` @feature-254 "marketdata gRPC / batch Unavailable status never carries the vendor key" (`services/xstockstrat-marketdata/acceptance/fix-marketdata-secret-exposure.feature`). UNAVAILABLE stays UNAVAILABLE. Any newly passed-through code must not leak vendor-key text in its message.
- **PRESERVE** the `services/xstockstrat-marketdata/CLAUDE.md` status contract that analysis's fundamentals guard depends on: NotFound for absent, Unavailable for a Finnhub failure, FailedPrecondition for the disable flags, ResourceExhausted for the quota.
- **PRESERVE** `@AC-6` @feature-127 "EnsureSignalWatchlist is idempotent and coexists with a same-named manual list" (`services/xstockstrat-portfolio/acceptance/consolidate-watchlist-signal.feature`). The ALREADY_EXISTS classification applies only to the non-system index.
- **PRESERVE** `@AC-10` @feature-170 "CreateWatchlist applies the default to initial bare symbols" (`services/xstockstrat-portfolio/acceptance/watchlist-bulk-default-strategy.feature`). This is the success path.
- **PRESERVE** `@AC-4` / `@AC-5` @feature-170 (bulk-assign absent symbol / non-owner, NOT_FOUND) in the same suite. Also the NOT_FOUND (or PERMISSION_DENIED) scenarios in `services/xstockstrat-portfolio/acceptance/watchlist-single-strategy-update.feature`, whose tags were not captured; look them up before citing.
- **PRESERVE** `@AC-8` @feature-294 (`services/xstockstrat-portfolio/acceptance/signal-map-instrumentation.feature`). Consumer SQLSTATE 23505 handling (boundedRetry/park) is untouched, so scope the ALREADY_EXISTS mapping to the CreateWatchlist insert path rather than a global repo classifier.
- **PRESERVE** `@AC-1` / `@AC-2` / `@AC-5` / `@AC-6` @feature-303 (`services/xstockstrat-agent/acceptance/fix-agent-mcp-tools.feature`). A backend refusal reaches the MCP caller as a ToolError carrying `CODE: body`.
- **EXTEND** "manage_watchlist create makes a new list owned by the caller" @feature-148 (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`; tag number not captured). Add the duplicate-name → `ALREADY_EXISTS: <msg>` case alongside it.
- **PRESERVE** `@AC-3` / `@AC-6` @feature-148 (same suite). PERMISSION_DENIED and FAILED_PRECONDITION refusals are still surfaced.
- **PRESERVE** `@AC-21` @feature-294 (`services/xstockstrat-agent/acceptance/signal-map-instrumentation.feature`). `agent.backend.rpc_errors` is labelled with the backend's real `grpc_code`.
- **PRESERVE** `@AC-2` @feature-274 (the server duration histogram records the handler's gRPC status code; INTERNAL becoming the real code is the intended effect) and `@AC-7` @feature-127 (a system-managed watchlist cannot be deleted) — `docs/sdd/business-rules/platform.feature`.
- **PRESERVE** UI: `services/xstockstrat-ui/acceptance/fix-ui-transport-hardening.feature` (the 30 s default deadline yields DEADLINE_EXCEEDED) and `fix-ui-trader-feedback.feature` `@AC-5`/`@AC-6`/`@AC-10` @feature-270 (failed mutations are surfaced to the user).
- No CHANGE-class rule was found. No durable suite pins INTERNAL for a duplicate watchlist name, or for a deadline/cancel on the sector, ETF-flag or fundamentals-history RPCs. This feature's AC-3/AC-4 are new rules to promote at launch (C-16).

## Dependencies

- Proto/RPC: none. Only returned status codes change; no message or field change.
- Migration: none. The index already exists (portfolio `011`). The next free portfolio number would be `019`, but it is unused.
- Config keys: none.
- Inter-service edges: unchanged.
  - analysis → marketdata (fundamentals guard consumes marketdata codes)
  - ui → marketdata / portfolio
  - agent → portfolio (`manage_watchlist`)
- New env vars / ports: none.

## Risks / Not-found

- **Portfolio `toGRPCError` lacks AlreadyExists** (`portfolio_handler.go:443`, found at recon and absent from the product spec's root-cause sites). A service-only fix leaves AC-3 failing end to end. The handler translator must gain `CodeAlreadyExists`, and arguably the same full mapping as marketdata, which raises the question of whether to share one mapper across the two services. Ledger insight (`insights.md` ~L3861) already records that a new portfolio status "needs a handler classifier plus a `toGRPCError` case". The same trap exists here.
- **Blanket-Internal marketdata handlers** (`:90/:102/:114/:126/:202/:228`, `forwardConnectErr :299`) wrap context errors as Internal before `toGRPCError` sees them. Fixing `toGRPCError` alone fixes only the seven raw-return RPCs. Whether those handlers (and `forwardConnectErr`) also get context-error preservation is a scope fork for design. The product spec's Observed names only the raw-return RPCs, and AC-2 covers only GetSectorHistory.
- **@AC-53 strict INTERNAL**: a generic passthrough must keep plain live-fetch errors INTERNAL, with the message intact.
- **UI UNAUTHENTICATED behavior change**: if marketdata begins surfacing `UNAUTHENTICATED` (previously INTERNAL), the browser transport interceptor triggers a refresh and login redirect for marketdata calls (`insightsMarketDataClient`, the trader chart). This only happens where a marketdata handler actually emits `connect.CodeUnauthenticated`; no such site was searched for. Grep it before design closes.
- **Secret-exposure (@feature-254)**: newly passed-through codes carry `connectErr.Message()`. Confirm that no new path forwards vendor-key text.
- **UpdateWatchlist rename collision** (`portfolio_service.go:2337-2339`) shows the same defect but is outside the ACs, so it is a scope question.
- **23505 precision**: CreateWatchlist's insert is the only 23505 source on that path. Checking `ConstraintName` guards against misclassifying a future unique index; whether that check is used is a design choice.
- **Consumer surfaces (C-14)**: neither the UI nor the agent needs a code change for correctness. The UI shows the message text and the agent already passes through ALREADY_EXISTS. A C-14 step may be test/doc-only:
  - an agent `manage_watchlist create` ALREADY_EXISTS test
  - an optional UI e2e duplicate-name mock in `services/xstockstrat-ui/e2e/helpers/watchlistMock.ts:112`, whose connect-error JSON shape was not verified
  - an optional mention in `docs/runbooks/mcp-tools.md`
- **Shared file**: `portfolio_service.go` is shared with peer features 311/312/315/317 (sdd-review overlap WARN), so expect merge conflicts.
- Not found:
  - any `toGRPCError` unit test in either service
  - any `status.FromContextError` / `context.DeadlineExceeded` handling in the marketdata handler
  - any SQLSTATE→connect-code helper in portfolio
  - any repo-level duplicate-name test
  - any agent test for `manage_watchlist create` ALREADY_EXISTS (not confirmed in `tests/test_watchlist_tools.py`)

## Recommended Scope

Advisory, not binding:

1. **marketdata `toGRPCError`**: add the six missing connect codes, and map raw context errors (`status.FromContextError` / `errors.Is`) before the Internal default. Plain errors stay Internal. Add a table test for AC-1 and a context-error case for AC-2 in `marketdata_handler_test.go`. Separately decide whether the blanket-Internal handlers and `forwardConnectErr` preserve context errors.
2. **portfolio service**: in `CreateWatchlist`, classify `*pgconn.PgError` 23505 (optionally on `watchlists_user_name_not_system_uidx`) → `connect.CodeAlreadyExists`, else Internal. Add fake-store tests for AC-3/AC-4. Decide on UpdateWatchlist.
3. **portfolio handler `toGRPCError`**: add `CodeAlreadyExists` (and decide whether to align it with marketdata's full mapping), with a handler test so AC-3 holds over gRPC.
4. **Consumer surfaces (C-14)**: an agent test for `manage_watchlist create` → `ALREADY_EXISTS: <msg>`, plus an optional UI e2e duplicate-name case and a doc line.
