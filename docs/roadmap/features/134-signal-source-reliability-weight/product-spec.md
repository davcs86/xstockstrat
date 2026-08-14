# Product Spec: signal-source-reliability-weight

**Created**: 2026-08-13

---

## Problem Statement

Signal source reliability is only weighted inside `scoring.compute_signal_score()`
(`services/xstockstrat-analysis/app/services/scoring.py:10`), consumed by `ScreenSymbols`
(`screener.py:236`) via the analysis-owned config blob `analysis.signals.source_weights`. The
Decide → Opportunities queue (`ListOpportunities`, feature 097) builds its `signal_axis` ranking
input from raw, unweighted `signal.conviction` (`services/xstockstrat-analysis/app/handlers/servicer.py:2163`:
`c["signal_axis"] = max(c["signal_axis"], sig.conviction)`) — a highly speculative source and a
well-vetted source carry equal weight in the queue ranking today. Reliability is also a property of
the *source itself* (owned by `xstockstrat-ingest`), not something analysis should own a private,
disconnected copy of.

## User Story

As a platform operator, I want each signal source's reliability weight to live on the source's own
definition (`ingest.SignalSource`) instead of only in an analysis-owned config blob, and I want the
Opportunities queue to apply that weight when ranking candidates by `signal_axis`, so that a
speculative source and a vetted source no longer rank equally in Decide → Opportunities.

## Functional Requirements

FR-1. Add a first-class `double reliability_weight` field to `ingest.SignalSource`
(`packages/proto/ingest/v1/ingest.proto:142`), analogous to how `health`/`last_seen_at`/
`signals_fed` were added in feature 083 — **not** a key inside `config_json` (that Struct is
validated per-`source_type` against a fixed extraction-config allow-list,
`app/repositories/signal_sources.py:174`, and reliability is unrelated to extraction).
FR-2. Persist the field in `ingest.signal_sources` (new migration column, default `1.0`), writable
via `ManageSignalSource`'s existing create/update path, clamped to `[0.0, 1.0]` at write time
(mirror the existing clamp semantics of `analysis.signals.source_weights`).
FR-3. `xstockstrat-analysis` gains a `ListSignalSources` read path (it already holds an `ingest`
gRPC stub, `self._ingest`, `servicer.py:132`, currently used only for `QuerySignals`/`IngestSignal`/
`ManageSignalSource` — never `ListSignalSources`) and applies each source's `reliability_weight`
when building `signal_axis` in `_compute_opportunities` (`servicer.py:2163`), e.g.
`c["signal_axis"] = max(c["signal_axis"], sig.conviction * weight_for(sig.source))`.
FR-4. Decide, at design time, whether `ingest.SignalSource.reliability_weight` **replaces**
`analysis.signals.source_weights` as the single source of truth (screener/backtest-blend paths
re-point at the new field, config key is deprecated) or **layers** as an override (config value wins
when present, else the source's own field) — do not ship both as silently-independent, possibly
disagreeing numbers.
FR-5. The `xstockstrat-ui` config-ui Sources page (`src/app/config-ui/sources/page.tsx:344`,
`useSignalSources.ts:19-30`) already renders a read-only "weight" column sourced from
`analysis.signals.source_weights` — update it to read/write the new field via `ManageSignalSource`
instead of (or in addition to, per FR-4's decision) the config blob.
FR-6. At design time, explicitly evaluate whether to fold in the dormant draft feature
`022-signal-time-decay` (exponential confidence decay by signal age, `docs/roadmap/features/022-signal-time-decay/`,
status `draft`, never implemented) in the same pass, since both decay and reliability weighting
multiply into the same effective-confidence computation on the same code path
(`compute_signal_score` / the new `signal_axis` weighting) — decide fold-in vs. explicitly-deferred-with-a-named-follow-up,
not silent omission.

## Out of Scope

- Per-source-type or per-user reliability weights (one global weight per source, V1).
- Signal time decay itself (see FR-6 — a design-time decision, not committed scope here).
- Retiring `analysis.signals.source_weights` outright — FR-4 defers that call to design.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ingest` — new `SignalSource.reliability_weight` field, migration, `ManageSignalSource` write path
- `xstockstrat-analysis` — new `ListSignalSources` read path, `signal_axis` weighting in `_compute_opportunities`
- `xstockstrat-ui` — config-ui Sources page weight column becomes read/write against the new field
- `packages/proto` — `ingest.proto` field addition

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` / `/config-ui`: the existing Sources page weight column
  (`src/app/config-ui/sources/page.tsx:344`) becomes read/write against `reliability_weight`
  instead of a read-only projection of the config blob (FR-5). No new page — an existing control
  changes its backing field.
- [ ] **Agent** — no MCP tool surfaces signal sources or opportunities scoring today; none added.
- [ ] **None**

The Opportunities queue's *ranking behavior* changes (FR-3) but no new opportunities-page UI element
is required — the existing queue ordering already reflects `signal_axis`.

## Proto Contract Changes

- [x] New field: `double reliability_weight` on `ingest.SignalSource` (additive, non-breaking —
  1 service owner + Proto Reviewer per the non-breaking-proto approval gate).

## Config Key Changes

- [ ] No new config keys — FR-4's design-time decision determines whether the existing
  `analysis.signals.source_weights` is deprecated, kept as an override layer, or left untouched.

## Database Changes

- [x] New migration in `services/xstockstrat-ingest/migrations/`, following the established
  `NNN_description.up.sql`/`.down.sql` pair convention (`docs/runbooks/feature-workflow.md` §
  Database Schema Changes). The directory's current highest is `009_signal_dedup_keys`, so this
  migration is `010_add_signal_source_reliability_weight` — adds a `reliability_weight DOUBLE
  PRECISION NOT NULL DEFAULT 1.0` column to `ingest.signal_sources`, with the `.down.sql` dropping
  it. Confirm the number is still free (no sibling in-flight feature has claimed `010`) immediately
  before `/sdd-execute` runs it, per the numbering-collision guidance in
  `docs/runbooks/feature-workflow.md` § Feature Numbering.

## Feature Workflow Notes

Branch to create: `feature/signal-source-reliability-weight` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto + config change)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable (additive field)
- [x] DBA review + service owner (schema migration) — new `reliability_weight` column

## Acceptance Criteria

1. `ManageSignalSource` accepts and persists `reliability_weight` in `[0.0, 1.0]`; an out-of-range
   value is clamped, mirroring the existing `analysis.signals.source_weights` clamp behavior.
2. `ListOpportunities`' `signal_axis` for a candidate reflects its contributing signal(s)' source
   `reliability_weight` — a source weighted `0.5` contributes half the `signal_axis` of an otherwise
   identical `1.0`-weighted source, all else equal.
3. The config-ui Sources page weight column edits `reliability_weight` end-to-end (write via
   `ManageSignalSource`, read back on reload) — not the pre-existing config blob, once FR-4/FR-5 land.
4. FR-4's replace-vs-override decision is recorded in `design.md` with a stated rationale, not left
   implicit in code.
5. FR-6's fold-in-or-defer decision on `022-signal-time-decay` is recorded in `design.md`.

## Open Questions

- [ ] Replace vs. override `analysis.signals.source_weights` (FR-4) — decide at `/sdd-design`.
- [ ] Fold in `022-signal-time-decay` or explicitly defer it as a named follow-up (FR-6) — decide at
  `/sdd-design`.
- [ ] **Known trap** (`fails.md` 2026-08-05, `023-position-sizing-engine`): a prior feature nearly
  wired `Opportunity.conviction` — a **deterministic ordinal** ("passing/total leaves... NOT a
  probability" per its own proto comment) — into a cardinal-input slot because the name/range
  matched. This feature's `signal_axis` is built from `ExternalSignal.conviction` ("0.0–1.0
  confidence", `ingest.proto:110`) which *is* the semantically-correct cardinal field — but the
  design pass must re-confirm this distinction explicitly rather than assume it, per the same ledger
  entry's rule ("read the candidate field's own doc comment, not just its name/range").
- [ ] **Known trap** (`fails.md` 2026-08-05, `signal-source-weighting`/feature 007): a prior signal-
  weighting feature hit a `grpcio` version mismatch between regenerated proto stubs and
  `uv.lock` across analysis/indicators/ingest, caught only at test-import time. Re-check
  `uv.lock` in all three Python services after regenerating stubs for the new proto field.
