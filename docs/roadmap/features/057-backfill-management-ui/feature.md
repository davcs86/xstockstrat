# Feature: backfill-management-ui

**Lifecycle Status**: `idea`
**Development Branch**: `feature/backfill-management-ui`
**Created**: 2026-06-10
**Last Updated**: 2026-06-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-10 | — → `idea` | backlog capture | Feature captured in backlog; no spec yet |

---

## Artifacts

_None yet — run `/sdd-story backfill-management-ui` to generate the product spec._

---

## Summary

A dedicated `xstockstrat-ui` page for managing historical-data backfills per ticker:

- **Create** a backfill job for a ticker (symbol, timeframe, date range).
- **Monitor** job progress — status (queued/running/completed/failed) and real
  `bars_total` / progress, surfacing the durable job state added by feature
  `052-durable-observable-backfills`.
- **Cancel** an in-flight backfill job.
- **Delete** previously backfilled data for a ticker.

This is the **UI layer** on top of the launched backfill-hardening backend initiative:

- `052-durable-observable-backfills` (launched) — durable `ingest.backfill_jobs` state +
  lifecycle ledger events + real progress.
- `053-backfill-backtest-coverage` (launched).
- `054-resumable-chunked-backfills` (launched).

Backend: consumes `xstockstrat-ingest` / `xstockstrat-marketdata` gRPC APIs for backfill
job control and data deletion. Reuses the UI BFF/connect-web call chain and header
propagation.

## Open Questions (for /sdd-story)

- Which backfill control RPCs exist today (create/list/cancel)? Is there a
  delete-backfilled-data RPC, or does that need a new proto + governance gate?
- Live progress: poll the job-status RPC or stream? Confirm what `052` exposes.
- "Delete backfilled data for a ticker" — scope (full symbol vs. date range) and which
  service owns the destructive op (`xstockstrat-marketdata` OHLCV store vs.
  `xstockstrat-ingest`). Destructive data op → needs DBA/service-owner approval.

## Next Action

Run `/sdd-story backfill-management-ui` to generate a product spec, then
`/sdd-review backfill-management-ui product-spec`.
