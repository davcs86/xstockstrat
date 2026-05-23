# Context: signal-source-weighting

**Feature**: `docs/roadmap/features/007-signal-source-weighting/feature.md`
**Product Spec**: `docs/roadmap/features/007-signal-source-weighting/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/007-signal-source-weighting/implementation-spec.md`

---

## Session 2026-05-16T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: audit of analysis service signal aggregation revealed all sources are weighted equally regardless of reliability.
- No proto changes required; weights delivered via existing config WatchConfig stream.

## Session 2026-05-23T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings:
  - C-3 trading mode: spec does not explicitly state paper-safety (advisory; analysis feeds backtests only, no order execution)
  - Overlap: 009-agent-mcp-server also modifies `xstockstrat-analysis` — coordinate merge order to avoid conflicts in servicer.py
- Open question resolved: weights bounded to [0.0, 1.0], clamped at read time; FR-5 and AC-3 updated accordingly
- Backlog idea 016-config-ui-weight-validation created for deferred client-side validation

## Session 2026-05-23T00:00:00Z — sdd-spec

- Generated implementation-spec.md with 4 steps. Status → implementation-ready.
- Key codebase findings:
  - Last config migration is `002_config_environment.up.sql`; new migration is `003_analysis_signal_source_weights.up.sql/down.sql`
  - `_compute_signal_score` at `servicer.py:L494` accumulates conviction without weights; signature change adds `source_weights: dict | None = None` so all existing tests pass unchanged
  - Config service stores JSON payloads as `value_type='string'`; `buildConfigValue` returns `string_val` for both `'string'` and unknown types (confirmed at `configServiceImpl.ts:L248`); analysis watcher reads via `get_str()` then `json.loads()`
  - `xstockstrat-config-ui/app/sources/page.tsx:L164` already references `analysis.signals.source_weights` key name — confirms the key name is correct
  - `make_servicer()` in `test_analysis_servicer.py` mocks `get_float` but not `get_str`; Step 4 adds the missing `get_str` mock to prevent `json.loads(MagicMock())` TypeError in existing `TestRunBacktest` tests
