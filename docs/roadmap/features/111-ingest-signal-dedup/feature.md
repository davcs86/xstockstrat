# Feature: ingest-signal-dedup

**Lifecycle Status**: `draft`
**Development Branch**: `feature/ingest-signal-dedup`
**Created**: 2026-08-07
**Last Updated**: 2026-08-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-07 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec ingest-signal-dedup`_
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
| Proto Reviewer | Field number uniqueness, backward compatibility (only if `ExternalSignal`/`IngestSignalResponse` gain fields) |
| `xstockstrat-config` service owner | Config key naming (`<service>.<category>.<key>`) if a new dedup-window config key is introduced |

## Next Action

`/sdd-review ingest-signal-dedup product-spec` — AI review of product spec before running /sdd-design
