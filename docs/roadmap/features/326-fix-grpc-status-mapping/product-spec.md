# Product Spec: fix-grpc-status-mapping

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-marketdata-togrpcerror-collapses-codes-defect.md, docs/reports/2026-10-19-portfolio-watchlist-duplicate-returns-internal-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10

---

## Problem Statement

### marketdata toGRPCError maps only six codes; everything else becomes INTERNAL

- **Observed**: `toGRPCError` translates only InvalidArgument, NotFound, PermissionDenied,
  FailedPrecondition, ResourceExhausted and Unavailable; every other connect code
  (`DeadlineExceeded`, `Canceled`, `AlreadyExists`, `Unimplemented`, `Unauthenticated`, `Aborted`)
  and any raw non-connect error become `codes.Internal`. The sector RPCs, `GetEtfFlags`,
  `GetHistoricalFundamentals` and `BackfillFundamentals` return service errors raw, so a caller
  deadline/cancellation reaches the caller as `INTERNAL`.
- **Expected**: the full connect→gRPC code mapping is preserved, and raw context errors map via
  `status.FromContextError`.
- Report: [docs/reports/2026-10-19-marketdata-togrpcerror-collapses-codes-defect.md](../../../reports/2026-10-19-marketdata-togrpcerror-collapses-codes-defect.md)

### CreateWatchlist returns INTERNAL on a duplicate watchlist name

- **Observed**: a second non-system watchlist with an existing name violates
  `watchlists_user_name_not_system_uidx`; `CreateWatchlist` wraps it as `connect.CodeInternal`, the
  same code a DB outage produces. No SQLSTATE 23505 classification exists in portfolio, so UI and
  agent `manage_watchlist` cannot tell a client error from a server fault.
- **Expected**: a name collision returns `ALREADY_EXISTS`.
- Report: [docs/reports/2026-10-19-portfolio-watchlist-duplicate-returns-internal-defect.md](../../../reports/2026-10-19-portfolio-watchlist-duplicate-returns-internal-defect.md)

## Reproduction Steps

1. marketdata: unit test `toGRPCError(connect.NewError(connect.CodeDeadlineExceeded, e))` → returns
   `codes.Internal`. Over gRPC: call `GetSectorHistory` with a 1ms client deadline against a cold DB;
   a handler `context.DeadlineExceeded` is reported as `INTERNAL`.
2. portfolio: `CreateWatchlist` name "A" as user U, twice → second call returns `INTERNAL`, not
   `ALREADY_EXISTS`.

## Root Cause Hypothesis

- marketdata: the switch was written for the codes the screener/fundamentals consumers needed, with a
  blanket `Internal` default instead of a generic code passthrough. Current sites:
  `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:513` (`toGRPCError`),
  `:531` (`Internal` default), `:188-190` (`GetSectorHistory` returns `err` raw).
- portfolio: neither repository nor service inspects the `pgconn.PgError` code, so every insert failure
  collapses to `Internal`. Current site:
  `services/xstockstrat-portfolio/internal/service/portfolio_service.go:2194-2196`; index in
  `services/xstockstrat-portfolio/migrations/011_watchlist_system_managed_source.up.sql:20-22`.

## Affected Services

- xstockstrat-marketdata
- xstockstrat-portfolio
- Consumer surfaces (C-14): xstockstrat-ui, xstockstrat-agent (`manage_watchlist`)

## Fix Scope

- Proto changes anticipated: **no** — only the gRPC status code returned changes; no message/field change.
- DB migrations anticipated: **no** — the unique index already exists (portfolio migration 011); the fix classifies its error.
- Config key changes anticipated: **no** — neither report touches a config key.

## Open Questions

None raised by the reports.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
