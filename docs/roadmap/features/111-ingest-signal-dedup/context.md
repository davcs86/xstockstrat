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
