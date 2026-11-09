# Defect: CreateWatchlist returns INTERNAL on a duplicate watchlist name

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: wrong-error-code
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-portfolio, xstockstrat-ui, xstockstrat-agent
**Config-only fix possible**: no
**Source**: `services/xstockstrat-portfolio/docs/context-constitution-findings.md` § Latent bugs, row 2

## Observed
Creating a second non-system watchlist with an existing name violates the partial unique index
`watchlists_user_name_not_system_uidx`. `CreateWatchlist` wraps that error as `connect.CodeInternal`,
the same code a DB outage produces. There is no unique-violation (SQLSTATE 23505) classification
anywhere in the portfolio service, so callers (UI, agent `manage_watchlist`) cannot tell a client
error from a server fault, and cannot branch or retry correctly.

## Expected
A name collision returns `ALREADY_EXISTS`.

## Reproduction
1. Call `CreateWatchlist` with name "A" as user U.
2. Call `CreateWatchlist` again with name "A" as user U.
3. Observe gRPC status `INTERNAL`, not `ALREADY_EXISTS`.

## Evidence
`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1577`
> wl, err := s.watchlists.Create(ctx, userID, req.GetName(), req.GetDescription(), strings.TrimSpace(req.GetDefaultStrategyId()), bindings)

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1579`
> return nil, connect.NewError(connect.CodeInternal, err)

`services/xstockstrat-portfolio/migrations/011_watchlist_system_managed_source.up.sql:20-22`
> CREATE UNIQUE INDEX watchlists_user_name_not_system_uidx
>   ON portfolio.watchlists (user_id, name)
>   WHERE NOT system_managed;

## Root cause hypothesis
Neither the repository nor the service inspects the `pgconn.PgError` code, so every insert failure
collapses to Internal. `EnsureSignalWatchlist`'s atomic find-or-create is the only race-safe path today.

## Confidence
high
