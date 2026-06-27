# Feature: fundamentals-data-source

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/fundamentals-data-source`
**Created**: 2026-06-26
**Last Updated**: 2026-06-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-26 | `idea` → `draft` | /sdd-story | Product spec generated (feature 2 of 6 in the screener initiative) |
| 2026-06-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning: OQ-059-a-impl FMP endpoint paths deferred to /sdd-spec — non-blocking) |
| 2026-06-27 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps; OQ-059-a-impl resolved (hybrid quote/ratios-ttm/profile under config base_url) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 11 numbered steps with codebase evidence
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

`/sdd-review fundamentals-data-source impl-spec` — validate the implementation spec, then `/sdd-execute fundamentals-data-source`
