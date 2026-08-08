# Feature: screener-data-readiness-polling

**Lifecycle Status**: `draft`
**Development Branch**: `feature/screener-data-readiness-polling`
**Created**: 2026-08-08
**Last Updated**: 2026-08-08

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-08 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

When a Screener criterion (fundamental or technical) can't be evaluated because its underlying
data isn't available yet, automatically re-check in the background and update the existing
pending badges live, so a user watching the page sees results resolve without manually re-running
the scan.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |
| `xstockstrat-analysis` | Backtest reproducibility, strategy scoring determinism, no look-ahead bias — **conditional**: only if design introduces a new/changed RPC or server-side recheck path; if the design stays client-poll-only against the existing `ScreenSymbols` RPC, this row is not exercised |

## Next Action

`/sdd-review screener-data-readiness-polling product-spec` — AI review of product spec before running /sdd-spec
