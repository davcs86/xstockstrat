# Feature: signal-source-reliability-weight

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/signal-source-reliability-weight`
**Created**: 2026-08-13
**Last Updated**: 2026-08-13

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-13 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-13 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec signal-source-reliability-weight`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Makes signal-source reliability a first-class property of `ingest.SignalSource` and applies it when
the analysis opportunities queue (`ListOpportunities`, feature 097) ranks candidates by `signal_axis`,
which today uses raw unweighted `signal.conviction`.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-ui` owner | Config mutation safety, Connect-RPC call safety, no direct DB access (except audit log) |

## Next Action

`/sdd-spec signal-source-reliability-weight` — generate implementation spec
