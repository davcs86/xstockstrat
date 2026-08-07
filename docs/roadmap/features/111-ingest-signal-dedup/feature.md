# Feature: ingest-signal-dedup

**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/ingest-signal-dedup`
**Created**: 2026-08-07
**Last Updated**: 2026-08-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-07 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-07 | `draft` → `design-approved` | /sdd-design | Design debated (3 rounds, quick mode + 2 user-requested extensions) and approved; recon.md + design.md written |
| 2026-08-07 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 14 steps |
| 2026-08-07 | `implementation-ready` → `code-completed` | manual execute (harness branch) | All 14 steps implemented directly on `claude/ingest-signal-dedup-ehhgy6` (not via per-step `feature/<slug>` branches — see context.md); 179/179 ingest tests + 201/201 agent tests pass, buf lint/breaking clean |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 14 steps, generated from the approved design
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`IngestSignal` (`xstockstrat-ingest`) unconditionally inserts every submitted signal with no
duplicate check — a documented, unimplemented defect. Add dedup logic so a resubmitted signal
(same source/symbol/direction within a window) does not create a duplicate row or duplicate
downstream side effects (auto-alerts, signal-weighted analysis inputs).

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ingest` service owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `xstockstrat-agent` service owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity |
| Proto Reviewer | Field number uniqueness, backward compatibility for the additive `IngestSignalResponse.deduplicated` field |
| `xstockstrat-config` service owner | Config key naming (`<service>.<category>.<key>`) for the new `ingest.signals.dedup_window_hours` key |
| DBA | Migration `009_signal_dedup_keys` — NNN numbering, hypertable partitioning strategy, index correctness |

## Next Action

Open the integration PR from `claude/ingest-signal-dedup-ehhgy6` to `main-dev` (this feature was
implemented directly on the harness-assigned branch, not `feature/ingest-signal-dedup`, per the
harness's single-branch constraint — see context.md).
