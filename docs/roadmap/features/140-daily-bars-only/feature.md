# Feature: daily-bars-only

**Lifecycle Status**: `draft`
**Development Branch**: `feature/daily-bars-only`
**Created**: 2026-08-16
**Last Updated**: 2026-08-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-16 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec daily-bars-only`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Strip platform-wide support for non-daily OHLCV timeframes (`15m`/`1h`): restrict
`GetBars`/`BackfillBars`/the always-on bar ingester to `1d` only, and remove the UI's
15-minute/1-hour chart timeframe options — since no trading-path consumer (the live loop,
screener technical criteria, default SMA strategy) ever evaluates anything but daily bars.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-marketdata` service owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |
| `xstockstrat-ui` service owner | Trading UI correctness, Connect-RPC call safety |
| Proto Reviewer | Field number uniqueness, backward compatibility (no field removal or type change without deprecation), naming conventions — applies if `Timeframe` enum values are touched (deprecation comments, request-time rejection) |
| Platform Lead | Cross-service architecture — this spans marketdata's RPC surface, config, and the UI in one behavior removal |

## Next Action

`/sdd-review daily-bars-only product-spec` — AI review of product spec before running /sdd-spec
