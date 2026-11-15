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

## Session 2026-11-15 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (8; overall PASS WITH WARNINGS, no fails, no floor breaches):
  - Resolved in this session:
    - FR-5 named partial and canceled but only @AC-6 (failed) covered it — added @AC-9 (Scenario Outline, PARTIAL and CANCELED); FR-5 now reads "with the job's error when one is reported" (a canceled job may carry none). @AC-9 belongs to the FR-6 branch, so the Open Questions line now reads "@AC-1…@AC-7 and @AC-9 are authoritative if FR-6 is chosen".
    - C-14 Agent box: left unchecked with the reason stated — the Agent `trigger_backfill` tool and the `strat-lab` `backtest` skill are in scope in the same PR only if FR-6 is chosen and the `TriggerBackfill` admin gate opens; design ticks the box then.
    - Latent config key: the Config Key Changes line now says a per-user backfill limit key, if added, carries the full config-key contract with a namespace-relative stored key (C-05, F-07).
    - Problem Statement names the persona ("the trader").
  - Carried to design:
    - FR-6 vs FR-7 is ticked in Open Questions but is a deferred process decision, not a resolved one: the operator picks at the design gate; design must not proceed silently (C-11).
    - @AC-2 ("a daily-bars backfill is requested … from 2023-03-17 to 2024-01-01") and @AC-5 ("a backtest … is requested") assert a request rather than what the card shows. Left as written — the range is the point of FR-2 and no UI copy for it is decided; design may reword to an observable outcome.
    - "No proto changes" is unchecked pending design; the FR-7 fallback needs an existing RPC as its score source and design must name it.
    - The ingest `TriggerBackfill` admin gate was added deliberately in feature 092 to protect vendor quota (`services/xstockstrat-ingest/tests/test_ingest_servicer.py:362-384`); opening it is a quota-exposure risk design must cost. The e2e at `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts:337` asserts /Backfill coverage panel/ and must be handled on either branch. `coverage_gaps` exists at `packages/proto/analysis/v1/analysis.proto:136`.
- Overlap findings (WARN; file-level, soft — no config, proto, or migration collision; peers 339–342 and 344 are all `draft`):
  - [file] `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` shared with `339-fix-symbol-page-alerts-ui` (Research tab Fundamentals card vs this feature's Analysis → Backtests card). Disjoint regions; whichever merges second rebases.
  - [service] `xstockstrat-ingest` shared with `344-alert-detail-page` (backfill-failure alert body vs `TriggerBackfill` authorization). No shared file or key named; re-check at impl-spec.
  - [ui] `xstockstrat-ui` also shared with `342-chart-series-palette`, `341-fix-indicator-pane-warmup`, `344-alert-detail-page` — different surfaces, low risk.
  - `strat-lab` `backtest` skill must update in the same PR if the admin gate changes (`docs/patterns/strat-lab-plugin.md`) — not a peer collision.
  - Historical: `merge-order.md` rows for 052/053/054 cover `ingest.backfill_jobs` and `BackfillJob` field numbers; this feature adds no proto field and no migration, so no new collision.
  - Merge-order: no entry for 343 and none required now. Re-check at impl-spec if the FR-6 path adds an ingest migration or a config key.
- Recommended design depth: full (2 affected services; warning-level overlap)

OPERATOR DECISIONS (binding, recorded 2026-11-15):
- Backfill only the missing range reported by the backtest, not full history.
- After the backfill completes show a re-run action; do not re-run automatically.
- Try to open the backfill action to every authenticated user. If that requires a lot of changes, replace the section with strategy scores only, defaulting to 'not enough data' with no actions at all.
- The operator set the fallback but not the threshold for 'a lot of changes': the design must present the cost of opening the trigger to non-admins at the design gate rather than choose silently.
