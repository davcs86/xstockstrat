# Product Spec: fix-portfolio-snapshot-surface

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-portfolio-snapshot-surface-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

- **D-24 (latent cross-tenant leak).** **Observed:** `broadcastSnapshot` (`portfolio_service.go:908-943`) sends each
  snapshot to every entry in `s.subs` (`:936-942`). It is called after every processed fill (`:376`), so the
  producer is live. Both `StreamPortfolioUpdates` paths filter only on `TradingMode`: Connect
  (`portfolio_handler.go:114-138`) and the gRPC adapter (`:291-311`). The gRPC adapter also accepts an empty
  `x-user-id`. No consumer is wired today. **Expected:** a subscriber receives only snapshots with
  `portfolio_id == x-user-id`, and an empty caller is rejected on both paths. This matches `GetSnapshot`'s own
  `portfolio_id == caller` rule (portfolio `CLAUDE.md:49-50`).
- **D-12 (dead key).** **Observed:** `StartSnapshotWriter` (`portfolio_service.go:893-906`) has zero callers.
  `portfolio.snapshot.interval_minutes` is seeded (`xstockstrat-config/migrations/001_config_tables.up.sql:68`,
  `002_config_environment.up.sql:69`) and documented (portfolio `CLAUDE.md:99`) but does nothing. Snapshots exist
  only per fill. **Expected:** either wire a multi-user periodic writer within the pool budget, or delete the
  writer and retire the key together with its docs.

## Reproduction Steps

1. D-24: open gRPC streams for `u-1` and `u-2`, then process a fill for `u-1`. `u-2`'s stream receives `portfolio_id "u-1"`.
   A stream with no `x-user-id` is accepted.
2. D-12: `grep -rn StartSnapshotWriter services/` returns the definition only. With interval 1 and no fills, no
   `portfolio.snapshots` rows are added.

## Root Cause Hypothesis

- D-24: the subscriber map carries no owner, and filtering was left to a consumer that was never built.
- D-12: the writer was scaffolded per user (its signature takes one `userID`) and never wired. Per-fill broadcasting
  hid the gap.

## Affected Services

- xstockstrat-portfolio (all fix sites)
- xstockstrat-config (only if design retires `portfolio.snapshot.interval_minutes`: a new config migration plus a `config-governance.md` log entry)

## Fix Scope

- [x] No proto changes anticipated
- [ ] No database migrations anticipated. True if D-12 is fixed by wiring the writer. Retiring the key needs a new
  `xstockstrat-config` migration (never edit applied `001`/`002`).
- [ ] No config key changes anticipated. D-12 either makes the key live or retires it. Both are config-governance changes.

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Building a UI consumer for `StreamPortfolioUpdates` or a portfolio-history page (feature-gap R-03)
- The unpriced-skip behaviour of `broadcastSnapshot` (`:915-918`, accepted per portfolio `CLAUDE.md:33`)
