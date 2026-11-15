# Context: alert-detail-page

**Feature**: `docs/roadmap/features/344-alert-detail-page/feature.md`
**Product Spec**: `docs/roadmap/features/344-alert-detail-page/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/344-alert-detail-page/implementation-spec.md`

---

## Session 2026-11-15 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from an operator report (staging, homelab, with screenshots) and same-day read-only recon.
- Operator decisions (2026-11-15): a **dedicated page** per alert (not an expandable row), showing severity, category, source service, time, full body, context fields and correlation ID. Operator's original report: "there's no single view or page to see all the details for an alert/notification".
- Scope folded in by routing agreed with the operator: readable error text for backfill-failure alerts (FR-7).
- Proposed by me, unconfirmed: FR-5 auto mark-read; the URL shape `/accounts/notifications/<alert_id>`.
- Recon facts: notify proto has no get-by-id RPC (`notify.proto:14-39`); `Alert` fields at `:42-58`; inbox at `src/app/accounts/notifications/AlertInbox.tsx`; drawer at `src/components/trader/AlertStream.tsx`; body built at ingest `servicer.py:519-544` from `str(e)` (`:574-593`).
