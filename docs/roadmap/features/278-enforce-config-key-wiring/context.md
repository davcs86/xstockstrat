# Context: enforce-config-key-wiring

**Feature**: `docs/roadmap/features/278-enforce-config-key-wiring/feature.md`
**Product Spec**: `docs/roadmap/features/278-enforce-config-key-wiring/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/278-enforce-config-key-wiring/implementation-spec.md`

---

## Session 2026-10-23 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the operator's request.
- **Origin:** the operator demoted `277-fix-ingest-seeded-config-keys` at its round-4 design gate and asked for a follow-up that enforces, in the execution/validation loop, that every new config key is actually implemented as planned.
- **Consumer surface (C-14):** None (internal tooling and process). Stated in the product spec.
- **Evidence to reuse:** 277's recon.md and context.md (the sweep: 5 ingest and 13 analysis keys seeded bare but read dotted, `indicators.sandbox.*` owned by 243, dead seeds `analysis backtest.max_duration_seconds` and `ledger stream.notify_enabled`, unseeded `ingest.backfill.max_concurrent_jobs` and `retry_on_failure`). The CI baseline in FR-4 is that list.
- **Open for review:** the five questions in the product spec, especially which form (migration column vs live snapshot) the check treats as authoritative.

## Session 2026-10-23 — sdd-story (follow-up)

- The operator marked the ingest seeded-key defect report `wont-fix` (ref `feature:277-fix-ingest-seeded-config-keys`). The 18 known findings therefore have no open owner: they live only in 277's `context.md`, and FR-4's baseline entries must name 277 (or 278) as the owning feature, not a defect report.

## Session 2026-10-23 — sdd-review product-spec (FAIL)

- Verdict FAIL on criterion 9 (five unresolved Open Questions). Overlap WARN only (`264-fix-portfolio-snapshot-surface` also appends to `docs/patterns/config-governance.md`; keep 278's edit to the rule section).
- Resolutions recorded in product-spec.md: check is a `scripts/` script covering Go/Python/TS, runtime-built keys reported as `dynamic-read` (new finding kind in FR-1, @AC-9); stored form = live snapshot key `values[row.key]`, never normalized; baseline (not fix-first), contents = 277's full sweep (18 form mismatches plus dead seeds, unseeded keys, `indicators.sandbox.*` owned by 243), each entry owned by 277/278/243; 243/244/261 interaction deferred to /sdd-design with constraints; ledger traps adopted as constraints.
- Warnings addressed: baseline count wording fixed (18 is the form-mismatch subset only); added @AC-10 (migration trigger for FR-2) and @AC-11 (snapshot-built test for FR-3); scenario key names are illustrative (comment in acceptance.feature); the bare seeded form in @AC-1 is a finding kind, not a C-05 breach by this spec.
- Operator decisions (binding, 2026-10-23): created as follow-up when 277 was demoted; run full speccing (review, recon, full design debate, spec, impl-spec review). x-trace-id standing rule (2026-10-21) applies. Repo tooling only: no runtime service, proto, migration or config key change; check must work across Go/Python/TS, survive 244's refactor, and state how runtime-built keys are treated. No staging/production writes.
