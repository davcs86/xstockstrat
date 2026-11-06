# Feature: signal-map-instrumentation

**Development Branch**: `ccr-b4aace27-zvuaby` (operator override 2026-11-04: sequential execute on the current branch; no `feature/<slug>` branch)
**Created**: 2026-11-04
**Last Updated**: 2026-11-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `idea` → `draft` | /sdd-story | Product spec generated from `docs/repo-surveyor/signal-map-findings.md` (PR #1427, surveyed at `9892b61`) |
| 2026-11-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 advisory warnings, all fixed; first pass FAILED on unticked open questions, re-review PASS WITH WARNINGS) |
| 2026-11-04 | `spec-ready` → `design-approved` | /sdd-design | Full design, 6 rounds (operator overrode the 5-round cap); round-6 adversary APPROVE WITH LISTED FIXES, all applied; 59 acceptance scenarios (AC-57..AC-59 new) |
| 2026-11-04 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 30 steps (14 service, 15 test, 1 docs); all 59 `@AC-*` scenarios covered |
| 2026-11-06 | `implementation-ready` (re-spec) | /sdd-execute sequential | Re-spec gate (§5.3, conditional) after merging `origin/main-dev` (282 #1456): Steps 7, 8, 9, 10, 11, 15, 19, 25 re-grounded; 281 prune loop and 282 asset refresher added as KEPT loop names |
| 2026-11-06 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Operator gave the up-front confirmation (§5.4); sequential on `ccr-b4aace27-zvuaby`, one commit per step, integration PR #1427 |
| 2026-11-06 | `in-progress` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | Re-spec gate (§5.3, conditional) after merging `origin/main-dev` (293 PR-1 #1457): Steps 6, 15, 17, 29 re-grounded (line drift; worktree-root verification commands); Step 8 validated, body unchanged |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, existing business rules
- [Design](design.md) — debated architecture, rejected alternatives, open risks
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — 30 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Implements the whole signal-map survey as one effort: 26 instrumentation gaps (SEV-2 first), 7 noisy-signal demotions and 5 feature gauges across all 12 services, so failures on money, auth and data-integrity paths show up as bounded counters, gauges and logs instead of an OK RPC status. Signals only: no behavior change, no alert rules, no registry rows.

## Reviewers

_(Snapshot finalized by /sdd-spec 2026-11-04 from docs/runbooks/reviewer-registry.md and the distinct
`**Reviewers**` of all 30 steps — stable unless /sdd-spec re-runs.)_

| Role | Review Focus |
|---|---|
| Service owner — `xstockstrat-trading` | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement (instrumentation must not alter the flatten, bracket, fill or reconciliation paths) |
| Service owner — `xstockstrat-portfolio` | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| Service owner — `xstockstrat-marketdata` | OHLCV ingestion integrity, Alpaca feed idempotency (vendor-call instrumentation must not leak the FMP apikey) |
| Service owner — `xstockstrat-indicators` | Formula sandboxing, timeout enforcement, no side-effects from formula execution |
| Service owner — `xstockstrat-ingest` | Signal normalization correctness, idempotent ingestion |
| Service owner — `xstockstrat-analysis` | Backtest reproducibility, strategy scoring determinism; the registered `live_loop: cycle complete` literal is unchanged |
| Service owner — `xstockstrat-ledger` | Append-only invariant, event ordering |
| Service owner — `xstockstrat-identity` | JWT expiry and rotation, secret handling (no token, email or hash in a log or label) |
| Service owner — `xstockstrat-notify` | Stream delivery guarantees, backpressure handling, alert deduplication |
| Service owner — `xstockstrat-config` | WatchConfig stream stability; no secret values in any log |
| Service owner — `xstockstrat-ui` | BFF correctness; no secret values rendered or logged; no direct DB access beyond the audit route |
| Service owner — `xstockstrat-agent` | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output; OAuth statelessness |
| Security | Secret-adjacent logging (config `GetSecret` audit lines, identity, agent OAuth, UI auth events): never log values, tokens, passwords or hashes; bounded labels only |
| Platform Lead | The cross-service loop-liveness pattern and the shared label discipline |

## Next Action

`/sdd-execute signal-map-instrumentation sequential` on `ccr-b4aace27-zvuaby` — Steps 1-24 done (2026-11-06); Step 25 next
