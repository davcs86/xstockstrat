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

## Session 2026-10-23 — sdd-review product-spec (PASS WITH WARNINGS)

- Product spec approved. Status: draft → spec-ready.
- Warnings (resolved in the spec): AC-10 `Then` rewritten as an observable outcome (step stays not-done, output names the check result) with a finding added to its `Given`; AC-9 `Given` now names a concrete expression (`f"analysis.{name}.enabled"`, `name` a function parameter); FR-1 split into the four named finding kinds; FR-2 states where a feature declares a key (product-spec `Config Key Changes` or a migration step), exact source pinned at design; approval-gate boxes struck (none apply).
- Warnings (carried to design): four Open Questions are deferred to `/sdd-design` (reader discovery mechanism, 243/244/261 ordering, exact baseline count; AC-7 needs the final count); Affected Services lists paths, not registry names (NOTE-level deviation, no runtime service).
- Overlap findings (WARN, rebase-only): `docs/patterns/config-governance.md` is also edited by 264, 243, 244, 248, 241, 249 (keep 278's edit to the rule section). Live dependency: 278's baseline must keep the `indicators.sandbox.*` entries owned by 243 until 243's migration `031_heal_indicators_sandbox_keys_full_dotted` lands. Incidental, not 278: migration 032 is claimed twice in config (244 and 248). `ci.yml`, `.claude/skills/*`, `scripts/` have no collisions. No merge-order entry required.

OPERATOR DECISIONS (binding, recorded 2026-10-23):
- Operator 2026-10-23: created as the follow-up when 277-fix-ingest-seeded-config-keys was demoted; run the full speccing (review, recon, full design debate, spec, impl-spec review). The feature dir lives on the base branch ccr-fac38b1f-6m24q2 (PR #1322, not yet merged to main-dev).
- Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
- Evidence base: feature 277's recon.md and context.md (the sweep of 18 inert bare-seeded keys, the dead seeds analysis backtest.max_duration_seconds and ledger stream.notify_enabled, the unseeded ingest.backfill.max_concurrent_jobs/retry_on_failure, indicators.sandbox.* owned by feature 243) on branch feature/fix-ingest-seeded-config-keys and in the base branch; the ingest defect report was closed wont-fix by the operator, so FR-4's baseline entries must name feature 277/278 as owner. Read 277's design state (rounds 1-4, the binding amendments) for what a faithful check must prove: stored key read back against the reader string, not just counted (fails.md:2335).
- This feature is repo tooling and process only: no runtime service, proto, migration or config key change; it must not change any reader or seed. The check has to work across Go, Python and TypeScript readers and survive feature 244's refactor that moves reader literals into helpers, and it must say how keys built at runtime are treated. Do not run any staging or production read or write during speccing beyond read-only get_config if needed.
