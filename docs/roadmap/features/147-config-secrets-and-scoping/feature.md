# Feature: config-secrets-and-scoping

**Development Branch**: `feature/config-secrets-and-scoping`
**Created**: 2026-08-20
**Last Updated**: 2026-08-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-20 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec config-secrets-and-scoping`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Store platform secrets encrypted at rest in `xstockstrat-config` (AES-256-GCM) and serve them only
through a new authenticated `GetSecret` RPC — never broadcast on `WatchConfig` or rendered at any
consumer edge — then migrate the vendor API credentials out of `type: SECRET` env vars into that
store, and re-model config scoping into exactly two dimensions: **environment** (`production`/
`staging`) × **global/per-user**, with paper/live derived from environment.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | No plaintext secret at any read edge; encryption at rest; credential-wiring checklist; scope of the `GetSecret` allow-list |
| Proto Reviewer | Field-number uniqueness, breaking-change deprecation (environment enum, WatchConfig/Set/List scope fields, new GetSecret RPC), `buf breaking` |
| DBA | Config migration numbering + up/down pair; user-scope column + encrypted-value columns; data backfill/collapse of trading_mode rows |
| `xstockstrat-config` (owner) | Key naming, environment/scope resolution, WatchConfig stream stability, redaction correctness |
| `xstockstrat-marketdata` (owner) | Alpaca/FMP/Finnhub now resolved via `GetSecret`; startup ordering; empty-secret behavior |
| `xstockstrat-agent` (owner) | `MCP_AGENT_SECRET` removal, OAuth `txn` signing replacement, statelessness, no secret in tool output |
| `xstockstrat-ui` (owner) | config-ui environment/scope selectors, no secret values rendered |
| Platform Lead | Cross-service scope re-model, deploy-pipeline env-var removal, blast radius |

## Next Action

`/sdd-review config-secrets-and-scoping product-spec` — AI review of product spec before running /sdd-spec
