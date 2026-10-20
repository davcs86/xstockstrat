# Feature: offline-account-full-pnl

**Development Branch**: `feature/offline-account-full-pnl`
**Created**: 2026-10-19
**Last Updated**: 2026-10-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-19 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-10-19 | `draft` → `spec-ready` | /sdd-review | Product spec approved after 4 review rounds (round-4 warnings addressed: 2 warnings, 5 notes) |
| 2026-10-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + design.md written |
| 2026-10-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 28 steps (re-anchored on main-dev post-231; operator decision D-1 gates Step 19) |
| 2026-10-20 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential mode on `feature/offline-account-full-pnl`; Step 1 done |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md)
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
| Proto Reviewer (`packages/proto`) | Field number uniqueness, backward compatibility (no field removal or type change without deprecation), `buf lint`/`buf breaking` pass — incl. the manual trading.proto check CI skips (Step 1) |
| DBA | Migration NNN numbering (trading 011, portfolio 017), up+down pair, run order, index correctness (Steps 3–4) |
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant — fees persistence, snapshot carry, NEW-order masking (Steps 1–3, 5–12) |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety — calendar, valuation, account P&L, FR-9 parity (Steps 1, 4, 15–23) |
| `xstockstrat-marketdata` owner | OHLCV ingestion integrity, Alpaca feed idempotency — opt-in `BatchGetBars allow_partial` (Steps 1, 13–14) |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), WatchConfig stream stability — `last_close_lookback_days` bounds (Step 23) |
| `xstockstrat-agent` owner | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; tool-count unchanged (Steps 24–25) |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, C-17 (Steps 26–27) |

## Next Action

`/sdd-review offline-account-full-pnl impl-spec` (operator decision D-1 recorded 2026-10-20) — validate implementation spec,
then `/sdd-execute offline-account-full-pnl`
