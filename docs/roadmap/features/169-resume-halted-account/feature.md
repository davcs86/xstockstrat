# Feature: resume-halted-account

**Development Branch**: `feature/resume-halted-account`
**Created**: 2026-09-02
**Last Updated**: 2026-09-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-02 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds an operator-facing `ResumeAccount` RPC on `xstockstrat-trading` (and a corresponding `resume` operation on the `manage_account` MCP agent tool) so that automated reconciliation halts on broker accounts can be cleared through the product — no manual DB edit or service restart required.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync across all six inventory surfaces; admin `x-access-scope` forwarded only by the management tools; no secret values in tool output |
| `xstockstrat-ledger` owner | Append-only invariant (no deletes or updates), event ordering |
| Proto Reviewer | Field number uniqueness, backward compatibility, `buf lint` passes, `buf breaking` passes |
| Security | Auth scope gating — only operator/admin callers may invoke ResumeAccount |

## Next Action

`/sdd-review resume-halted-account product-spec` — AI review of product spec before running /sdd-spec
