# Feature: signal-watchlist-expiry-pruning

**Development Branch**: `feature/signal-watchlist-expiry-pruning`
**Created**: 2026-10-31
**Last Updated**: 2026-11-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-31 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-10-31 | `draft` → `design-approved` | /sdd-design | Design debated (4 rounds, quick mode user-extended) and approved; recon.md + design.md written. Skipped /sdd-review (operator-confirmed proceed-from-draft); product-spec.md + acceptance.feature rewritten post-design (FR-2/FR-3 narrowed by user sign-off; AC-1..AC-18). Renumbered 280 → 281 (collision with `280-smoke-check-runtime`). |
| 2026-10-31 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 21 steps |
| 2026-11-02 | `implementation-ready` (unchanged) | /sdd-design (quick, amendment) | Seed-key amendment approved after 3 rounds: config migration 035 in Step 11 with the reader, Step 14 parse test, @AC-19; Steps 11-14 and 20 re-specced |
| 2026-11-02 | `implementation-ready` (unchanged) | /sdd-execute (re-spec) | After merging `origin/main-dev` (incl. 278): Steps 4, 10, 17, 18, 20, 21 anchors re-aligned; Step 11 records a BLOCKING config-migration 035 collision with `origin/claude/smoke-test-deployment-0f1z5j` (operator ruling needed before Step 11) |
| 2026-11-02 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Execution started; operator gave the up-front sequential confirmation |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 1 done: `WatchlistSignalProvenance` + `AddWatchlistSymbolsRequest.signal_provenance = 4`; `buf lint`/`buf breaking` vs `origin/main-dev` clean |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 2 done: stubs regenerated with `./scripts/buf-gen.sh` in the `xstockstrat-codegen` image; only `portfolio/v1` outputs changed (Go, Python, TS + `gen/ts/dist`); second run a no-op |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 3 done: portfolio migration `018_watchlist_signal_expiry` up/down pair (new table + `valid_until` index, FK to `watchlists` only); offline verification, no database started |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 4 done: `//go:build dbtest` real-Postgres harness + `TestSignalExpirySchema`, `.golangci.yml` `build-tags: [dbtest]`, CI job `portfolio-db-test` wired into `ci-gate`; offline vet/lint green, DB run in CI |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 5 done: repo add path — `SignalProvenance`/`ExpiryIntent`, split `insertBindingTx`, overwrite-on-fresh-insert / update-only `mergeSignalExpirySQL` / untrack; `AddSymbols` takes the intent (service passes the zero value); build/vet/lint green |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 6 done: 7 `TestAddPath_*` real-DB tests (fresh overwrite, merge, untracked, rescue, MANUAL, untrack, replace-all; AC-3/8/9/11/17); compile-RED vs pre-Step-5 repo, offline vet/lint/cover green, DB run in CI `portfolio-db-test` |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 7 done: `AddWatchlistSymbols` validates `signal_provenance` (system list, exactly one SIGNAL binding, `signal_id > 0`, `valid_until` set) via `expiryIntentFor` before the cap check and any write, and passes the intent to `AddSymbols`; provenance-less SIGNAL adds untrack; RED probe → GREEN, build/vet/lint/tests green |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 8 done: `ProvenanceValidation` (5 AC-18 rejections, no store call), `ProvenanceTracksIntent`, `NoProvenanceIntent`; fake records the last `ExpiryIntent` + call count; RED vs pre-Step-7 service → GREEN, lint 0 issues, cover 68.6% |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 9 done: `WatchlistRepo.PruneExpiredSignalEntries` (per-list never-waiting `SKIP LOCKED` tx, deletes only the locked SIGNAL bindings, sweeps expired orphans, returns `PruneResult`/`PrunedEntry`); `WatchlistStore` method + configurable fake; RED probes → GREEN, build/vet/dbtest-vet green, lint 0 issues |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 10 done: 9 `TestPrune_*` real-DB tests (AC-2/3/4/5/6/8/10/12 + strategy-bound); compile-RED vs pre-Step-9 tree, offline vet/lint/cover green, DB run in CI `portfolio-db-test` |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute (re-spec) | Seed migration renumbered 035 → 037 (feature 280 holds 035/036); 281 merges after 280 |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 11 done: `signal_prune.go` prune loop (startup tick, live clamped interval), owner-visible `signal_entry_expired`/`signal_entry_removed_untracked` events via `emitEventAs` (+ per-tick `x-trace-id`), goroutine wired in `main.go`, config seed `037_portfolio_signal_prune_interval` in the same commit; `--final` key hits 0 / introduced 0, lint 0 issues |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 12 done: 7 prune service unit tests (`TestClampPruneInterval`, `TestSignalPrune_*`: expired/renewed/untracked payloads, owner `UserId`, per-tick `x-trace-id`, best-effort ledger error, no-op tick, interval default/config clamp — AC-6/7/8/13/14); `fakeLedger` captures requests + outgoing metadata; RED compile-fail → GREEN, lint 0 issues, GO-COVER 68.6% |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 13 done: `SCALAR_BOUNDS_REGISTRY` entry `portfolio.watchlist.signal_prune_interval_seconds` `{ minValue: 60, maxValue: 86400 }` (mirrors the reader clamp); lint 0 errors, step-time wiring gate rc 0, `--final` rc 0 with nothing for this key |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 14 done: `TIMEOUT_KEY_FORMS` rows for the prune interval in both key-column forms + explicit `0` rejection (AC-14); shared `migrationSql.ts` helper (zeroTrap refactored onto it); 5-case `signalPruneIntervalSeedMigration.test.ts` for the 037 seed (AC-19); RED `# fail 5` / bounds RED 3 fails → GREEN 9/9, full suite 272 pass, coverage 90.61% |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 15 done: `portfolio backfill-signal-expiry` subcommand. Thin `cmd/server/backfill.go` handles the `DATABASE_URL` refusal (exit 2), the `target host= db=` line and exit codes. `repository.RunBackfill` holds the logic: `BackfillOptions`/`BackfillResult`/`ErrBackfillRefused`, legacy-owner and APPLY-bound refusals before any write, one read-only snapshot for classification, REPORT SEED/UNTRACKED/PER-OWNER/NEXT, APPLY one autocommit `ON CONFLICT DO NOTHING` per row, recomputed at statement time. The CLI never deletes. RED compile-fail probes → GREEN; build/vet/vet-dbtest OK, offline refusal check OK, lint 0 issues |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 16 done: 9 `TestBackfill_*` real-DB tests (REPORT read-only, bound/legacy-owner/nil-bound refusals with zero writes, AC-15 `" aapl"` seed, AC-16 strict untracked mark → tick removal with nil `SignalID`/`strat-3`, AC-17 live rescue vs past renewal, open-ended stays untracked, idempotent re-run, T4 ingest-interleaving race); compile-RED vs pre-Step-15 tree, offline vet/lint/cover green (68.6%), DB run in CI `portfolio-db-test` |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 17 done: agent `add_watchlist_symbol` sends `signal_provenance` (signal_id, valid_until) only for a dated, parseable `valid_until` with seconds > 0 (bad strings drop the provenance, never the add); `ingest_signal` passes `result["signal_id"]` + `valid_until`; `ingest_signal`/`get_watchlist` docstrings gain the expiry/pruned-set sentences; tool count stays 45. Probe RED/GREEN; ruff green; PY-VERIFY 641/642 (the one failure is the old call-shape assertion Step 18 updates) |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 18 done: agent provenance tests — 3 client request-builder tests (provenance `(102, 2026-12-01)`; none for open-ended / no signal_id / empty / unparseable, with the add still sent, SIGNAL binding, single `x-user-id`), tool path updated to `("u-2","wl-sys","NVDA",1,None)` plus signal_id+valid_until, open-ended and swallowed-`INVALID_ARGUMENT` cases, doc parity asserts expiry. RED 9 failed vs pre-Step-17 app → GREEN 26/26; PY-VERIFY 650 passed, coverage 84.49% |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 19 done: UI e2e `system-managed watchlist emptied by expiry pruning: renders "No symbols", no delete affordance (AC-2)` in `e2e/insights/watchlists.spec.ts`. It seeds `wl-sys` with empty `bindings`/`symbols` through the existing `mockWatchlists`, then asserts `No symbols` is visible, `Delete Signals` has count 0, Rename is visible and the add-symbols input is enabled. TDD N/A (regression guard). Passed under `CI=1` (2/2); the local dev-server warmup timed out (Deviation Log). No fixture added, so INVENTORY is unchanged |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 20 done: docs. Portfolio `CLAUDE.md` gains the `signal_prune_interval_seconds` key row (seeded by `037_portfolio_signal_prune_interval`), the two prune events, the `watchlist_signal_expiry` table, the prune-loop paragraph and the `backfill-signal-expiry` subcommand. The portfolio constitution gains `PORTFOLIO-17` and an amended `PORTFOLIO-7` (`insertBindingTx` / `ExpiryIntent`), with the watchlist anchors re-stamped. Also added: the `database.md` plain-table note and the config-governance feature 281 entry with its `feature 278 interaction` note. Agent `CLAUDE.md` is unchanged. TDD N/A; the verification block is green (`check-context-map.sh` OK) |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 21 done: docs. New runbook `docs/runbooks/signal-watchlist-expiry-backfill.md` covers scope and strictness, authority, the pooled `:25061` connection, the ingest SELECT preflight, REPORT/APPLY, how to read `NO_OWN_SIGNALS`/`legacy_live`/`seed_expired`, no grace period, emergency stop and undo, residuals, and deploy order. Also: a runbooks index row, `mcp-tools.md` expiry sentences in `ingest_signal`/`get_watchlist` plus the error rows, the portfolio `CLAUDE.md` runbook link and the `ci-overview.md` `portfolio-db-test` row. The context-forge `context-constitution` skill is unavailable, so the teardown was a manual reconciliation (no drift found). TDD N/A; verification green |
| 2026-11-02 | `in-progress` (unchanged) | /sdd-execute sequential | Step 22 done: premise evidence (FR-1 / AC-1). `recon.md` § Premise Verdict is present with `path:line` citations (10 matching lines, threshold 4). Line drift in agent `tools.py` (pre-feature) and the portfolio service/repo (Steps 5-11) is recorded in `context.md`, and `recon.md` is unedited. TDD N/A; verification green |
| 2026-11-02 | `in-progress` → `code-completed` | /sdd-execute sequential (ALL-DONE) | 22/22 steps done; `--final` config-wiring gate rc 0. C-16 promotion: AC-2..AC-18 → portfolio suite, @AC-19 → new config suite, AC-1 skipped (premise check). Integration PR opened against `main-dev`. Do not merge it before 280's #1359 |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier; **Premise Verdict** (FR-1)
- [Design](design.md) — debated, user-approved architecture, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 21 numbered steps with codebase evidence and AC coverage map
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Signals carry a `valid_until` expiry, but the entries that feature 127 auto-added to the per-user system-managed signal watchlist (`source = SIGNAL`) are never removed once the backing signal expires (**confirmed by recon**; an entry also has no link to its signals). The agent now stamps signal provenance on the add into a portfolio side table, and an in-process portfolio prune loop removes entries whose agent-recorded watchlist signals have all expired; a one-shot DBA-reviewed operator backfill seeds/marks the existing backlog. Analysis opportunities and ingest rows are out of scope (premise refuted / by design).

## Reviewers

_(Snapshot finalized at /sdd-spec time — re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, additive-only `AddWatchlistSymbolsRequest.signal_provenance = 4`, `buf lint`/`buf breaking` (Steps 1-2) |
| DBA | Migration `018` numbering, up+down pair, index correctness; reviews backfill REPORT before any APPLY (Steps 3, 15, 16) |
| Service owner `xstockstrat-portfolio` | P&L calculation accuracy, position snapshot consistency, concurrent write safety (Steps 4-12, 15-16) |
| Service owner `xstockstrat-agent` | MCP tool contract stability, `docs/runbooks/mcp-tools.md` parity, tool count unchanged at 45, statelessness (Steps 1-2, 17-18) |
| Service owner `xstockstrat-config` | Config key naming, scoping, WatchConfig stream stability (Steps 13-14) |
| Service owner `xstockstrat-ui` | System-managed watchlist display correctness, no direct DB access (Step 19) |

## Next Action

`/sdd-execute signal-watchlist-expiry-pruning sequential` — Steps 1-22 done (seed migration `037_portfolio_signal_prune_interval` landed with its reader, operator ruling 2026-11-02); next is the final integration PR. 281's integration PR merges only after feature 280 (#1359), re-running Step 11 block 2 with `MERGE_TIME=1` at merge time.
