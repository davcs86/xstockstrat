# Feature: backtest-time-window

**Lifecycle Status**: `launched`
**Committed to main**: 67bf345b917b05b869fc67cacff5d74365ba86b8
**Launched date**: 2026-07-28
**Development Branch**: `feature/backtest-time-window` (see context.md — implemented on the
harness-assigned `claude/features-070-071-rnbkqo` branch this session)
**Created**: 2026-07-26
**Last Updated**: 2026-07-26
**Archived**: 2026-08-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-26 | `draft` → (fail) | /sdd-review | FAIL — premise contradicted by code: `RunBacktestRequest.range` already ships end-to-end incl. UI; proposed proto fields would duplicate it |
| 2026-07-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved after re-scope (no proto change; agent plumbing + pre-window warm-up). 7 warnings addressed |
| 2026-07-26 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, quick+1 Floor round) and approved; recon.md + design.md written. R1 BLOCKED on F-07; resolved by deriving the prefix from declared params |
| 2026-07-27 | `design-approved` → `in-progress` | implementation | Steps 1–8 of 8 implemented (warm-up sizing, paged GetBars, `trade_start_idx`, prefix wiring, agent `start`/`end`, parity/determinism suite, docs, UI e2e + C-12 fixture) |
| 2026-07-27 | `in-progress` → `code-completed` | implementation | OQ-1 resolved by user: **keep fail-loud** (AC-4a as designed). No code change followed. CI green on PR #792 — all 28 checks incl. Frontend E2E |
| 2026-08-06 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(0); pruned 3 specs |

| 2026-07-28 | `code-completed` → `launched` | CI workflow | Promoted via PR #797; committed 67bf345b917b05b869fc67cacff5d74365ba86b8 |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver 2026-08-06; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Let the `run_backtest` **MCP tool** accept an explicit `start`/`end` window, and make the engine load
enough pre-window history to warm up indicators before `start`. Unblocks temporal out-of-sample /
walk-forward validation and makes backtest results deterministic across calendar days.

> **Scope corrected at review (2026-07-26).** `RunBacktestRequest.range` already exists
> (`analysis.proto:34`), is honored by the servicer (`servicer.py:273-297`), and is already sent by
> the UI form (`strategies/[id]/page.tsx:91`). **No proto change is required.** The real work is
> (1) plumbing the window through the agent tool/client, and (2) pre-window indicator warm-up.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and change
types. Override as needed for this feature. Snapshot finalized at /sdd-spec time — re-run /sdd-spec
if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, no look-ahead bias; window + indicator warm-up correctness (pre-window history must not leak future data) |
| `xstockstrat-agent` (service owner) | `run_backtest` MCP tool parameter/docstring accuracy, `docs/runbooks/mcp-tools.md` parity |
| `xstockstrat-ui` (service owner) | Backtest form / `BacktestDiagnostics` correctness — the window is already exposed, and the warm-up change alters existing UI-triggered results (FR-6 agent↔UI parity) |

_Proto Reviewer row removed at review: this feature makes no proto change (see product-spec
§Proto Contract Changes)._

## Next Action

Merge PR #792 into `main-dev` (all 28 CI checks green, including Frontend E2E). OQ-1 is resolved —
fail-loud stands, and the implementation already matches it.

Then `/sdd-sync` the spec files, and note for **072**: its recorded "contradictory test" overlap with
071 is resolved rather than merely sequenced — 072's design keeps `client.run_backtest` intact and
splits in `tools.py`, so it no longer needs to invert `tests/test_tools.py:535-577`.
