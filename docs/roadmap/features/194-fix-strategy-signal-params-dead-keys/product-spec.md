# Product Spec: fix-strategy-signal-params-dead-keys

**Type**: bug (Track C) · **Severity**: SEV-3 · **Config-only**: no

## Source

`docs/reports/2026-09-18-deprecated-fields-in-rpc-contracts-defect.md` **Defect 1** — the reader
inventory proving no `StrategyDefinition` consumer reads the four blend keys (only `symbols`/`target`/
`stop` are load-bearing). That report is the authoritative analysis; this is the Track C wrapper.

> Defect 2 of that report (33 `[deprecated=true]` proto fields) is a governance-gated breaking-change
> program, NOT this bug — routed to feature 196 (`/sdd-story`), not implemented here.

## Problem

`StrategyDefinition.signal_params` (a `google.protobuf.Struct`) carries `signal_sources`,
`signal_weight`, `technical_weight`, `min_conviction` — dead since feature 097 made scoring
technical-only. They appear in every served payload, so a reader cannot tell them from live input.

## Affected service(s)

- `xstockstrat-analysis` only (`app/handlers/servicer.py`).

## Chosen approach — read-side strip (fingerprint-safe)

Strip the four keys in `_row_to_strategy_definition` (default) so every served edge is clean, plus on
the write request pre-persist so new/edited rows are born clean. **Not** a backfill or an
unconditional write re-key: `_definition_fingerprint` hashes the stored `definition_json`, so
re-keying an existing row would change its fingerprint and drop its accumulated evidence grade
(ANALYSIS-3). The masked-UPDATE persist-merge opts out (`strip_dead_signal_params=False`) so a rename
never churns a dirty row's fingerprint. See `context.md` for the constraint that flipped the report's
"strip on write + backfill" suggestion to read-side.

## Governance gates

- Proto: none (Struct payload keys, not a proto field change — `buf breaking` not triggered).
- Config: none. DB: none. Reviewer: xstockstrat-analysis owner.

## Acceptance

See `acceptance.feature` — served-payload cleanliness (@AC-1) + the fingerprint-stability safety
property (@AC-2).
