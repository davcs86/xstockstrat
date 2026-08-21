# Feature: config-secrets-and-scoping

**Development Branch**: `feature/config-secrets-and-scoping`
**Created**: 2026-08-20
**Last Updated**: 2026-08-20
**Committed to main**: d908f33dc3283b79b61b233d57542cd47014c4ab
**Launched date**: 2026-08-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-20 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-20 | `draft` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written. Operator kept per-user overlay on WatchConfig. |
| 2026-08-20 | `design-approved` → `implementation-ready` | /sdd-spec | 12-step implementation-spec.md written (evidence-cited, AC-mapped). |
| 2026-08-20 | `implementation-ready` → `in-progress` | implementation | Implementing on `claude/config-secrets-environment-e0eue6`. |
| 2026-08-20 | `in-progress` → `code-completed` | implementation | All 12 steps done: proto, migration 017 (DB-validated), config service (crypto/GetSecret/redaction/scope), marketdata GetSecret, agent JWT_SECRET, config-ui env/user scope, all client edges, deploy wiring, governance docs. Tests green per service. |
| 2026-08-21 | `code-completed` (unchanged) | PR #994 review | Addressed 4 operator review threads: (1) agent config env is deployment-bound (dropped caller `environment` param); (2) admin secret writes unblocked via MCP + config-ui; (3) per-user config authz = owner-only self-service (admins reach globals + own rows only, `PER_USER_SCOPE_ERROR`); (4) agent is an edge — forwards `x-user-id`+`x-access-scope`+`x-trace-id` (gen'd) on every outbound call via `CallerPropagationMiddleware`. Tests green (agent 237, config 83, config-ui 19 e2e). |

| 2026-08-21 | `code-completed` → `launched` | CI workflow | Promoted via PR #997; committed d908f33dc3283b79b61b233d57542cd47014c4ab |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
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

`/sdd-spec config-secrets-and-scoping` — generate implementation spec from the approved design
