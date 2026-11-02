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

`/sdd-execute signal-watchlist-expiry-pruning sequential` — Steps 1-10 can run; Step 11 waits for the operator's 035 ruling (see context.md)
