# Feature: fundamentals-provider-alternative

**Lifecycle Status**: `spec-ready`
**Development Branch**: `claude/fmp-free-layer-ratios-dr0c4j`
**Created**: 2026-08-12
**Last Updated**: 2026-08-12

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-12 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-12 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS: 3 open questions deferred to /sdd-design per feature-059 precedent; consumer-surface "None" flagged as re-check-if-scope-widens). Overlap scan: clean. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fundamentals-provider-alternative`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replace (or add as a switchable alternative behind the existing `source.FundamentalsSource`
interface) the FMP fundamentals client in `xstockstrat-marketdata` with a provider that has a
materially better free-tier cap than FMP's 250 req/day + restricted per-symbol `ratios-ttm`/
`profile` endpoints, while producing functionally equivalent data. Design phase must verify the
real free-tier limits and endpoint coverage of Finnhub and Twelve Data against their current live
API docs and select the better fit.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-marketdata` (service owner) | OHLCV ingestion integrity (Alpaca path must stay untouched), Alpaca feed idempotency; here: new fundamentals-source client correctness, quota-guard behavior, cache correctness |
| `xstockstrat-config` (service owner) | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability |
| Security | No secrets in config service state, secret keys use `secret.*` prefix / secret-env-var convention, API key scoping correct |

## Next Action

`/sdd-design fundamentals-provider-alternative quick` — recon + adversarial design debate
