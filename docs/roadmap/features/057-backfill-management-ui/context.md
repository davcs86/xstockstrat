# Context: backfill-management-ui  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped an admin-only `/insights/backfills` page over the durable backend from features 052–054, adding two additive RPCs (`CancelBackfill`, `DeleteBackfilledData`) and a symbol filter. Cancel retains completed-chunk bars (no rollback); delete is symbol-scoped with a server-side unbounded-request reject and a UI double-confirm for whole-symbol wipes. Shipped in one squash-merged integration PR per explicit user directive, not the default per-step-PR sequential flow (feature.md:21, context.md:133-135).
**Why (irrecoverable rationale)**: Cancel's finalize-guard needed to avoid re-reading the DB row (spec's first-offered option) because that broke two pre-existing `TestRunBackfill` tests whose db mock fails `get_job` — the in-process `_canceled_jobs` registry was chosen instead as the option that didn't collide with existing mocks (context.md:176-181, implementation-spec.md:657-661).
**Rejected alternatives**:
- Step 3 finalize-guard via DB re-read — lost because it broke 2 existing `TestRunBackfill` tests (mock makes `await get_job` fail); registry check kept (implementation-spec.md:657-661).
- Relying on Step-13 E2E as the sole coverage for Step-5/6 delete logic — lost because `AskUserQuestion` put it to the user, who chose Option A (refactor for unit-testability) over accepting untested guard logic (implementation-spec.md:663-670).
**Scars & gotchas**:
- Host `buf` codegen (Docker unavailable) regenerates unrelated doc-comments in vendored `gen/ts/google/protobuf/timestamp.ts` — must be diffed and reverted before committing so stubs match CI's baseline (implementation-spec.md:651-655).
- `MarketDataService.repo` (concrete `*MarketDataRepo`) and `config.Watcher` (no exported setter) are un-mockable as written — new destructive-delete logic required extracting pure `resolveDeletePlan`/`buildDeleteBarsQuery` helpers before it could be unit-tested at all (implementation-spec.md:663-670).
- Non-CI Playwright (`pnpm dev`, 10s/test timeout) cannot complete a first hit on a brand-new route family — cold-compile of `/insights/*` + `/api/auth/me` exceeds the timeout; a full green run only happens under CI's `next build && next start` + 30s timeout + retries (implementation-spec.md:672-676).
**Permanent deviations**: none — implementation matches product-spec's resolved open questions (cancel semantics, delete scope, polling, admin gate) exactly.
**Cross-feature signal**: - Local/host `buf-gen.sh` runs (Docker down) are a recurring source of incidental base-descriptor diffs in generated TS — worth a general rule for any feature regenerating stubs outside the container.
**Deferred follow-ons**: - `marketdata.backfill.max_delete_days` ships disabled (default 0); no rollout plan recorded for enabling the guard.
**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none (the Playwright dev-mode timeout gotcha is test-infra, not a service/runtime contract — captured in fails.md instead).
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f871138.
