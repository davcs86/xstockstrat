# Context: ingest-signal-dedup

**Feature**: `docs/roadmap/features/111-ingest-signal-dedup/feature.md`
**Product Spec**: `docs/roadmap/features/111-ingest-signal-dedup/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/111-ingest-signal-dedup/implementation-spec.md`

---

## Session 2026-08-07 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story
  ("add dedup logic to the ingest_signal tool in the MCP agent (or the upstream service,
  depending on the best solution)").
- Recon (via codebase-discovery subagent) confirmed: `IngestSignal`
  (`services/xstockstrat-ingest/app/handlers/servicer.py:693-818`) unconditionally inserts into
  `ingest.newsletter_signals` with zero duplicate check today. This is a documented, unimplemented
  defect: `services/xstockstrat-ingest/docs/context-constitution-findings.md:12` records that the
  service's docs once claimed a dedup key ("skip re-ingesting same symbol+source+direction within
  this window") that was never wired — the `dedup_window_hours` config key was dead and has since
  been dropped from `CLAUDE.md` entirely. Table `ingest.newsletter_signals`
  (`migrations/001_newsletter_signals.up.sql`) has no unique constraint beyond the hypertable PK.
  The MCP agent's `ingest_signal` tool (`app/tools.py:227-296`) and gRPC client
  (`app/client.py:149-186`) make one call, no retry, no idempotency handling — agent is stateless,
  so it cannot be the sole dedup owner for other `IngestSignal` callers.
- Known trap surfaced from ledger: `insights.md` 2026-08-06 (fundamentals-signal-producer) —
  "when a callee RPC lacks a uniqueness constraint, the idempotency guard belongs in the caller's
  own state table keyed on its natural key" — here `xstockstrat-ingest` is the state-owning layer,
  which is why product-spec FR-5 places the dedup check there rather than solely in the agent.
- Decision: propose dedup logic live in `xstockstrat-ingest` (upstream service), with the MCP
  agent's tool surfacing the outcome and suppressing its own duplicate side effect (auto-alert).
  Final architecture (index vs. app-level check, exact config key name/default) deferred to
  `/sdd-design`.

## Session 2026-08-07 — sdd-design (quick mode + 2 user-requested extensions, 3 rounds total)

- **Phase 0 Recon**: two `codebase-discovery` subagents covered `xstockstrat-ingest` (config-watch
  pattern, `IngestSignal` transaction/pool analysis, precedent search) and `xstockstrat-agent`
  (auto-alert logic, client return shape, test coverage). Key finding: `ingest.newsletter_signals`
  is a hypertable partitioned on `ingested_at` — TimescaleDB requires a hypertable's unique index
  to include its partition column, so a unique constraint directly on the natural dedup key is
  impossible; every hypertable in this repo confirms this constraint with no exception. Two
  existing precedents for the identical problem: `ledger.idempotency_keys` and
  `analysis.fundsignal_emitted` (both side tables + `ON CONFLICT ... RETURNING`). Wrote
  `recon.md`.
- **Phase 1 Grilling — Round 1**: live `design-proposer` + `design-adversary` subagents ran (the
  proposer completed with an `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE ... RETURNING`
  design; the orchestrator's own dispatched adversary critiqued a slightly different
  self-synthesized `SELECT ... FOR UPDATE` variant sent before the real proposer's output arrived
  — a P-02 mediation slip, disclosed here). The adversary's TOCTOU objection against the `SELECT
  FOR UPDATE` variant was verified NOT to apply to the proposer's actual `ON CONFLICT` idiom
  (Postgres's documented upsert semantics + the `fundsignal_emitted` precedent already trusted in
  this repo). Gate 1 (`AskUserQuestion`): user decided (a) dedup window anchored on **ingestion
  time** (`claimed_at`), not `valid_from`; (b) a conviction/`valid_until` change within the window
  is treated as a **fresh signal**, not swallowed as a duplicate — both decisions folded into
  `product-spec.md` FR-1/AC-1/AC-2/Open Questions. Then chose "Run another round."
- **Round 2**: orchestrator synthesized the round-2 design directly (widened claim SQL with
  `IS DISTINCT FROM` on conviction/valid_until, `009_signal_dedup_keys` schema, sentinel-exception
  rollback pattern) — the round-2 **adversary** subagent did not return within a reasonable wait
  window despite several extended waits, so the orchestrator performed that critique pass itself
  (constitution.md + fails.md read directly, migration-number collision checked against all 43
  remote branches via `git ls-remote`, C-10 completeness verified by grepping for other
  `IngestSignal` callers — found `xstockstrat-analysis`'s `fundsignal_loop.py`, reviewed and
  confirmed it needs no change). The round-2 **proposer** subagent *did* complete, independently,
  shortly after — its output converged on the same architecture and the same race-safety
  conclusion reached separately by the orchestrator; its cleaner sentinel-exception rollback code
  and `make_interval()` refinement were folded into `design.md`. Gate 2: user chose "Run another
  round" again.
- **Round 3**: scoped to hardening the four remaining Open Risks (rollback-path test coverage,
  write-amplification estimate, `mark_source_fed`/health-tracking gap, C-08 test-pairing list) —
  explicitly not re-litigating the settled architecture. Orchestrator answered all four directly
  from the live codebase (test file structure, source-registry seed data, `signal_sources.py`)
  after the round-3 proposer subagent again did not return in a reasonable window; added a new
  `touch_source_last_seen` sibling function (cheap fix for the STALE-health gap) and a concrete
  per-test-case plan. Gate 3 (`AskUserQuestion`): user **approved**. The round-3 proposer
  subagent then completed independently, *after* approval — its output converged on the identical
  `touch_source_last_seen` fix (strong triangulated validation) and corrected one detail: the
  proposed rollback-correctness test can't assert a live DB row count (no DB fixture exists in
  this service's test suite — confirmed via grep, `test_backfill_jobs.py:3`'s own comment on the
  pool-is-mocked house style), so it was replaced with an achievable mock-call-count assertion
  (`test_dedup_hit_does_not_reach_generic_error_handler`). Folded into `design.md` as a fidelity
  correction, not a new decision — no re-gate needed.
- **Disclosed deviation (P-03)**: three background subagent calls (round-1 adversary target
  mismatch — sent the orchestrator's own draft instead of the live proposer's; round-2 adversary;
  round-3 proposer) did not complete within the session's practical wait budget despite repeated
  extended waits (up to several minutes each). In each case the orchestrator performed the same
  analytical pass itself (reading the same source files, verifying the same SQL/race-safety/
  migration-collision claims against real evidence rather than asserting them) rather than
  silently skipping the check or waiting indefinitely. All three eventually-completed late
  subagent outputs (round-1 proposer, round-2 proposer, round-3 proposer) were checked against the
  orchestrator's inline work and found to converge independently — no contradiction surfaced.
- **Constitution rules touched**: C-01, C-05, C-07, C-09, C-10, C-14, F-06, F-07 (all honored —
  see `design.md` § Constitution Rules Touched). No Floor (`F-*`) breach at any round.
- **Ledger touch**: none written — no new cross-feature pattern or recurring mistake surfaced
  beyond what's already recorded (the fundamentals-signal-producer idempotency-guard-at-the-
  caller-layer insight and the hypertable-unique-index constraint were both already in
  `insights.md`/informed this design; nothing new to append).
- Status: `draft` → `design-approved`.
