# Context: ingest-signal-dedup  (archived 2026-08-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-16 — /sdd-archiver

**What**: Closed a documented-never-implemented defect: `IngestSignal` in `xstockstrat-ingest` unconditionally inserted into `ingest.newsletter_signals` with no duplicate check. Fix adds an atomic dedup claim table (`ingest.signal_dedup_keys`), rewrites the handler to use the service's first-ever explicit asyncpg transaction with sentinel-exception rollback idiom, propagates a new `deduplicated` proto field through the agent client, and guards the agent's auto-alert side effect behind that field.

**Why (irrecoverable rationale)**: Unique index on `ingest.newsletter_signals` for natural key `(source, symbol, direction)` is impossible — TimescaleDB requires unique index to include its partition column (`ingested_at`), which is not part of the natural key. Side-table approach is the third instance of this workaround in the repo (after `ledger.idempotency_keys` and `analysis.fundsignal_emitted`). Dedup belongs in `xstockstrat-ingest` (not agent) because agent is stateless — `xstockstrat-analysis`'s `fundsignal_loop.py` is a second real caller of `IngestSignal`. Window anchor is ingestion time (`claimed_at`), not `valid_from` — `valid_from` can legitimately repeat across genuinely distinct signals (e.g., daily EOD signals with same market-open placeholder). Conviction and `valid_until` added to dedup match beyond bare `(source, symbol, direction)` — a conviction update on an ongoing recommendation should not be silently swallowed as a duplicate. Insert-first ordering (insert `newsletter_signals` row, then claim `signal_dedup_keys`) required because `newsletter_signals.id` is a `BIGSERIAL` — no id exists to claim before the candidate row is created. `touch_source_last_seen` added in Round 3: a deduplicated-path resubmission of a still-current recommendation would read as STALE/DOWN in health derivation if every dedup hit skipped `mark_source_fed` (which bumps `last_seen_at`).

**Rejected alternatives**: `SELECT ... FOR UPDATE` pre-check (genuine TOCTOU race on new key — `FOR UPDATE` acquires no lock on non-existent row). Time-bucketed dedup key (boundary straddling). `valid_from`-anchored window (duplicates plausible across genuinely distinct signals). Narrow match on `(source, symbol, direction)` only (conviction change silently swallowed). Sequence-pregeneration claim-first (no precedent in codebase; ON CONFLICT is already race-safe).

**Scars & gotchas**: `_DuplicateSignal` sentinel must be raised inside `async with conn.transaction():` and caught before the generic `except Exception` — ordering is safety-critical (`_DuplicateSignal` is an `Exception` subclass). Mock-call-count assertion (`context.abort`/`mark_source_error` never called on dedup hit) is the achievable test pin — no live DB fixtures anywhere in this service's test suite. `xstockstrat-ingest` had zero explicit asyncpg transactions before this feature; introducing the first one required a new `transaction_conn` helper in `tests/_helpers.py` AND a mock-shape rewrite across the test suite — blast radius was wider than spec anticipated: 3 test files outside `TestIngestSignal` class also used the old pool-level mocking shape. Design code snippets used placeholder attribute name `self._config` → actual codebase symbol is `self._cfg` (`servicer.py:171`). Trufflehog false positive in PR #887 (case-insensitive `lob` substring in protobuf codegen boilerplate) — all 31 other CI checks passed. `xstockstrat-analysis`'s `fundsignal_loop.py:8-9` comment ("ingest's `IngestSignal` does not dedup") goes stale when this feature ships.

**Permanent deviations**: Design code snippets used `self._config` → shipped as `self._cfg`. feature.md `**Development Branch**` reads `feature/ingest-signal-dedup` → shipped on harness-assigned `claude/ingest-signal-dedup-ehhgy6`.

**Cross-feature signal**: Third instance of the hypertable-unique-index workaround side-table pattern in this repo. Any future dedup/idempotency guarantee on a hypertable-backed table should reach for this pattern first — alongside `ledger.idempotency_keys` and `analysis.fundsignal_emitted` as prior art.

**Deferred follow-ons**: none recorded at feature close.

**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-08-16 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: PLAT-INGEST-1 (`ingest.newsletter_signals` is a hypertable partitioned on `ingested_at`; unique index on any column subset excluding `ingested_at` is structurally impossible under TimescaleDB; dedup-side-table workaround is the confirmed platform pattern — third instance alongside `ledger.idempotency_keys` and `analysis.fundsignal_emitted`).

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at e91d40029e7d114e5d52c8c6d2ebdf9ea357a9fc.
