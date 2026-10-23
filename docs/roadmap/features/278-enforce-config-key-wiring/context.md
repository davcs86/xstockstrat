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
