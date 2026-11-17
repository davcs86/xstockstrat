# Context Log: fix-portfolio-signal-expiry-backfill

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-17 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-17-portfolio-signal-expiry-backfill-mark-ingest-race-defect.md` (PR #1570; Issues disabled).
- Severity: SEV-3, confirmed by the operator at the `/sdd-qa defect` P-04 gate (lowered from the initially proposed rating).
- Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md.
- Affected services (from report): xstockstrat-portfolio.
- Root cause hypothesis: the backfill APPLY mark (`backfillMarkSQL`) runs as a READ COMMITTED autocommit statement without the parent watchlist row lock. The add path's update-only `mergeSignalExpirySQL` is a no-op when it runs before the mark row commits, so a due `signal_id NULL` row survives next to a live signal. The same shape is suspected, not observed, for `backfillSeedSQL`.
- Recommended design depth: skip → `/sdd-spec fix-portfolio-signal-expiry-backfill` (rubric: SEV-3, single service, no proto/migration/config, clear root cause).
- **Operator directive (2026-11-17), overrides the rubric:** run this fix through the `/sdd-batch` workflow, which always runs the full design debate. The design gate is `halt` (operator approves design.md), then `/sdd-batch-execute` (sequential) after the operator's mode-entry confirmation.
- Development branch: feature/fix-portfolio-signal-expiry-backfill.

## Session 2026-11-17 — sdd-review product-spec

- Product spec approved (PASS WITH WARNINGS). Status: draft → spec-ready.
- Warnings:
  - Criterion 9 (Open Questions): the items were plain bullets. Resolved here by converting them to unchecked `- [ ]` boxes. All remain deferred to `/sdd-design`, and design must resolve each one. If the seed-path race is confirmed, add FR-2 and an append-only `@AC-2`.
  - Criterion 8 (C-15): `@AC-1` "runs concurrently" is intermittent on the buggy code. Design must supply a forced-interleaving hook so the regression fails deterministically before the fix.
  - Criterion 8 wording: Given/When use only "META" and a relative "valid_until 30 days ahead". Both are acceptable; a reviewer may want the REPORT bounds stated.
  - Criterion 11 (C-14): "None — internal/platform-only" is justified. Minor clarity gap: the spec does not say whether `portfolio.watchlist.signal_entry_removed_untracked` is the only operator-visible signal.
  - Runbook §7 "changed since REPORT" wording (`docs/runbooks/signal-watchlist-expiry-backfill.md:152-153`): whether it needs an update is deferred to design/spec.
- Overlap findings (WARN, no FAIL):
  - [file] `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go`: this feature's likely fix sites (`mergeSignalExpirySQL` `:293`, `applyExpiryIntentTx` `:545-576`) vs feature 354 `ListByUser` (`:107-141`). Disjoint regions, rebase-only. If design moves the fix into `ListByUser` or the constructor, add a soft merge-order row (354 first, 359 rebases).
  - [file] `services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go`: 354 adds `seedNamedWatchlist` and turns `seedWatchlist` into a delegate. Collides only if 359 edits this helper file. Conditional, low risk.
  - No config-key, proto field-number or migration collision. No merge-order entry required now.
- Recommended design depth: full (operator directive; the rubric would give quick for a single-service SEV-3 bug with no proto/DB/config gates).

### OPERATOR DECISIONS (binding, recorded 2026-11-17)

- Operator directive 2026-11-17: run through /sdd-batch with a full design debate (overrides the triage rubric's 'skip'); the design gate halts for operator approval.
- Severity is SEV-3 (operator-confirmed at the /sdd-qa P-04 gate); production exposure is limited to a one-shot backfill APPLY overlapping signal ingest.
- Fix the race without weakening or skipping TestBackfill_IngestRaceNeverLeavesEntryRemovable; it is the regression guard for @AC-1.
