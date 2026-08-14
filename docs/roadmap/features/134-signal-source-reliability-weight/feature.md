# Feature: signal-source-reliability-weight

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/signal-source-reliability-weight`
**Created**: 2026-08-13
**Last Updated**: 2026-08-14

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-13 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-13 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning) |
| 2026-08-13 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved; recon.md + design.md written |
| 2026-08-14 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 11 numbered steps with codebase evidence
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
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` (Steps 1–2) |
| DBA | Migration NNN numbering (no gaps/conflicts), up+down pair present, column default/CHECK correctness (Steps 3, 10) |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability (Steps 1–5) |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias (Steps 6–7, 11) |
| `xstockstrat-ui` owner | Config mutation safety, Connect-RPC call safety, no direct DB access (except audit log) (Steps 8–9) |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability (Step 10) |

## Next Action

`/sdd-review signal-source-reliability-weight impl-spec` — validate implementation spec, then `/sdd-execute signal-source-reliability-weight`
