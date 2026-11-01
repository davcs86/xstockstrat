# Feature: fix-ledger-query-pagination

**Type**: bug
**Development Branch**: `feature/fix-ledger-query-pagination`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-ledger-query-pagination-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-29
**Committed to main**: 0cfaa489cfafbf3f899e01cfeb42f4d6bbadf384
**Launched date**: 2026-10-31

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-ledger-query-pagination-defect.md` (debt-radar D-13, D-27, D-46) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings; overlap WARN with 248, 251, 263) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Operator signed off FR-1/FR-7/AC-5 late-commit wording and FR-5 max-cumulative pass 2; 263 merges first |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps; product-spec FR-1/FR-4/FR-5/FR-6/FR-7 and acceptance AC-1/AC-5 restated per operator sign-off (a)/(b) |
| 2026-10-29 | `implementation-ready` (re-spec) | /sdd-execute | Steps 1–9 re-spec'd against the main-dev-merged tree (263/252/248 in); Step 8 moved from a manual real-TimescaleDB run into the CI real-DB tier (`src/__tests__/db/queryPagination.db.test.ts`, job `Ledger DB test (TimescaleDB)`), operator decision 2026-10-29 |
| 2026-10-29 | `implementation-ready` → `in-progress` | /sdd-execute | `sequential` mode via `/sdd-batch-execute`; up-front confirmation by the operator's standing authorization (operator chat 2026-10-28/29, session_01NpS3HShZK6pSnogA7CFo2f), checkpoints `report` |
| 2026-10-29 | `in-progress` | /sdd-execute | Step 1 done (docs): merge-order row 257←263 reworded (257 adds no `QueryEventsRequest` field) and the 257 rolling-deploy note added under the Blocking Dependencies table |
| 2026-10-29 | `in-progress` | /sdd-execute | Steps 2+3 done (one commit, operator 2026-10-30 "A: Fix in same commit"): ledger `queryEvents` keyset token on `sequence`, 100/1000 page clamp, `toSeq`/`parseSequenceToken`; keyset/cap/default/bad-token tests; 263 exact-SQL expectations moved to `ORDER BY sequence ASC` |
| 2026-10-29 | `in-progress` | /sdd-execute | Steps 4+5 done (one commit, operator 2026-10-30 "A: Include the fake fix"): ledger `streamEvents` bounded `REPLAY_BATCH_SIZE` 1000 replay up to a post-subscribe `MAX(sequence)` bound, `waitForDrain` backpressure, BigInt `maxSeq`; FIFO-interleave/dedupe/drain/cancel/error tests, 248 streamEvents fakes adapted |
| 2026-10-29 | `in-progress` | /sdd-execute | Steps 6+7 done (one commit, standing merge-pairs rule): portfolio `GetPnL` fails closed (`ErrLedgerUnavailable` → `UNAVAILABLE`), rejects a repeated page token, pages at 1000 via one `collectFills` walk, keeps the largest \|cumulative `FilledQty`\| partial; AC-3/AC-4/AC-6 paging tests, mirror + classifier tests |
| 2026-10-30 | `in-progress` | /sdd-execute | Step 8 done (code-side): `queryPagination.db.test.ts` (AC-1 real-pg token walk, AC-5 non-starvation over `max: 1` pool) added to the CI real-DB tier; `test:db` runs with `--test-concurrency=1` (operator 2026-10-30 "A: --test-concurrency=1"). Verified by CI job `Ledger DB test (TimescaleDB)` going green |
| 2026-10-30 | `in-progress` | /sdd-execute | Step 9 done (docs): ledger CLAUDE.md invariant 4 (may gap) + subscribe-first batched-replay order + `QueryEvents` token line, ledger constitution `LEDGER-9` (LEDGER-5 amended, line hints re-stamped), portfolio CLAUDE.md `ErrLedgerUnavailable` -> `UNAVAILABLE`; teardown reconciled by hand |
| 2026-10-29 | `in-progress` → `code-completed` | /sdd-execute | All 9 steps done; C-16 promotion applied; integration PR to `main-dev` opened. Step 8 is verified by CI job `Ledger DB test (TimescaleDB)` going green |

| 2026-10-31 | `code-completed` → `launched` | CI workflow | Promoted via PR #1387; committed 0cfaa489cfafbf3f899e01cfeb42f4d6bbadf384 |
---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22), from the per-step `**Reviewers**` lines.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ledger` owner | Append-only invariant (no deletes or updates), event ordering, hypertable partition safety | 2, 3, 4, 5, 8 |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 6, 7 |
| DBA | Only if Step 8 fails and the remedy is ledger index migration `004` (C-07; re-spec required) | Conditional |
| Proto Reviewer | Not required: no `.proto` change (no `QueryEventsRequest` field added) | — |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 codebase dossier
- [Design](design.md) — approved design (chosen approach, rejected alternatives, open risks)
- [Implementation Spec](implementation-spec.md) — numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Ledger `QueryEvents` emits `nextPageToken` but never reads `pageToken` (D-13). Portfolio `GetPnL` pages it, so it
re-reads page 1 until the deadline and returns an inflated realized P&L as success (D-46). The `StreamEvents` replay
is one unbounded query on ledger's single-connection pool (D-27). **Sequence before or with
`251-fix-getpnl-source-service`**: fixing 251 alone exposes D-46.

## Next Action

`/sdd-review fix-ledger-query-pagination impl-spec` — validate implementation spec, then `/sdd-execute fix-ledger-query-pagination` (only after 263 and 252 are merged into `main-dev` and this branch is merged up; Step 1 writes the merge-order rows)
