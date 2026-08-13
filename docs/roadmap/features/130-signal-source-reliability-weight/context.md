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

## Session 2026-08-13T01:00:00Z — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-ingest, xstockstrat-analysis, xstockstrat-ui;
  key reuse patterns: `NamespaceEditor.tsx`'s inline-edit-cell + `validateFloatMap`, AIP-161 masked
  partial update already end-to-end). Two new forks surfaced beyond the product spec's own FR-4/FR-6:
  reject-vs-clamp semantics (ingest's own `conviction` precedent rejects; the config blob it replaces
  clamps) and whether `ManageSignalSourceResponse`'s row-construction should include the new field.
- Phase 1 Grilling: 4 rounds (full). Round 1 found a real correctness bug (plain `double` → new
  sources silently get weight `0.0` via proto3's zero-value, since the create form is untouched) and
  a factually broken UI-reuse claim (`validateFloatMap` validates a JSON map, not a scalar — would
  make every edit unsavable). Round 2 fixed both but introduced a second real bug (`None` doesn't
  fall through to a `NOT NULL DEFAULT` column in Postgres when the column is named in the INSERT —
  crashes every UI-driven registration) and shipped a cosmetic, not functional, resolution of FR-4
  (config key "deprecated" in description text only, while `ScreenSymbols` kept reading it live — the
  exact dual-source anti-pattern FR-4 forbids). Round 3 fixed both for real (Python-side default
  resolution; genuine repoint of `ScreenerEngine` off the config blob) — confirmed via independent
  grep-verification, not trust. Round 4 closed six remaining loose ends (a stale e2e test, two stale
  docs, an explicit accepted trade-off for the now-unread-but-still-editable config key, a restored DB
  `CHECK`, two carry-forward decisions, and a corrected test-churn count). Adversary recommended
  approval at round 4; user approved.
- Chosen approach: `optional double reliability_weight = 12` on `ingest.SignalSource`
  (explicit-presence required to avoid the zero-value bug), reject-at-write + DB `CHECK` validation
  (matches `conviction`'s own precedent, departs from the config blob's clamp), FR-4 resolved as a
  genuine replace (`ScreenSymbols` AND `_compute_opportunities` both repoint to a shared
  `_drain_source_weights` helper), UI reuses only `NamespaceEditor`'s click-to-edit shell with a
  bespoke scalar validator. Rejected: override-layer FR-4, `None`-relies-on-SQL-DEFAULT, cosmetic
  deprecation, deleting the config key outright, verbatim `validateFloatMap` reuse.
- Constitution rules touched: C-01, C-05, C-07, C-09, C-10(b), C-12, C-14, P-01, P-02, P-03, F-01,
  F-08 — all honored, no Floor breach at any round.
- Status: spec-ready → design-approved.
- **Insight worth recording**: this debate is a strong case study for grep-verifying a design
  proposal's claims rather than trusting its prose — three of the four rounds' real defects (the
  proto zero-value bug, the SQL NULL/DEFAULT crash, the cosmetic-not-functional FR-4 "fix") were each
  *plausible-sounding and internally consistent* in the proposer's own text, and were only caught
  because the adversary re-traced the actual code/DB semantics instead of accepting the proposal's
  self-description. Logged to `docs/roadmap/ledger/insights.md`.
