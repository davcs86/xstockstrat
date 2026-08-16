# Feature: daily-bars-only

**Development Branch**: `feature/daily-bars-only`
**Created**: 2026-08-16
**Last Updated**: 2026-08-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-16 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-16 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings: Open Questions deferred to design per repo precedent, minor template checkbox hygiene) |
| 2026-08-16 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, quick mode + 1 extra round) and approved; recon.md + design.md written. Recon corrected product-spec.md's Affected Services/Consumer Surface(s) (added xstockstrat-ingest, xstockstrat-agent) |
| 2026-08-16 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 10 steps. Corrected 3 design.md inaccuracies found via direct grep verification (a doc file wrongly named as needing edits; a shared UI const needing a split, not a uniform narrowing; 3 more breaking tests than design.md's 4-test list covered) |
| 2026-08-16 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential-mode execution started on `feature/daily-bars-only`. Re-spec gate passed (all 10 steps' evidence, incl. Step 9 vs feature 125's landed symbol page, validated clean — no re-spec). Step 1 (proto deprecation) done. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md) — 10 steps across proto, xstockstrat-marketdata, xstockstrat-ingest, xstockstrat-agent, xstockstrat-ui
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Strip platform-wide support for non-daily OHLCV timeframes (`15m`/`1h`): restrict
`GetBars`/`BackfillBars`/the always-on bar ingester to `1d` only, and remove the UI's
15-minute/1-hour chart timeframe options — since no trading-path consumer (the live loop,
screener technical criteria, default SMA strategy) ever evaluates anything but daily bars.

## Reviewers

_(Snapshot finalized by /sdd-spec from docs/runbooks/reviewer-registry.md, based on the
`**Reviewers**` field of every step in implementation-spec.md. Stable unless /sdd-spec re-runs.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-marketdata` service owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |
| `xstockstrat-ui` service owner | Trading UI correctness, Connect-RPC call safety |
| `xstockstrat-ingest` service owner | Signal normalization correctness, idempotent ingestion — its own timeframe alias tables (`_STR_TO_ENUM`/`_TF_ALIASES`) proxy to `BackfillBars` |
| `xstockstrat-agent` service owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity |
| Proto Reviewer | Field number uniqueness, backward compatibility (no field removal or type change without deprecation), naming conventions — the `Timeframe` enum deprecation-comment step (Step 1) |

## Next Action

`/sdd-review daily-bars-only impl-spec` — validate implementation spec, then `/sdd-execute daily-bars-only`
