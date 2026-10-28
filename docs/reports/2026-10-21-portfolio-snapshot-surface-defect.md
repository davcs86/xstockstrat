# Defect: Portfolio snapshot stream fans out every user's snapshot to every subscriber, and the periodic snapshot writer is never started

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: cross-tenant-data-exposure
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-portfolio
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-12 and D-24. Both were re-verified against main-dev @ a053b0e. The 2026-09-16 security audit (`docs/reports/2026-09-16-trading-system-security-audit.md:177`) noted the D-24 broadcast earlier.

## Observed

### D-24 — `StreamPortfolioUpdates` delivers every user's snapshot to every subscriber (latent security)

`broadcastSnapshot(userID, mode)` builds a `PortfolioSnapshot` with `PortfolioId: userID` and sends it to **every**
channel in `s.subs`. Both stream handlers subscribe by an opaque id and filter only on `TradingMode`, never on
`snap.PortfolioId`. The Connect handler rejects an empty user id. The gRPC adapter, which is the path internal
callers use, does not: it subscribes even with no `x-user-id`. So any `StreamPortfolioUpdates` subscriber
receives other users' equity and open-position counts.

The producer side is live: `processOrderFill` calls `broadcastSnapshot` after every processed fill. Only the
consumer side is latent, because no UI, agent or service calls `StreamPortfolioUpdates` today. The leak opens
the day a consumer is wired.

### D-12 — `StartSnapshotWriter` has zero callers, so `portfolio.snapshot.interval_minutes` is a dead key

`PortfolioService.StartSnapshotWriter` is defined, reads `portfolio.snapshot.interval_minutes` and ticks
`broadcastSnapshot`, but nothing starts it. The key is seeded by config migrations (`5` default, `1` in production)
and documented in the portfolio `CLAUDE.md`, but tuning it does nothing. Snapshots are written only as a side
effect of fills, so `GetSnapshot` history has gaps across price moves with no fills. Even if wired, its
signature takes one `userID`, so it could not serve a multi-user service as written.

## Expected

- **D-24:** A `StreamPortfolioUpdates` subscriber receives only snapshots whose `portfolio_id` equals its own
  authenticated `x-user-id`. A subscription with no user id is rejected (`INVALID_ARGUMENT` or `UNAUTHENTICATED`) on
  both the Connect and gRPC paths.
- **D-12:** Either the periodic writer runs for every user with positions at `portfolio.snapshot.interval_minutes`,
  within the pool budget, or the writer and the key are removed together and the docs no longer promise a
  periodic snapshot. Design chooses.

## Reproduction

1. **D-24:** In a portfolio handler test, open two gRPC `StreamPortfolioUpdates` streams, A with `x-user-id: u-1` and
   B with `x-user-id: u-2`. Process an `order.filled` for `u-1`. Stream B receives a snapshot with `portfolio_id: "u-1"`.
   A third stream with no `x-user-id` is accepted and receives the same snapshot.
2. **D-12:** `grep -rn StartSnapshotWriter services/` returns the definition only. Start portfolio with
   `portfolio.snapshot.interval_minutes=1`, hold a position with no fills for 5 minutes, and count rows in
   `portfolio.snapshots` for that user. None are added.

## Evidence

### D-24

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:936-942`
> s.mu.RLock()
> for _, ch := range s.subs {
> select {
> case ch <- snap:

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:376` (producer is live, called after every fill)
> s.broadcastSnapshot(ctx, fill.UserID, mode)

`services/xstockstrat-portfolio/internal/handler/portfolio_handler.go:291-307` (gRPC adapter: no empty-user guard, no `PortfolioId` filter)
> subID := fmt.Sprintf("portfolio-%s-%p", streamUserID(grpcStream.Context()), grpcStream)
> ch := a.h.svc.Subscribe(subID)
> ...
> if req.TradingMode != 0 && snap.TradingMode != req.TradingMode {

`services/xstockstrat-portfolio/internal/handler/portfolio_handler.go:114-138` (Connect: rejects empty user, but still no `PortfolioId` filter)

### D-12

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:893-906`
> // StartSnapshotWriter periodically writes portfolio snapshots to the DB.
> func (s *PortfolioService) StartSnapshotWriter(ctx context.Context, userID string, mode commonv1.TradingMode) {
> intervalMin := s.cfg.GetInt("portfolio.snapshot.interval_minutes", 5)

`services/xstockstrat-config/migrations/001_config_tables.up.sql:68`, `migrations/002_config_environment.up.sql:69`: key seeded.
`services/xstockstrat-portfolio/CLAUDE.md:99`: key documented as "How often to write portfolio snapshots".

## Root cause hypothesis

- **D-24:** The subscriber registry is a flat map with no owner. Ownership was meant to be enforced by a consumer that was never built.
- **D-12:** The writer was scaffolded per user and never wired into `main`. Per-fill broadcast later took over the
  snapshot writes, so the gap went unnoticed.

## Confidence

high
