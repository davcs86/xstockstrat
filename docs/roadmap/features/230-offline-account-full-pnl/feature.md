# Feature: offline-account-full-pnl

**Development Branch**: `feature/offline-account-full-pnl`
**Created**: 2026-10-19
**Last Updated**: 2026-10-19

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-19 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-10-19 | `draft` → `spec-ready` | /sdd-review | Product spec approved after 4 review rounds (round-4 warnings addressed: 2 warnings, 5 notes) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec offline-account-full-pnl`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Bring offline (`BROKER_TYPE_OFFLINE`) accounts to full P&L parity: broker-style Day P&L, Total P&L and
return % on open cost basis, per-order fees as a separate line (realized gross and net), lifetime
realized carried across snapshots alongside the since-snapshot figure, and a stale-flagged last-close
mark fallback — surfaced on the `/trader` cards, positions pages, and MCP agent tools.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer (`packages/proto`) | Field number uniqueness, backward compatibility (additive `ConfirmOrderRequest.fees`, new `Portfolio`/`Position` P&L + mark-provenance fields), `buf lint`/`buf breaking` pass |
| DBA | Migration NNN numbering, up+down pair, run order (trading fees column; portfolio lifetime-realized/fees columns) |
| `xstockstrat-trading` owner | Offline fold correctness (fees accumulation, since-snapshot vs lifetime realized), per-account lock across persist→recompute→emit, broker paths unchanged |
| `xstockstrat-portfolio` owner | P&L calculation accuracy (day/total/return %, short %), position snapshot consistency, concurrent write safety, last-close fallback never fabricates a price |
| `xstockstrat-marketdata` owner | Previous-close / latest-close read path correctness (daily bars), no new vendor fan-out |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy (stale-mark indicator, gross vs net realized), C-17 tokens/state primitives |
| `xstockstrat-agent` owner | MCP tool contract stability (`confirm_order` `fees` arg, new response fields), `docs/runbooks/mcp-tools.md` parity, no tool-count change |

## Next Action

`/sdd-design offline-account-full-pnl` — recon + design debate (full mode recommended), then `/sdd-spec offline-account-full-pnl`
