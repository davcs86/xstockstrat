# Feature: fix-backfill-timeframe-enum

**Lifecycle Status**: `launched`
**Committed to main**: 3b437fd2dce0e243249bdb4b64edd8ad9a029562
**Launched date**: 2026-07-30
**Type**: bug
**Severity**: **SEV-2** (raised from SEV-3 at the round-3 design gate — two live wrong-data paths, not latent breakage; see `product-spec.md` header)
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`
**Development Branch**: `feature/fix-backfill-timeframe-enum`

> Every step PR targets **`feature/fix-backfill-timeframe-enum`** (**F-03** — never `main-dev`, never a
> `claude/*` branch). The SDD *artifacts* for this feature were authored on the harness branch
> `claude/triage-fix-080-8k1q4h` and merged to `main-dev` directly (docs only, no service code); that
> branch is **not** a step-PR target. Disambiguated at the `/sdd-review impl-spec` gate — the previous
> inline parenthetical read as if it were an alternative development branch.
**Created**: 2026-07-29
**Last Updated**: 2026-07-30

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-29 | `idea` → `draft` | manual backlog | Observed live on the staging MCP server while verifying feature 073's deploy: every `get_backfill_status` job returns `timeframe: "1d"` alongside `timeframe_enum: "TIMEFRAME_UNSPECIFIED"`. Confirmed in source, not just in the response. |
| 2026-07-29 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings, all addressed before the gate write; 0 overlap findings). First pass FAILed on FR-4 being non-testable and unchecked open questions; both resolved. Scope widened twice by user decision — `marketdata`'s `Bar` and the two UI `getBars` senders — so 080 now closes the whole deprecated-string/enum family across three services. |
| 2026-07-29 | `spec-ready` → `design-approved` | /sdd-design | Design debated (**4 rounds, full** — began as `quick`, upgraded by user decision after round 1) and approved; `recon.md` + `design.md` written. No Floor breach in any round. Every round found a producer or reader the previous one had asserted did not exist; round 3 found that the ingest **write** path persists `timeframe` raw, so FR-1 would have returned `UNSPECIFIED` for its own primary caller → **severity raised to SEV-2**, FR-13 added. Round 4 bounded the family (readers sweep, no new instance). Scope now 4 services + 1 data migration. |
| 2026-07-30 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done — ingest write path canonicalizes before persisting (FR-13, the round-3 defect), read path derives `timeframe_enum` (FR-1), dead column read deleted (FR-4), three context files re-resolved. Red→green recorded: 7 assertions failed first, including `assert '' == '15m'` on the enum-only request; 141 passed after, coverage 75%. |
| 2026-07-30 | `implementation-ready` (unchanged) | /sdd-review impl-spec ×2 | Reviewed twice, **treated as blocking by user direction** (Mode B is advisory by default, and does not move the lifecycle). Round 1: FAIL — 4 blockers, 12 warnings; all fixed. Round 2: FAIL — 4 blockers, and it caught that **two of round 1's own fixes were not executable** (`source.Source` does not exist; the Playwright request-capture could not work across the globalSetup/worker process boundary). Both replaced with verified mechanisms. **Step 5 marked `blocked`** — unverifiable without a database; consequence recorded: the feature cannot reach `code-completed`, so `/promote` will not harvest it, while the execute loop's ALL-DONE path would still open the integration PR. |
| 2026-07-30 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps. Design's advisory 7-step split expanded to 8: its step 6 bundled the analysis service change with its test, which **C-08** requires as a separate paired `test` step. Two product-spec claims corrected against grep before use (**P-03**): FR-10's `"15m"`-appears-three-times count (it appears **once**, `marketdata_service.go:514`) and the `tfpkg` alias scope (`internal/service` already imports the package plainly at `:26` and needs no alias). FR-14's collision handling resolved to delete-the-alias-duplicate, and the migration gains a remediation log so its `.down.sql` is a faithful reverse rather than a no-op. |
| 2026-07-30 | `in-progress` (unchanged) | /sdd-execute (user-directed correction) | **Step 5's `blocked` status retracted, migration authored and marked `done`.** The user challenged the premise: "previous migrations neither had a timescaledb instance." Checked rather than reasserted — confirmed no CI workflow in this repo ever executes a migration, and found direct precedent (`008-signal-source-registry` step 3, `done` on the identical review-based verification). The bar applied to step 5 didn't exist anywhere else in the repo's practice. Wrote both `.sql` files for real (delete-the-alias-duplicate + `WHERE NOT EXISTS` twin re-check + remediation log, per the design), staged the two doc files, verified by SQL review against the DDL facts, marked `done`. DBA + service-owner sign-off remains required before the migration runs anywhere shared — unchanged, was never in question. |
| 2026-07-30 | `in-progress` → `code-completed` | /sdd-execute | Steps 3–8 completed under the standing instruction "do all the remaining steps then create a PR" — marketdata service+test (`TimeframeEnum` at all four `Bar` sites, FR-10/FR-11 resolve paths, 5 doc surfaces), analysis service+test (live loop's third `GetBars` producer aligned with its two already-migrated siblings), and ui (`chart.ts`'s `TIMEFRAME_ENUM` map, both `getBars` senders, e2e mock + 3 producers). All 8 steps `done`, each red-before-green and committed as its own step commit on `claude/impl-080-timeframe-enum` (one deviation: step 8's request-capture e2e test uses a UI interaction instead of a `page.reload()` race that proved non-deterministic in this environment — recorded in `implementation-spec.md`'s Deviation Log). `/context-scrubber` was unavailable in-session for step 3's doc-surface teardown; substituted a full manual citation re-verification, noted for the PR body. Ready for the integration PR into `main-dev` (single-PR model, see `context.md` § Deviation from the spec's PR model). |

| 2026-07-30 | `code-completed` → `launched` | CI workflow | Promoted via PR #825; committed 3b437fd2dce0e243249bdb4b64edd8ad9a029562 |
---

## Artifacts

- [Product Spec](product-spec.md) — defect description, evidence, fix scope (FR-1–FR-14, AC-1–AC-15)
- [Recon](recon.md) — Phase 0 dossier: codebase map, patterns to reuse, 12 risks
- [Design](design.md) — the 4-round debate: chosen approach, the readers-sweep completeness proof,
  rejected alternatives, 7 open risks, Constitution rules touched
- [Context Log](context.md) — session history and every user ruling
- [Implementation Spec](implementation-spec.md) — 8 numbered steps across 4 services + 1 data migration.

---

## Summary

`ingest`'s `job_row_to_proto` populates only the **deprecated** `timeframe` string on every
`BackfillJob` it returns and never sets `timeframe_enum`, so `GetBackfillStatus` and
`ListBackfillJobs` always report `TIMEFRAME_UNSPECIFIED`.

The proto marks `timeframe` `[deprecated = true]` with "Removed in a future release once all callers
migrate" — so the read path fills the field being deleted and leaves its replacement empty. This is
latent today (consumers still read the string) and becomes data loss the moment the deprecated field
is dropped.

Scope widened 2026-07-29 by two user decisions, so the defect family is closed in one pass rather
than rediscovered later:

- `xstockstrat-marketdata`'s `Bar` has the identical producer-side gap at all four construction
  sites, on a hotter read path (charts, indicators, backtests).
- The two UI `getBars` senders populate only the deprecated string — the same scheduled break on the
  *request* side, which would blank both charts.

## Reviewers

Canonical snapshot written by `/sdd-spec` from `docs/runbooks/reviewer-registry.md` — the distinct
`**Reviewers**` values across all 8 steps. Stable unless `/sdd-spec` re-runs.

| Role | Review Focus | Steps |
|---|---|---|
| `xstockstrat-ingest` (service owner) | Signal normalization correctness, idempotent ingestion, newsletter source schema stability; specifically the backfill job read path and enum/string parity | 1, 2 |
| `xstockstrat-marketdata` (service owner) | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency; specifically the four `Bar` producer sites and the `TIMEFRAME_1MIN` labelling call for streamed bars (product-spec FR-6) | 3, 4, 5 |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh`; plus the new permanent `marketdata.ohlcv_remediation_003` table (retention; it holds copies of deleted market-data rows), the delete-the-alias-duplicate collision policy, and the quiesce + compression pre-flights — **sign-off still required before this migration runs anywhere shared** | 5 |
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 6, 7 |
| `xstockstrat-ui` (service owner) | Trading UI correctness, analytics display accuracy, Connect-RPC call safety; specifically the two `getBars` senders and DRY — the string→enum map must live only in `src/lib/chart.ts` | 8 |

No `proto` step exists (both fields already ship), so the Proto Reviewer gate is not engaged.

## Next Action

> **Step 5's `blocked` status was retracted (user-directed correction).** It had been marked
> `blocked` on the reasoning that a migration must be executed in the authoring session to satisfy
> **F-05**. That reasoning didn't hold up: no CI job in this repo ever executes a migration, and
> feature `008-signal-source-registry` step 3 is `done` on the identical review-based verification.
> Step 5 is now `done`, verified by SQL review against step 3's DDL facts — the migration still
> needs the **DBA + service-owner** sign-off in **Reviewers** before it runs anywhere shared, which
> was always the actual gate. See step 5's "Corrected" note for the full record.

All 8 steps are `done`. Open the integration PR from `claude/impl-080-timeframe-enum` into `main-dev`
(single-PR model — see `context.md` § Deviation from the spec's PR model), calling out in the PR body:
step 5's migration still needs **DBA + service-owner** sign-off before it runs anywhere shared (it was
never executed in this session — verified by SQL review only, per the corrected step-5 bar); and
`/context-scrubber` was unavailable in-session for step 3's doc-surface teardown, substituted with a
full manual citation re-verification. `/sdd-review … impl-spec` ran **twice** pre-implementation (both
FAIL, all findings fixed).
