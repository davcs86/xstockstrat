# Defect: Ingest CLAUDE.md banner lists fixed defects; QuerySignals docstring says "active"

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-ingest
**Config-only fix possible**: no
**Source**: services/xstockstrat-ingest/docs/context-constitution-findings.md — Documentation-that-lies row 3 (banner); constitution INGEST-5 (opt-in active filter)

## Observed
1. The CLAUDE.md constitution banner still lists "9 dead config keys, unimplemented dedup" as open
   defects. Only one `ingest.signals.*` key exists, and it is read. Dedup is implemented via the
   `signal_dedup_claims` claim query, which the same CLAUDE.md documents.
2. The `QuerySignals` docstring says "Query active signals". The active/expiry filter is opt-in:
   with no `active_window`, every signal is returned regardless of `valid_until` (INGEST-5).

## Expected
The banner lists only current defects. The docstring states that expiry filtering applies only when
`active_window` is set.

## Reproduction
1. Read the `services/xstockstrat-ingest/CLAUDE.md` line 4 banner and compare with its own config table and `signal_dedup_claims` section.
2. Read the `servicer.py:1155` docstring and compare with the INGEST-5 rule in `docs/context-constitution.md`.

## Evidence
`services/xstockstrat-ingest/CLAUDE.md:4`
> defects (9 dead config keys, unimplemented dedup, dead indicators-only `sandbox_*` helpers)

`services/xstockstrat-ingest/app/handlers/servicer.py:1155`
> """Query active signals filtered by owner scope, source/symbol/direction and time window."""

## Root cause hypothesis
The banner was written at the first forge and never refreshed after features 111/224. The docstring predates the opt-in `active_window`.

## Confidence
high
