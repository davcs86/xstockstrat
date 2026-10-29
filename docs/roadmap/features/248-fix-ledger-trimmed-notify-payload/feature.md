# Feature: fix-ledger-trimmed-notify-payload

**Type**: bug
**Development Branch**: `feature/fix-ledger-trimmed-notify-payload`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-ledger-stream-trimmed-notify-payload-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-ledger-stream-trimmed-notify-payload-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings; overlap WARN: sequencing on 252) |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved under operator standing authorization; recon.md + design.md written |
| 2026-10-21 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps. Product spec amended per design.md § Chosen Approach 7 (FR-2 → LISTEN-connection PK read; Fix Scope → one config key `ledger.stream.resolve_timeout_ms`); AC-9 appended to acceptance.feature (C-15) |
| 2026-10-28 | `implementation-ready` (re-spec) | /sdd-execute sequential | Re-spec §5.3 on merged-up tree `fe047901`: config migration renumbered `032` → `033` (244 holds `032`, 243 `031`, 264 reserves `034`); Step 1 adds a 248-after-244 row; Step 9 CI anchors re-grepped; 252 precondition re-checked and still NOT met (Steps 3-11 blocked) |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Execution started under operator standing authorization (operator chat 2026-10-28, session_01NpS3HShZK6pSnogA7CFo2f); Step 3 onward held on the unmet 252 precondition |
| 2026-10-28 | `in-progress` (Step 1 done) | /sdd-execute sequential (sdd-batch-execute) | Step 1: three Blocking Dependencies rows appended to `merge-order.md` (248 after 252, 243, 244); Steps 3-11 still held on the unmet 252 precondition |
| 2026-10-28 | `in-progress` (Step 2 done) | /sdd-execute sequential (sdd-batch-execute) | Step 2: config `033_ledger_stream_resolve_timeout.{up,down}.sql` seeds `ledger.stream.resolve_timeout_ms` (int, 2000, staging + production); Steps 3-11 still held on the unmet 252 precondition |
| 2026-10-29 | `in-progress` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | Re-spec §5.3 on merged-up tree `b6e518a7` (merge with `origin/main-dev` `8082157a`: already up to date; ledger-guard clean): Steps 3-11 aligned with the current codebase; the 252 precondition is now met (252 `code-completed`, `tsc && node --test dist/` runner, test exclude gone, 0 skip guards), so Steps 3-9 are unblocked; drifted test-file, `index.ts`, `ci.yml` and docs anchors re-grepped |
| 2026-10-29 | `in-progress` (Step 3 done) | /sdd-execute sequential (sdd-batch-execute) | Step 3: `services/xstockstrat-ledger/src/services/eventRowResolver.ts` created (`RESOLVE_TIMEOUT_KEY`, `streamResolveTimeoutMs`, `resolveEventRow`, `makeListenerClient`, `makeResolveRow`); not wired yet (Step 5) |
| 2026-10-29 | `in-progress` (Step 5 done) | /sdd-execute sequential (sdd-batch-execute) | Step 5: `EventNotifier` resolve-once FIFO (`queue`/`drain`/`gen`, `{ resolveRow }` opts, required `onGap`, wedged-listener teardown); `streamEvents` `onGap` → `call.destroy({code: 13\|14})` plus post-replay `cleaned` guard; `index.ts` wired via `makeListenerClient`/`makeResolveRow`. 7 legacy `eventNotifier.test.ts` cases red until Step 6 migrates them |
| 2026-10-29 | `in-progress` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | Re-spec §5.3 after Step 5 on merged-up tree `bf0cedc2` (normal merge of `origin/main-dev`, no conflicts; ledger-guard clean): Step 6 `makeRecordingCall` `opts` now accepts a positional `userId` string (the 7 `exportEvents` sites pass `'u_42'` positionally) and anchors refreshed; Steps 7, 9, 11 anchors re-grepped (Step 9 places `ledger-db-test` after the new `migration-contract-gate` job) |
| 2026-10-29 | `in-progress` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | Re-spec on resume (merge of `origin/main-dev` already up to date; ledger-guard clean): Step 6 anchors `LedgerServiceImpl` class `:19`/constructor `:20`, `buffer.push(row)` `:207`; Step 11 `test-data-inventory.md` `:74-75`. Line drift only, instructions unchanged |
| 2026-10-29 | `in-progress` (Step 6 done) | /sdd-execute sequential (sdd-batch-execute) | Step 6: tier (i) notifier cases (AC-2/3/6/7/8/9, late/removed subscriber, queue clear on reconnect/stop, stale-drain guard, warn + no unhandled rejection), tier (ii) `streamResolveWired.test.ts` (AC-1/4/5) and tier (iii) `streamEvents` `onGap` cases; C-13 fixture home `src/__tests__/fixtures/` (`ledgerEvents.ts`, `streamCall.ts`, `INVENTORY.md`). Suite 79/79 pass, coverage 86.38% lines |
| 2026-10-29 | `in-progress` (Step 7 done) | /sdd-execute sequential (sdd-batch-execute) | Step 7: `streamEvents` normalises `sequence` with `Number()` (the `maxSeq` seed, `writeRow`, live `onEvent`, buffer flush), so pg-string `BIGINT` sequences compare numerically. The RED/GREEN probe was uncommitted. Suite 79/79 pass, coverage 86.39% lines |
| 2026-10-29 | `in-progress` (Step 8 done) | /sdd-execute sequential (sdd-batch-execute) | Step 8: tier (iii) `streamEvents` sequence-normalisation cases (AC-2 replayed `"98"`/`"99"` then resolved `"100"` with no NOTIFY duplicate; AC-5 buffered `"100"` flushed once) and a string-`int64` encode/decode case. RED against pre-Step-7 source. Suite 82/82 pass, coverage 86.39% lines |
| 2026-10-29 | `in-progress` (Step 9 done) | /sdd-execute sequential (sdd-batch-execute) | Step 9: real-TimescaleDB tier (iv). Adds the `test:db` script, `src/__tests__/db/streamResolve.db.test.ts` (AC-1 trigger round-trip plus one chunk and one row, AC-6/AC-7 replay recovery, AC-9 `statement_timeout`), and the `ledger-db-test` CI job, which is also in `ci-gate`. The RED was not captured because the DB is CI-only. The GREEN is owed on the integration PR's `ledger-db-test` run. Unit suite 82/82, coverage 86.39% lines |
| 2026-10-29 | `in-progress` (Step 10 done) | /sdd-execute sequential (sdd-batch-execute) | Step 10: consumer verification with no code change. Portfolio `consumeEventStream`/`streamEventsFrom` and analysis `PnLPatternConsumer.run_forever` still reconnect and replay on a non-OK end, and advance the cursor only after the handler. Portfolio `go test -race` passed with total 68.6% (smoke check; `/service` is excluded), and `TestStreamEventsFrom_HandlerError_DoesNotAdvanceCursor` passed. Analysis pytest passed 1296 with the 4 `real_pg` tests deselected |

---

## Reviewers

Canonical snapshot from `docs/runbooks/reviewer-registry.md`, written by /sdd-spec on 2026-10-21 (per-step assignments in `implementation-spec.md`).

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ledger` owner | Append-only invariant (no deletes or updates), event ordering, hypertable partition safety | 3, 4, 5, 6, 7, 8, 9 |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability | 2 |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh` | 2 |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 10 (consumer verification only) |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 10 (consumer verification only) |
| Config team | New config key approval (root `CLAUDE.md` § Approval Flow) | Pre-merge gate for `ledger.stream.resolve_timeout_ms` (integration PR) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 codebase dossier
- [Design](design.md) — debated, approved approach (3 rounds, full), rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 11 numbered steps with evidence, per-step reviewers, scenario coverage
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Live `StreamEvents` forwards the trigger's trimmed NOTIFY stub (no `payload`, no `occurred_at`) for events whose
`row_to_json` exceeds 7000 chars, so live consumers (analysis, portfolio) process an empty payload and an Invalid
`occurredAt`, then advance their cursor past the event.

## Next Action

`/sdd-execute fix-ledger-trimmed-notify-payload sequential` — Step 11 next (docs teardown: invariants, CLAUDE.md, findings, config log, CI table)
