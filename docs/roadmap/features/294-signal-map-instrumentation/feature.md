# Feature: signal-map-instrumentation

**Development Branch**: `ccr-b4aace27-zvuaby` (operator override 2026-11-04: sequential execute on the current branch; no `feature/<slug>` branch)
**Created**: 2026-11-04
**Last Updated**: 2026-11-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `idea` → `draft` | /sdd-story | Product spec generated from `docs/repo-surveyor/signal-map-findings.md` (PR #1427, surveyed at `9892b61`) |
| 2026-11-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 advisory warnings, all fixed; first pass FAILED on unticked open questions, re-review PASS WITH WARNINGS) |
| 2026-11-04 | `spec-ready` → `design-approved` | /sdd-design | Full design, 6 rounds (operator overrode the 5-round cap); round-6 adversary APPROVE WITH LISTED FIXES, all applied; 59 acceptance scenarios (AC-57..AC-59 new) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, existing business rules
- [Design](design.md) — debated architecture, rejected alternatives, open risks
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec signal-map-instrumentation`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Implements the whole signal-map survey as one effort: 26 instrumentation gaps (SEV-2 first), 7 noisy-signal demotions and 5 feature gauges across all 12 services, so failures on money, auth and data-integrity paths show up as bounded counters, gauges and logs instead of an OK RPC status. Signals only: no behavior change, no alert rules, no registry rows.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

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

`/sdd-spec signal-map-instrumentation` — step ordering must keep the analysis steps clear of feature 215's regions (live_loop.py:733-760, :876-891) and coordinate 243/281 through merge-order.md
