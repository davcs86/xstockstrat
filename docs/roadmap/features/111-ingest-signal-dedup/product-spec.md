# Product Spec: ingest-signal-dedup

**Created**: 2026-08-07

---

## Problem Statement

`IngestSignal` (owned by `xstockstrat-ingest`, called by the MCP agent's `ingest_signal` tool and
any other gRPC caller) always `INSERT`s into `ingest.newsletter_signals` with no duplicate check.
A resubmission of the same signal — an operator re-running the agent tool, a retried upstream
request after a timeout, or the same signal source resending the same event — creates a duplicate
row today. This is a documented, unimplemented defect
(`services/xstockstrat-ingest/docs/context-constitution-findings.md:12`): the service's own docs
once claimed "skip re-ingesting same symbol+source+direction within this window" but no code ever
enforced it, and the config key that would have driven the window
(`ingest.signals.dedup_window_hours`) was never wired and has since been removed from the docs as
dead. Duplicate signal rows inflate `QuerySignals` results consumed by
`xstockstrat-indicators` (signal-aware formulas) and `xstockstrat-analysis` (signal-weighted
backtests), skewing scoring, and duplicate signals reaching the agent's auto-alert path
(`services/xstockstrat-agent/app/tools.py`) would emit duplicate alerts to the operator.

## User Story

As an operator ingesting trading signals through the MCP agent's `ingest_signal` tool (or any
other `IngestSignal` gRPC caller), I want duplicate signal submissions to be detected and
deduplicated so that duplicate signals don't create duplicate downstream side effects (duplicate
alerts, duplicate backtest/strategy scoring inputs, or skewed signal-weighted analysis).

## Functional Requirements

FR-1. `IngestSignal` MUST detect a duplicate submission before insert, defined as a signal
matching an existing `ingest.newsletter_signals` row on the natural key
`(source, symbol, direction)` with `valid_from` within a configurable dedup window, and MUST NOT
insert a second row for it.

FR-2. The dedup window MUST be driven by a config key in the `ingest.*` namespace (reviving the
intent of the previously-dead `dedup_window_hours` key, renamed/renumbered as needed to fit
current config governance) with a sane default, watched via the existing `WatchConfig` stream —
no hardcoded window.

FR-3. On a detected duplicate, `IngestSignalResponse` MUST return the **existing** signal's id
(not mint a new one) so callers get a stable, idempotent response, and the response MUST
distinguish a deduplicated submission from a freshly-inserted one (e.g. an additive
`deduplicated` bool field) so callers — including the MCP agent's auto-alert path — can suppress
duplicate downstream side effects.

FR-4. The MCP agent's `ingest_signal` tool MUST surface the dedup outcome in its returned payload
and MUST NOT emit a duplicate auto-alert when the signal was deduplicated.

FR-5. The dedup check MUST be implemented in `xstockstrat-ingest` (the state-owning service),
not solely in the MCP agent, so that duplicate protection applies to every `IngestSignal` caller,
not just the agent. (Ledger `insights.md` 2026-08-06 fundamentals-signal-producer: "the
idempotency guard belongs in the caller's own state table keyed on its natural key" — here
`xstockstrat-ingest` is that state-owning layer relative to any `IngestSignal` caller.)

FR-6. `docs/runbooks/mcp-tools.md` and `services/xstockstrat-ingest/CLAUDE.md` MUST be updated to
document the dedup behavior and the new config key, so the historical doc-vs-code drift this
feature fixes does not recur.

## Out of Scope

- Deduplicating across sources that describe the same real-world event with different
  source/symbol/direction text (semantic/fuzzy dedup). This feature is exact-match on the natural
  key only.
- Retroactively deduplicating existing rows already in `ingest.newsletter_signals`.
- Changing `QuerySignals` to `DISTINCT` or otherwise collapse rows — once dedup is enforced at
  write time, no duplicate rows should exist going forward, so the read path needs no change.
- Cross-restart request-level idempotency keys (e.g. a client-supplied UUID token) — the natural
  business key is sufficient per FR-1; a token-based mechanism is a heavier pattern (see the
  ledger's `xstockstrat-ledger` `idempotency_keys` precedent) not justified by this problem.

## Affected Services

- `xstockstrat-ingest` — owns `IngestSignal`, the `ingest.newsletter_signals` table, and the new
  dedup config key.
- `xstockstrat-agent` — the `ingest_signal` MCP tool consumes `IngestSignalResponse` and must
  react to the new `deduplicated` field for its auto-alert suppression.
- `packages/proto` — `IngestSignalResponse` gains an additive `deduplicated` field (non-breaking).

## Consumer Surface(s)

- [ ] **UI** — none.
- [x] **Agent** — `xstockstrat-agent` MCP tool: `ingest_signal` (response mapping changes: surfaces
  whether the submission was deduplicated; suppresses the auto-alert side effect on a duplicate).
- [ ] **None**.

## Proto Contract Changes

- Add `bool deduplicated = 2;` to `IngestSignalResponse` (`packages/proto/ingest/v1/ingest.proto`).
  Additive, non-breaking field addition to an existing message.

## Config Key Changes

- New key: `ingest.signals.dedup_window_hours` (int, default TBD by `/sdd-design` — likely 24h,
  matching the historical documented intent) — the window within which a matching
  `(source, symbol, direction)` signal is treated as a duplicate of an existing row.

## Database Changes

- [ ] No schema changes
- Open question for `/sdd-design`: whether the dedup check is a read-then-conditional-insert
  (application-level `SELECT ... FOR UPDATE`-guarded check) or backed by a partial/expression
  index to make the check efficient and race-safe under concurrent `IngestSignal` calls. No new
  table is needed either way; at most a supporting index migration.

## Feature Workflow Notes

Branch to create: `feature/ingest-signal-dedup` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto change — additive field only)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, additive only
- [ ] DBA review + service owner (schema migration) — only if `/sdd-design` picks an index-migration approach

## Acceptance Criteria

1. Submitting the same `(source, symbol, direction)` signal twice within the dedup window via
   `IngestSignal` results in exactly one row in `ingest.newsletter_signals`; the second call's
   response carries `deduplicated=true` and the same `signal_id` as the first.
2. Submitting the same natural key again *outside* the dedup window (or with a different
   `direction`) is treated as a new signal and inserted normally.
3. The MCP agent's `ingest_signal` tool does not emit a duplicate auto-alert when
   `IngestSignalResponse.deduplicated=true`.
4. `ingest.signals.dedup_window_hours` is documented in `services/xstockstrat-ingest/CLAUDE.md`,
   watched via `WatchConfig`, and has a working default with no config service running.
5. `docs/runbooks/mcp-tools.md`'s `ingest_signal` entry documents the new `deduplicated` field.
6. `services/xstockstrat-ingest/docs/context-constitution-findings.md`'s "Dedup key" row is
   corrected or removed now that the behavior is implemented (per the CLAUDE.md Teardown rule).

## Open Questions

- [ ] Exact default for `ingest.signals.dedup_window_hours` — `/sdd-design` to confirm a sane
  default (candidate: 24h, matching the historical documented intent recorded in
  `context-constitution-findings.md:12`).
- [ ] Whether the dedup check should also match on `raw_url` (when present) as an alternative
  duplicate signal, in addition to the `(source, symbol, direction, valid_from-in-window)` key —
  `/sdd-design` to weigh against Out-of-Scope (exact-match only, no fuzzy matching).
- [ ] Known trap (ledger 2026-08-06, `086-fix-mcp-formula-lifecycle` / general C-10(b) pattern):
  whatever dedup signal is added to `IngestSignalResponse` must be honestly surfaced by *every*
  path that returns signal data the agent or a future UI might read from, not just the
  freshly-inserted path — verify at design time.
