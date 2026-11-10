# Feature: config-keys-alias-removal

**Development Branch**: `feature/config-keys-alias-removal`
**Created**: 2026-11-07
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-07 | `idea` → `draft` | /sdd-story | Product spec generated from feature 296's approved design (`296-fix-config-keys-contract/design.md` §1, §10; FR-8). Created at the operator's explicit direction as slice D of the 296 split; `Type: feature`. This is the "named follow-up" of 296 FR-8 / AC-12 |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (second pass; 4 warnings); FR-6 decided by the operator: delete the three rows |
| 2026-11-10 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written; operator signed the C-16 batch |
| 2026-11-10 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 13 steps |
| 2026-11-10 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done: @AC-7 evidence recorded (zero WARN, control 28900, trading image 44ce639 descends from 79abf13); operator confirmed the window |
| 2026-11-10 | `in-progress` → `code-completed` | /sdd-execute | Steps 1-13 done (sequential, one commit per step); CI `Migration rerun` and `Config stored-set freshness` green on 32df43c; operator DO dev rehearsal recorded (sha 52939ec4…bddae); `--final` exit 0 |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Removes the transitional compatibility that 295 and 296 left behind once feature 304 has launched: the legacy spelling alias, the `SetConfig` write-time spelling tolerance, the trading poller canonicalisation exception and its WARN, the agent `get_config` alias filter, and the gate's alt/`form-mismatch` path. Also settles the three baseline entries owned by it (`platform` / `log_level`, `trading` / `risk.daily_loss_limit`, and `ledger` / `stream.notify_enabled`, re-owned from feature 305).

## Reviewers

| Role | Review Focus |
|---|---|
| Service owner — `xstockstrat-config` | WatchConfig stream stability, snapshot/delta content, authz (`canonical()` users), `SetConfig` error mapping |
| Service owner — `xstockstrat-trading` | The reconciliation poller must send `trading_state` before the exception is removed; escalation safety (`@AC-54` @feature-294) |
| Service owner — `xstockstrat-agent` | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity (`get_config` shape) |
| Platform Lead | Earliest-start evidence (zero WARNs over a staging release), gate close-out |
| DBA | Migration numbering (`047` contended with 280), up+down pair, marker-scoped down, rehearsal evidence |

## Next Action

Mark PR #1493 ready for review once CI is green on the final head and the C-16 promotion of the acceptance scenarios is confirmed; the operator merges (merge order: 306 and 280 share config migration 047 — first to merge keeps it).
