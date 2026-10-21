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

## Functional Requirements

- **FR-1 (D-24).** A gRPC `StreamPortfolioUpdates` subscriber receives only snapshots whose `portfolio_id` equals its
  `x-user-id`. The owner check is applied in addition to the existing `TradingMode` filter, which is unchanged.
  Covered by `@AC-1`.
- **FR-2 (D-24).** A gRPC `StreamPortfolioUpdates` call with an empty or absent `x-user-id` fails with
  `INVALID_ARGUMENT` and is never registered as a subscriber. Covered by `@AC-2`.
- **FR-3 (D-24).** The Connect `StreamPortfolioUpdates` path applies the same isolation as FR-1 and the same
  empty-caller rejection as FR-2. Covered by `@AC-3` and `@AC-6`.
- **FR-4 (D-12).** `portfolio.snapshot.interval_minutes` stops being a dead key. Design picks exactly one branch
  (see Open Questions): either (a) the periodic writer runs for every user with positions and honours the interval,
  or (b) the key is retired from config and from portfolio docs and the dead writer is removed. Covered by `@AC-4`
  for branch (a) or `@AC-5` for branch (b). The scenario for the branch design rejects is deleted at design time.

Fill-handling semantics (`PARTIALLY_FILLED` vs `FILLED`) are unaffected. This fix changes only who receives the
snapshot that the existing post-fill path already produces.

## Consumer Surface(s)

None (internal/platform-only). `StreamPortfolioUpdates` has no UI or agent consumer wired today, and building one is
out of scope (feature-gap R-03). FR-1..FR-3 close a latent leak before any consumer exists. FR-4 changes only a
config key and a background writer, which no surface reads.

## Affected Services

- xstockstrat-portfolio (all fix sites)
- xstockstrat-config (only if design retires `portfolio.snapshot.interval_minutes`: a new config migration plus a `config-governance.md` log entry)

## Fix Scope

- [x] No proto changes anticipated
- No portfolio database migrations. Config migration depends on the FR-4 branch:
  - Branch (a), wire the writer: no migration.
  - Branch (b), retire the key: one new `xstockstrat-config` migration, `NNN_retire_portfolio_snapshot_interval.up.sql`
    plus a matching `.down.sql`. Never edit the applied `001`/`002` (F-01). The up file deletes every scope of the
    key: the `001` global seed (value 5) and the `002` production row (value 1). The down file re-inserts both. NNN is
    re-derived at spec time as the next free number. Trunk tip is `030`, and `031`/`032` are already claimed by
    in-flight features 243, 244, and 248, so the number is `033` or higher. The migration runs in the normal
    `xstockstrat-config` order via `scripts/db-migrate.sh`.
- Config key change (C-05) on either branch. Branch (a) makes `portfolio.snapshot.interval_minutes` live. Branch (b)
  retires it. Both add an entry to the `docs/patterns/config-governance.md` Per-Feature Registered Keys log and update
  portfolio `CLAUDE.md:99`.

## Open Questions

- **For design (C-11): wire or retire `portfolio.snapshot.interval_minutes` (FR-4).** Branch (a) needs a multi-user
  writer that fits the portfolio pool budget (pooled, default 2). The current `StartSnapshotWriter` takes a single
  `userID`. Branch (b) needs the config migration above. `/sdd-design` decides and deletes the losing scenario
  (`@AC-4` or `@AC-5`).

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Building a UI consumer for `StreamPortfolioUpdates` or a portfolio-history page (feature-gap R-03)
- The unpriced-skip behaviour of `broadcastSnapshot` (`:915-918`, accepted per portfolio `CLAUDE.md:33`)
