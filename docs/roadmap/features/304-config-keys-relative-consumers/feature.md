# Feature: config-keys-relative-consumers

**Development Branch**: `feature/config-keys-relative-consumers`
**Created**: 2026-11-07
**Last Updated**: 2026-11-08

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-07 | `idea` → `draft` | /sdd-story | Product spec generated from feature 296's approved design (`296-fix-config-keys-contract/design.md` §1, §6, §8–§10). Created at the operator's explicit direction as slice B of the 296 split; the `/sdd-story` bug guard (`SKILL.md:274`) is not triggered because this is a planned slice, not a triaged defect |
| 2026-11-08 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS: 0 blockers; 4 text warnings fixed in the spec, 2 advisory left for /sdd-spec). Open Questions resolved by the operator: Q2 (C1–C6/N2 split) deferred to /sdd-spec, Q3 one integration PR. Overlap: no FAIL-level collision |
| 2026-11-08 | `spec-ready` (unchanged) | /sdd-review (re-review) | Re-review PASS WITH WARNINGS, 0 blockers: all first-pass warnings verified fixed; AC-13..16 added for the uncovered sub-clauses; 3 defects found in the new scenarios (AC-14, AC-16, AC-13) fixed directly. Overlap re-scan: no FAIL-level collision; merge-order row 29 marked Resolved = Yes |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec config-keys-relative-consumers`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Slice B of the config-key canonicalisation: rewrites every consumer's config reads from the namespace-prefixed spelling to the namespace-relative key, drains the `prefixed-read` baseline that feature 296 generates to empty, rewrites the 11 service banners and key tables, and closes out the gate and documents (caveat removal, kind removal, wider doc scan). Depends on 296 being merged first (merge order only).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Snapshot finalized at /sdd-spec time.)_

| Role | Review Focus |
|---|---|
| Service owner — `xstockstrat-trading` | Order execution correctness, paper-only dev invariant; two-namespace `[trading, platform]` read order; the reconciliation poller's `SetConfig` key |
| Service owner — `xstockstrat-portfolio` | P&L accuracy, concurrent write safety; migration-coupled test redesign |
| Service owner — `xstockstrat-marketdata` | Ingestion integrity; vendor-secret keys already relative; concatenated provider keys |
| Service owner — `xstockstrat-indicators` | Sandbox timeout enforcement (`sandbox.timeout_ms`); `sandbox_keys_check.py` inversion |
| Service owner — `xstockstrat-ingest` | Signal normalization; `mcp_client` poll keys |
| Service owner — `xstockstrat-analysis` | Backtest reproducibility, scoring determinism; second `marketdata` watcher; ≈120 literals |
| Service owner — `xstockstrat-ledger` | Append-only invariant; `config.read_key` log spelling |
| Service owner — `xstockstrat-identity` | JWT TTL keys; no secret handling change |
| Service owner — `xstockstrat-notify` | Delivery guarantees; fanout gate keys |
| Service owner — `xstockstrat-agent` | MCP tool contract stability; agent's `indicators.sandbox.*` reads; strat-lab skill literal |
| Service owner — `xstockstrat-ui` | Trader positions `trading_state` read; mock-backend and fixtures (C-12); no secret rendering |
| Platform Lead | Cross-service consistency, gate close-out, baseline ownership |

## Next Action

`/sdd-design config-keys-relative-consumers` — **full** design recommended (11 services across Go, Python, Node, agent and ui, plus file-level overlap with 305/306 on the gate files). `/sdd-spec` must classify the 25 durable scenarios that quote a prefixed key near a read verb with `scenario-recon` (C-16) and trace the FR-4/FR-5 sub-clauses (`dynamic` lists, `broker.paper`, strat-lab SKILL.md, `sandbox_keys_check.py`) to steps.
