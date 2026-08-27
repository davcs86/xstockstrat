# Feature: agent-broker-account-tools

**Development Branch**: `feature/agent-broker-account-tools`
**Created**: 2026-08-27
**Last Updated**: 2026-08-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-27 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Expose broker-account management through the MCP agent: a `manage_account` write tool (register /
update-credentials / deregister a broker account) and a `list_accounts` read tool that returns the
caller's broker **and** offline accounts together — all ownership-gated on the caller's `x-user-id`,
with broker credentials passing through to the trading backend and never echoed back.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync across all inventory surfaces; ownership `x-user-id` forwarding; no secret/credential values in tool output |
| `xstockstrat-trading` owner | Broker API safety, ownership resolution on account RPCs, credential handling |

## Next Action

`/sdd-review agent-broker-account-tools product-spec` — AI review of product spec before running /sdd-spec
