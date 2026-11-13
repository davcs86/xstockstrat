# Debate Register: fix-grpc-status-mapping

**State**: in-debate
**Mode**: full
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 4 | 4 | 0 | 6 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 4 | 2 | 6 | 4 | 0 | yes |
| 3 | 2026-11-13 | /sdd-batch | 5 | 2 | 4 | 5 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Translate non-Internal/non-Unknown connect codes with the generic numeric cast codes.Code(connectErr.Code()), pinned by a table test over all connect codes 1-16, in both marketdata and portfolio toGRPCError. | marketdata_handler.go:513-532 and portfolio_handler.go:443-464 switches; adversary C-18 grep shows that portfolio and marketdata emit no newly exposed code except AlreadyExists in portfolio. | settled |
| D-2 | 1 | Context mapping keys off the inbound caller ctx.Err() (toGRPCError(ctx, err)), ordered after the non-Internal cast and before the Internal default, and uses fixed text. Never use err.Error() or status.FromContextError(err). | classification_service.go:120,140,171 wrap as CodeInternal (verified); classifyGetPnLError precedent at portfolio_handler.go:427-433; vendor *url.Error apikey= exposure (@AC-5/@AC-7 f254). | settled |
| D-3 | 1 | Watchlist duplicate-name classification matches 23505 only on ConstraintName watchlists_user_name_not_system_uidx, returns ALREADY_EXISTS with fixed text, and is applied at all three name-write sites (CreateWatchlist, UpdatePartial mask path, legacy rename). | migrations/011_watchlist_system_managed_source.up.sql:20; portfolio_service.go:2194-2196, :2309-2314, :2337-2339; watchlist_repo.go:52,205,258 use %w. | settled |
| D-4 | 1 | The translators stay per-service; no shared Go package. | Root CLAUDE.md: each Go service is its own module built with GOWORK=off. | settled |
| D-5 | 2 | AC-2's Then is reworded to the server-side form (the handler returns gRPC status DEADLINE_EXCEEDED). It is proven by an adapter-level chain test, GetSectorHistory with a non-empty Symbols and an expired ctx, through the real Internal wrap. No socket-level e2e serves as the guard. | classification_service.go:151-154 empty-symbols early return and :171 Internal wrap (verified); the client-side deadline masks the server status on the wire (adversary r2). | settled |
| D-6 | 2 | Portfolio toGRPCError gets the numeric cast only, with no ctx parameter. The asymmetry with marketdata is recorded as a named follow-up in context.md, alongside fix-trading-grpc-status-mapping. | portfolio_handler.go:443-464, :427-433 GetPnL ctx-first precedent; trading.go:223-237; peer conflicts on portfolio_service.go (311/312/315/317). | settled |
| D-7 | 2 | AC-3 is pinned end to end through the existing portfolio wire harness (wireAdapter/wantCode), with a 23505 name-index error injected into the fake store, in addition to the translator-table and service-level tests. | services/xstockstrat-portfolio/internal/service/portfolio_grpc_wire_test.go:23,35 (verified); insights ~L3861 service-without-translator trap; fails.md:566. | settled |
| D-8 | 2 | Branch (b) logs no err text. At most a fixed-label error class goes into a span attribute or log. | Vendor *url.Error apikey= exposure (@AC-5/@AC-7 f254); R-4. | settled |
| D-9 | 3 | The AC-3 wire test reaches the service through a wireAdapterFor(svc *service.PortfolioService) helper extracted from wireAdapter, which then calls it. The store error is injected by one export_test.go setter, SetWatchlistCreateErr, backed by createErr/updateErr/updatePartialErr fields on fakeWatchlistStore. | portfolio_grpc_wire_test.go:23-26 (wireAdapter returns only the adapter; verified r3); export_test.go:19-24 (NewWireTestService hard-wires newFakeStore()); watchlist_service_test.go:32,82. | settled |
| D-10 | 3 | export_test.go exports WatchlistNameUniqueIdx as an alias of the unexported const. A guard test asserts that migrations/011_watchlist_system_managed_source.up.sql contains the index name. | The index name is defined only at migrations/011_watchlist_system_managed_source.up.sql:20 (down :9), verified r3. Existing alias precedent: export_test.go:35-38 (CtxWithUser/Guard). | settled |
| D-11 | 3 | The marketdata toGRPCError table carries an R-2 pin row: a live inbound ctx with connect.NewError(CodeInternal, context.DeadlineExceeded) must return INTERNAL. | R-2 (detached singleflight/batch-budget timeouts); detached budgets use context.WithoutCancel at marketdata_service.go:672,915,946. | settled |
| D-12 | 3 | The spec states that branch (c), and the blanket-Internal handler wraps, keep their err.Error() text on a live ctx, and that this is out of scope. The no-apikey= assertion runs with an expired ctx and is scoped to branch (b) only. | marketdata_handler.go:531 and handler wraps :90,:102,:114,:126,:202,:228 (adversary r3); @AC-5/@AC-7 f254. | settled |
| D-13 | 3 | The AC-2 chain test uses a minimal local 5-method classification-store stub in marketdata_handler_test.go, driving a zero-value MarketDataService plus SetClassification(stub, nil, nil). There is no package-service fallback. | classification_service.go:22-28,52 (seam), :67-72 (markClassDemand lazy init), :150-171 (store-only path); fakeClassStore at classification_service_test.go:18 is unreachable from package handler. | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | A connect-first cast followed by an errors.Is(context) branch, with no ctx parameter or wrapper awareness. | An Internal wrapper matches first, so AC-2 stays INTERNAL over gRPC and the unit test is a false green. | locked |
| R-2 | 1 | An errors.Is context check that sees through *connect.Error{Internal} without consulting the caller ctx. | It reclassifies detached singleflight/batch-budget timeouts as the caller's deadline and misleads retry logic. | locked |
| R-3 | 1 | Removing the Internal wraps at classification_service.go call sites one by one. | Per-site partial sweep that leaves other Internal-wrapping RPCs broken (fails.md:1571). | locked |
| R-4 | 1 | status.FromContextError(err) or err.Error() text for DEADLINE_EXCEEDED/CANCELLED statuses. | The whole wrapped chain can include a vendor URL carrying apikey=. | locked |
| R-5 | 2 | A socket-level e2e as the AC-2 regression guard. | The client's own propagated deadline yields DEADLINE_EXCEEDED regardless of the server status, so the test would be a false green. | locked |
| R-6 | 2 | An open-ended audit of all marketdata callers' handling of DEADLINE_EXCEEDED vs INTERNAL before execute. | It is unbounded and largely moot, because reclassification occurs only when the inbound ctx has already expired. A bounded grep for INTERNAL-specific branches on marketdata RPCs replaces it. | locked |
| R-7 | 3 | A NewWireTestServiceWithStore constructor variant to inject store errors for the AC-3 wire test. | It is a wider seam than one error injection needs. One setter export plus wireAdapterFor is smaller (C-18). | locked |
| R-8 | 3 | Moving fakeClassStore into internal/testdata so the marketdata handler package can reuse it. | It couples test files that change for unrelated reasons, and C-13 governs domain data, not doubles. A minimal local stub is the right fit. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | AC-2 is not fixed over gRPC by the connect-first branch order, because sector services wrap as CodeInternal. Adopt ctx-aware ordering, prove it with a real service-to-handler chain test, and audit the other Internal-wrapping RPCs (marketdata_service.go:1825,1838,1885,1893,2009,2249). | yes | closed @ round 2 (Adopted the D-2 ctx-aware ordering with a compile-time signature change across the 19 call sites. The AC-2 chain test goes through the real Internal wrap at classification_service.go:171, and the audit shows every listed Internal wrap is covered by branch (b) with no site edits.) |
| O-2 | 1 | UpdateWatchlist rename must cover both the UpdatePartial mask path (:2298-2314) and the legacy path (:2337-2339), or be dropped with a named follow-up. | yes | closed @ round 2 (classifyWatchlistWriteErr is applied at the UpdatePartial mask path (:2314) and the legacy rename (:2337-2339) as well as CreateWatchlist, each with a fake-store test.) |
| O-3 | 1 | Trading toGRPCError (trading.go:223-238) has the same collapse; add it to scope or record a named follow-up in context.md. | no | closed @ round 2 (Trading recorded as the named follow-up fix-trading-grpc-status-mapping in context.md.) |
| O-4 | 1 | Context-mapped messages must be fixed text, with a no-apikey=/token= assertion. | no | closed @ round 2 (Fixed-text context messages, with a test asserting no apikey=/token= when the wrapped *url.Error carries apikey=.) |
| O-5 | 1 | Only Internal, Unknown and non-connect errors may be reclassified as context errors; @AC-53 strict must stay pinned by an alive-ctx non-context test. | no | closed @ round 2 (The cast runs first for all codes except Internal/Unknown. There is an UNAVAILABLE-wrapping-deadline test and an alive-ctx plain-error INTERNAL test (@AC-53).) |
| O-6 | 1 | AC-3 needs an adapter-level codes.AlreadyExists test, plus a binding-level 23505 test proving that the ConstraintName narrowing keeps that error INTERNAL. | no | closed @ round 2 (AlreadyExists row in TestToGRPCError, plus a 23505 test on a different ConstraintName that stays INTERNAL.) |
| O-7 | 2 | AC-2's Then must be reworded server-side, and the chain test must use a non-empty Symbols. | no | closed @ round 3 (AC-2's Given and Then are reworded server-side, keeping the @AC-2 ID. The chain test uses Symbols:["AAPL"] through the Internal wrap at classification_service.go:171. The zero-value claims were verified (:67-72, :150-171).) |
| O-8 | 2 | Add one AC-3 end-to-end test through the portfolio wire harness. | no | closed @ round 3 (AC-3 wire test TestWire_CreateWatchlistDuplicateName_AC3 with a fake-store createErr and the SetWatchlistCreateErr export, asserting AlreadyExists and, on an 08006 row, INTERNAL. The remaining harness-seam fix is tracked as a new objection (wireAdapterFor).) |
| O-9 | 2 | No err.Error() logging in branch (b); fixed-label error class only. | no | closed @ round 3 (The spec states that branch (b) emits no err.Error() to any log, span or status, and a test asserts no apikey=/token= in the status message. Scoping it to branch (b) only is tracked separately.) |
| O-10 | 2 | Record the portfolio no-ctx asymmetry as a named follow-up in context.md. | no | closed @ round 3 (context.md names two follow-ups, fix-trading-grpc-status-mapping (trading.go:223-237) and fix-portfolio-grpc-ctx-mapping, each with its scope and deferral reason.) |
| O-11 | 3 | O-8 seam: wireAdapter returns only the adapter. Extract wireAdapterFor(svc) so the AC-3 wire test can inject the store error. | no | open |
| O-12 | 3 | Do not retype the name-index literal in tests. Export the WatchlistNameUniqueIdx alias and add a guard test tying it to migration 011. | no | open |
| O-13 | 3 | Add the R-2 pin row: a live ctx with CodeInternal wrapping context.DeadlineExceeded returns INTERNAL. | no | open |
| O-14 | 3 | The spec must scope the no-apikey= guarantee to branch (b) and state that branch (c) and the handler-wrap text exposure on a live ctx are unchanged and out of scope. | no | open |
| O-15 | 3 | C-14: record the UI disposition with its evidence and the user-visible message change from raw pgx text to the fixed ALREADY_EXISTS text. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
