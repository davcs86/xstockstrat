# Feature: fix-backfill-timeframe-enum

**Lifecycle Status**: `implementation-ready`
**Type**: bug
**Severity**: **SEV-2** (raised from SEV-3 at the round-3 design gate — two live wrong-data paths, not latent breakage; see `product-spec.md` header)
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`
**Development Branch**: `feature/fix-backfill-timeframe-enum` (this run: `claude/triage-fix-080-8k1q4h`)
**Created**: 2026-07-29
**Last Updated**: 2026-07-30

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-29 | `idea` → `draft` | manual backlog | Observed live on the staging MCP server while verifying feature 073's deploy: every `get_backfill_status` job returns `timeframe: "1d"` alongside `timeframe_enum: "TIMEFRAME_UNSPECIFIED"`. Confirmed in source, not just in the response. |
| 2026-07-29 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings, all addressed before the gate write; 0 overlap findings). First pass FAILed on FR-4 being non-testable and unchecked open questions; both resolved. Scope widened twice by user decision — `marketdata`'s `Bar` and the two UI `getBars` senders — so 080 now closes the whole deprecated-string/enum family across three services. |
| 2026-07-29 | `spec-ready` → `design-approved` | /sdd-design | Design debated (**4 rounds, full** — began as `quick`, upgraded by user decision after round 1) and approved; `recon.md` + `design.md` written. No Floor breach in any round. Every round found a producer or reader the previous one had asserted did not exist; round 3 found that the ingest **write** path persists `timeframe` raw, so FR-1 would have returned `UNSPECIFIED` for its own primary caller → **severity raised to SEV-2**, FR-13 added. Round 4 bounded the family (readers sweep, no new instance). Scope now 4 services + 1 data migration. |
| 2026-07-30 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps. Design's advisory 7-step split expanded to 8: its step 6 bundled the analysis service change with its test, which **C-08** requires as a separate paired `test` step. Two product-spec claims corrected against grep before use (**P-03**): FR-10's `"15m"`-appears-three-times count (it appears **once**, `marketdata_service.go:514`) and the `tfpkg` alias scope (`internal/service` already imports the package plainly at `:26` and needs no alias). FR-14's collision handling resolved to delete-the-alias-duplicate, and the migration gains a remediation log so its `.down.sql` is a faithful reverse rather than a no-op. |

---

## Artifacts

- [Product Spec](product-spec.md) — defect description, evidence, fix scope (FR-1–FR-14, AC-1–AC-15)
- [Recon](recon.md) — Phase 0 dossier: codebase map, patterns to reuse, 12 risks
- [Design](design.md) — the 4-round debate: chosen approach, the readers-sweep completeness proof,
  rejected alternatives, 7 open risks, Constitution rules touched
- [Context Log](context.md) — session history and every user ruling
- [Implementation Spec](implementation-spec.md) — 8 numbered steps across 4 services + 1 data migration

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
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh` | 5 |
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 6, 7 |
| `xstockstrat-ui` (service owner) | Trading UI correctness, analytics display accuracy, Connect-RPC call safety; specifically the two `getBars` senders and DRY — the string→enum map must live only in `src/lib/chart.ts` | 8 |

No `proto` step exists (both fields already ship), so the Proto Reviewer gate is not engaged.

## Next Action

`/sdd-review fix-backfill-timeframe-enum impl-spec` — validate the implementation spec, then
`/sdd-execute fix-backfill-timeframe-enum`. Ordering constraint to preserve: step 5 (the FR-14 data
migration, **DBA + service-owner** gate) must land **after** step 3, so no backfill or ingest cycle
running between them can reintroduce a row the migration just fixed.
