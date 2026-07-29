# Feature: fix-backfill-timeframe-enum

**Lifecycle Status**: `draft`
**Type**: bug
**Severity**: SEV-3
**Development Branch**: `feature/fix-backfill-timeframe-enum`
**Created**: 2026-07-29
**Last Updated**: 2026-07-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-29 | `idea` → `draft` | manual backlog | Observed live on the staging MCP server while verifying feature 073's deploy: every `get_backfill_status` job returns `timeframe: "1d"` alongside `timeframe_enum: "TIMEFRAME_UNSPECIFIED"`. Confirmed in source, not just in the response. |

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

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ingest` (service owner) | Backfill job read path, enum/string parity |

## Next Action

`/sdd-triage` (if a GitHub issue is opened) or `/sdd-review fix-backfill-timeframe-enum product-spec`
