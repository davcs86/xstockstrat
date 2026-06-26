# Feature: fundamentals-data-source

**Lifecycle Status**: `draft`
**Development Branch**: `feature/fundamentals-data-source`
**Created**: 2026-06-26
**Last Updated**: 2026-06-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-26 | `idea` → `draft` | /sdd-story | Product spec generated (feature 2 of 6 in the screener initiative) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fundamentals-data-source`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add Financial Modeling Prep (FMP) as a fundamentals data source in `xstockstrat-marketdata` via a new
`FundamentalsSource` client, a `GetFundamentals`/`GetFundamentalsMulti` RPC, and a DB-backed per-symbol
cache that respects FMP's 250-req/day free-tier ceiling. This is the single FMP chokepoint for the
whole initiative. Backend only.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Additive `GetFundamentals`/`GetFundamentalsMulti` RPC + messages, field-number uniqueness, `buf` pass |
| `xstockstrat-marketdata` (service owner) | Source-registry integrity (Alpaca path untouched), OHLCV ingestion unaffected, cache correctness, quota guard |
| DBA | New `marketdata.fundamentals` table, index correctness, up+down pair |
| Security | `secret.marketdata.fmp.api_key` uses `secret.*` prefix, key never logged/rendered, no plaintext in config state |
| `xstockstrat-config` (service owner) | New `marketdata.fmp.*` keys + the new `marketdata.<source>.enabled` convention |

## Next Action

`/sdd-review fundamentals-data-source product-spec` — AI review of product spec before running /sdd-spec
