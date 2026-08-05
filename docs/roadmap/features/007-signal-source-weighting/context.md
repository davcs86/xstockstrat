# Context: signal-source-weighting  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Added a per-source reliability multiplier to `_compute_signal_score()` in xstockstrat-analysis, delivered via a JSON-blob config key (`analysis.signals.source_weights`) rather than a proto or DB change, clamped to `[0.0, 1.0]` at read time with a 1.0 default for unlisted sources. Shipped exactly as speced — no runtime surprises, only a build-tooling scar during test execution.
**Why (irrecoverable rationale)**: Originated from an operator audit of signal aggregation noticing all sources (e.g. Goldman vs. a low-quality newsletter) got equal weight (context.md 2026-05-16 session, feature.md:35). JSON-via-existing-config-string was chosen specifically to avoid a proto change and let weights update live through WatchConfig without a restart (product-spec.md FR-2/FR-4).
**Rejected alternatives**: - Client-side `[0.0,1.0]` bound validation in xstockstrat-config-ui — deferred, not rejected outright; pushed to backlog idea `016-config-ui-weight-validation` because the config-ui generic editor accepts raw JSON strings and server-side clamping (FR-5) was judged sufficient for launch (product-spec.md:30, context.md 2026-05-23 review session).
**Scars & gotchas**:
- Writing the Step 4 tests surfaced that `uv.lock` in all three Python services (`analysis`, `indicators`, `ingest`) pinned `grpcio==1.78.0` while the generated proto stubs required `>=1.80.0`, raising a hard `RuntimeError` at pytest import time. Fixed by bumping `grpcio`/`grpcio-reflection`/`grpcio-tools` to `>=1.80.0` in all three services' `pyproject.toml` + regenerating all three `uv.lock` files, even though only `analysis` was in scope for this feature (context.md 2026-05-24 session; implementation-spec.md:385-397, Deviation Log).
- `make_servicer()` test helper only mocked `get_float`; adding a `get_str` JSON-read path broke existing `TestRunBacktest` tests until a matching `get_str` mock was added (context.md line 48-52).
**Permanent deviations**: none — implementation matches product-spec/implementation-spec as written.
**Cross-feature signal**:
- A grpcio minimum-version drift between generated stubs and lockfiles is a cross-service landmine — it silently blocks any Python service's test suite the first time someone touches code that triggers stub import, not just the touched service. Worth a proactive lockfile-vs-codegen version check rather than discovering it mid-feature.
- Delivering structured (dict/JSON) values through the existing `value_type='string'` config column + `get_str()`+`json.loads()` is now a proven, reusable path for "map-shaped" config without proto or schema changes.
**Deferred follow-ons**: - Backlog idea `016-config-ui-weight-validation` (client-side bound validation for weight JSON in config-ui) — not yet actioned as of this archive.
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at 33ff5dc.
