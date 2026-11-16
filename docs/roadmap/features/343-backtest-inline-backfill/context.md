# Context: backtest-inline-backfill

**Feature**: `docs/roadmap/features/343-backtest-inline-backfill/feature.md`
**Product Spec**: `docs/roadmap/features/343-backtest-inline-backfill/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/343-backtest-inline-backfill/implementation-spec.md`

---

## Session 2026-11-15 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from an operator report (staging, homelab, with screenshots) and same-day read-only recon.
- Operator decisions (2026-11-15): backfill the **missing range only**; after completion show a **re-run action** (no automatic re-run); **try to open the action to everyone**; if that requires a lot of changes, **replace the section with strategy scores only, default "not enough data", no actions at all**.
- Interpretation (mine): "Yes to the rerun action" answered a recommendation of inline progress + a "data ready, re-run" state over automatic re-run; read as accepting that. "The section" in the fallback is read as the Backtests card on the symbol page; confirm in design.
- @AC-7 and @AC-8 are mutually exclusive — design picks FR-6 or FR-7 and the losing scenario is struck, not renumbered.
- Recon facts: `page.tsx:1226-1240` (insufficient-data callout), `:1405-1415` (panel trigger: no range, BARS, 1Day, admin-only UI), `hooks/useBacktest.ts:19-23` (`useTriggerBackfill`), `insightsBff.ts:86-88` (BFF `forward`, no admin gate), ingest `servicer.py:417-425` (`admin scope required`), analysis `servicer.py:1578` (gap = prefix start → window start).
