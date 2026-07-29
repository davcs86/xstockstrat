# Feature: fix-backfill-timeframe-enum

**Lifecycle Status**: `spec-ready`
**Type**: bug
**Severity**: SEV-3
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`
**Development Branch**: `feature/fix-backfill-timeframe-enum` (this run: `claude/triage-fix-080-8k1q4h`)
**Created**: 2026-07-29
**Last Updated**: 2026-07-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-29 | `idea` → `draft` | manual backlog | Observed live on the staging MCP server while verifying feature 073's deploy: every `get_backfill_status` job returns `timeframe: "1d"` alongside `timeframe_enum: "TIMEFRAME_UNSPECIFIED"`. Confirmed in source, not just in the response. |
| 2026-07-29 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings, all addressed before the gate write; 0 overlap findings). First pass FAILed on FR-4 being non-testable and unchecked open questions; both resolved. Scope widened twice by user decision — `marketdata`'s `Bar` and the two UI `getBars` senders — so 080 now closes the whole deprecated-string/enum family across three services. |

---

## Artifacts

- [Product Spec](product-spec.md) — defect description, evidence, fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated_
- [Context Log](context.md) — session history

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

| Role | Review Focus |
|---|---|
| `xstockstrat-ingest` (service owner) | Backfill job read path, enum/string parity |
| `xstockstrat-marketdata` (service owner) | `Bar` producer sites (DB read, Alpaca REST, live stream); the `TIMEFRAME_1MIN` labelling call for streamed bars (product-spec FR-6) |
| `xstockstrat-ui` (service owner) | The two `getBars` senders; DRY — the string→enum map must live only in `src/lib/chart.ts` |

## Next Action

`/sdd-design fix-backfill-timeframe-enum quick` — one adversarial round, with product-spec FR-6
(labelling streamed 1-minute bars `TIMEFRAME_1MIN`, a deprecated enum member) as the designated
challenge point.
