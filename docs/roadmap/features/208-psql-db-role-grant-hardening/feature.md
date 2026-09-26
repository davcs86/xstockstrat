# Feature: psql-db-role-grant-hardening

**Development Branch**: `feature/psql-db-role-grant-hardening`
**Created**: 2026-09-25
**Last Updated**: 2026-09-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-25 | `idea` → `draft` | /sdd-story | Product spec generated (closes security-audit DT-2 §149 grant-narrowing — then the defense-in-depth follow-on to H-5/feature 193) |
| 2026-09-26 | `draft` (rescoped) | operator | **Rescoped.** Feature 193 demoted and postgres-mcp removed outright (feature 211), which orphans the `xstockstrat_agent` DB role (postgres-mcp was its only consumer). Original scope (least-privilege grants for the psql-MCP's role + protect its audit sink) is void — there is no psql-MCP and no audit sink. New scope: **tear down the orphaned `xstockstrat_agent` role at the DB** + audit that no *remaining* role can write integrity-critical tables. Now **depends on feature 211**. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec psql-db-role-grant-hardening`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Tear down the now-orphaned `xstockstrat_agent` database role at the Postgres grant level after feature
211 removes the postgres-mcp co-process that was its only consumer: revoke all its privileges and drop
the role (or reduce it to zero-privilege `NOLOGIN` if owned objects block a clean drop). Then audit —
and, where needed, tighten — the remaining DB roles so none can write the integrity- and
secrecy-critical relations beyond what it legitimately requires: the ledger append-only event store,
identity credential/api-key/refresh-token tables, and the config secret ciphertext (`value_encrypted`).
Grant-level defense-in-depth that removes a dormant privileged identity and closes the residual write
paths flagged by `docs/reports/2026-09-16-trading-system-security-audit.md` DT-2 (§149). **Depends on
feature 211 (`remove-agent-postgres-mcp`)** — the role must have no live consumer before it is dropped.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | The orphaned `xstockstrat_agent` role is gone (dropped, or zero-privilege + `NOLOGIN`); no remaining role can write ledger/identity-secret/config-ciphertext relations beyond intent; no role but the intended owner can read `value_encrypted` |
| DBA | Teardown migration correctness: safe drop vs revoke-and-disable when objects are owned; idempotent and re-runnable; no live service loses required access; verifiable via a pg_catalog/information_schema introspection assertion |
| `xstockstrat-ledger` | Append-only event store stays non-writable/non-deletable by every non-owner role |
| `xstockstrat-identity` | Credential / api-key / refresh-token tables stay non-writable by non-owner roles |
| `xstockstrat-config` | The `value_encrypted` secret ciphertext column stays non-readable/writable by non-owner roles |

## Next Action

`/sdd-review psql-db-role-grant-hardening product-spec` — AI review of product spec before running /sdd-design
