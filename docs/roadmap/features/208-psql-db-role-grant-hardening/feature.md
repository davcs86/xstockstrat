# Feature: psql-db-role-grant-hardening

**Development Branch**: `feature/psql-db-role-grant-hardening`
**Created**: 2026-09-25
**Last Updated**: 2026-09-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-25 | `idea` → `draft` | /sdd-story | Product spec generated (closes security-audit DT-2 §149 grant-narrowing — the defense-in-depth follow-on to H-5/feature 193) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec psql-db-role-grant-hardening`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Narrow the `xstockstrat_agent` DML database role from blanket cross-schema write to least-privilege:
revoke write (and, for secrets, read) on the integrity- and secrecy-critical relations — the ledger
append-only event store, identity credential/api-key/refresh-token tables, and the config
`value_encrypted` secret ciphertext — and make the psql-MCP audit sink tamper-evident against the very
role whose statements it records. Grant-level defense-in-depth beneath the tool-layer separation of
feature 193, so that even a legitimately-authenticated DB-tool session (or a role-credential leak)
cannot corrupt the event ledger, forge credentials, or delete its own audit trail. Closes the
grant-narrowing recommendation in `docs/reports/2026-09-16-trading-system-security-audit.md` DT-2
(§149).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | Least-privilege correctness: the effective privilege set denies write on ledger/identity-secret/config-ciphertext relations and denies modify/delete on the psql-MCP audit sink; DDL stays denied; the role cannot self-escalate (no CREATEROLE, no grant-to-self) |
| DBA | Grant/revoke migration correctness and idempotency; no disruption to the legitimate DML the analytics tooling needs; verifiable via a pg_catalog/information_schema introspection assertion |
| `xstockstrat-ledger` | Append-only integrity of the event store is not writable/deletable by the DML role |
| `xstockstrat-identity` | Credential / api-key / refresh-token tables are not writable by the DML role |
| `xstockstrat-config` | The `value_encrypted` secret ciphertext column is not readable/writable by the DML role |

## Next Action

`/sdd-review psql-db-role-grant-hardening product-spec` — AI review of product spec before running /sdd-spec
