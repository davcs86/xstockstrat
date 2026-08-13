# Context: signal-source-reliability-weight

**Feature**: `docs/roadmap/features/130-signal-source-reliability-weight/feature.md`
**Product Spec**: `docs/roadmap/features/130-signal-source-reliability-weight/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/130-signal-source-reliability-weight/implementation-spec.md`

---

## Session 2026-08-13T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Feature number assigned: 130.
- Story originated from a conversational design-scouting pass (not `/sdd-story` invoked cold): the
  user asked whether signal source weights could live on `ingest.SignalSource` instead of only the
  `analysis.signals.source_weights` config blob, and whether the Opportunities queue could apply
  that weight. Code was scouted directly (not docs) to confirm: `signal_axis` in
  `_compute_opportunities` (`servicer.py:2163`) uses raw `sig.conviction`, no weight applied today;
  analysis holds an `ingest` stub but never calls `ListSignalSources`; the config-ui Sources page
  already renders a read-only weight column sourced from the config blob
  (`useSignalSources.ts:19-30`), which is the natural consumer surface once the field is real.
- Surfaced during scouting, not yet decided: whether to fold in dormant draft feature
  `022-signal-time-decay` (exponential confidence decay by age, never implemented) in the same
  design pass, since both multiply into the same effective-confidence computation. Deferred to
  `/sdd-design` as FR-6 / an Open Question rather than silently expanding or silently ignoring it.
- Ledger checked (fails.md/insights.md): flagged two relevant entries in Open Questions —
  (1) 2026-08-05 `023-position-sizing-engine` — the `Opportunity.conviction` (ordinal) vs.
  `ExternalSignal.conviction` (cardinal) semantic-mismatch trap; this feature's `signal_axis` input
  is the correct (`ExternalSignal.conviction`) field, but the design pass must re-confirm this
  explicitly, not assume it from this note. (2) 2026-08-05 `signal-source-weighting` (feature 007) —
  a `grpcio` version mismatch between regenerated proto stubs and `uv.lock` across three Python
  services, caught only at test-import time; re-check `uv.lock` after regenerating stubs here.

## Session 2026-08-13T00:10:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS WITH WARNINGS. Warnings: `## Database Changes` should state the
  migration follows `NNN_description.up.sql`/`.down.sql` naming and that the next number in
  `services/xstockstrat-ingest/migrations/` is `010_*` (current highest is `009_signal_dedup_keys`)
  — maps to C-07. Advisory, to be filled in at `/sdd-spec` time, not a blocker.
- Overlap findings: none. Confirmed CLEAN against all other active features — `125-unified-symbol-page`
  and `084-droplet-compose-deploy` share `xstockstrat-analysis`/deploy topology respectively but touch
  disjoint files/messages/config keys. `007-signal-source-weighting` (launched) is the historical
  origin of `analysis.signals.source_weights`, not a live collision. `022-signal-time-decay` (draft)
  is self-flagged in this spec's own FR-6, not a scanner finding.

## Session 2026-08-13T00:30:00Z — fix review warning

- Fixed the one advisory warning from the sdd-review pass: `## Database Changes` now states the
  migration naming convention explicitly — next free number in
  `services/xstockstrat-ingest/migrations/` is `010_*` (current highest is `009_signal_dedup_keys`),
  named as `010_add_signal_source_reliability_weight`, with a note to re-verify the number is still
  free immediately before `/sdd-execute` runs it (numbering-collision risk per
  `docs/runbooks/feature-workflow.md` § Feature Numbering).
