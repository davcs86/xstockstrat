# Feature: psql-db-role-grant-hardening

**Development Branch**: `feature/psql-db-role-grant-hardening`
**Created**: 2026-09-25
**Last Updated**: 2026-09-27
**Archived**: 2026-10-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-25 | `idea` → `draft` | /sdd-story | Product spec generated (closes security-audit DT-2 §149 grant-narrowing — then the defense-in-depth follow-on to H-5/feature 193) |
| 2026-09-27 | `draft` (rescoped) | operator | **Rescoped.** Feature 193 (now imported/demoted as **212**) was abandoned and postgres-mcp is being removed outright (feature **214** `remove-agent-postgres-mcp`), which orphans the `xstockstrat_agent` DB role (postgres-mcp was its only consumer). Original scope (least-privilege grants for the psql-MCP's role + protect its audit sink) is void — there is no psql-MCP and no audit sink. New scope: **tear down the orphaned `xstockstrat_agent` role at the DB** + audit that no *remaining* role can write integrity-critical tables. Now **hard-depends on feature 214**. |
| 2026-09-27 | `draft` → `demoted/canceled` | operator | **Demoted — unnecessary.** There is no orphaned role to tear down: the `xstockstrat_agent` role is only *conditionally* provisioned by `scripts/db-migrate.sh` (feature 169) when `POSTGRES_MCP_AGENT_PASSWORD` is set, and that password was never set in the live environments — so the role was **never created** (the `[skip]` path always ran). Feature 214 already removes the dead provisioning block from `db-migrate.sh` as part of removing all postgres-mcp wiring, leaving nothing for this feature to do. No PR merged this feature's content; the directory is retained as a demoted record only. |
| 2026-10-07 | `demoted/canceled` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(1); pruned 1 spec(s); no scenarios promoted (feature canceled) |

---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15); none promoted — feature canceled before shipping (C-16)
- Implementation Spec — never generated (feature canceled before design)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

> **⚠️ DEMOTED 2026-09-27 — unnecessary.** The `xstockstrat_agent` role was only conditionally
> provisioned (`scripts/db-migrate.sh`, gated on `POSTGRES_MCP_AGENT_PASSWORD`) and **was never created**
> in the live environments, so there is no orphaned role to tear down. Feature **214**
> (`remove-agent-postgres-mcp`) removes the dead provisioning block itself. If a broader "no role can
> write integrity-critical tables" grant audit is ever wanted, open it as a fresh feature. The text
> below describes the abandoned rescope, retained as record.

Tear down the now-orphaned `xstockstrat_agent` database role at the Postgres grant level after feature
214 removes the postgres-mcp co-process that was its only consumer: revoke all its privileges and drop
the role (or reduce it to zero-privilege `NOLOGIN` if owned objects block a clean drop). Then audit —
and, where needed, tighten — the remaining DB roles so none can write the integrity- and
secrecy-critical relations beyond what it legitimately requires: the ledger append-only event store,
identity credential/api-key/refresh-token tables, and the config secret ciphertext (`value_encrypted`).
Grant-level defense-in-depth that removes a dormant privileged identity and closes the residual write
paths flagged by `docs/reports/2026-09-16-trading-system-security-audit.md` DT-2 (§149). **Depends on
feature 214 (`remove-agent-postgres-mcp`)** — the role must have no live consumer before it is dropped.

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

**None — demoted/canceled.** No orphaned role exists to tear down; feature 214 removes the dead
`db-migrate.sh` provisioning block. Do not run `/sdd-review` or `/sdd-spec` on this slug.
