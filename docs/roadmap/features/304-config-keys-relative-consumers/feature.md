# Feature: config-keys-relative-consumers

**Development Branch**: `feature/config-keys-relative-consumers`
**Created**: 2026-11-07
**Last Updated**: 2026-11-09
**Committed to main**: 93bb23071e2fd370505343d23f44ef98c4f1d49f
**Launched date**: 2026-11-09
**Archived**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-07 | `idea` → `draft` | /sdd-story | Product spec generated from feature 296's approved design (`296-fix-config-keys-contract/design.md` §1, §6, §8–§10). Created at the operator's explicit direction as slice B of the 296 split; the `/sdd-story` bug guard (`SKILL.md:274`) is not triggered because this is a planned slice, not a triaged defect |
| 2026-11-08 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS: 0 blockers; 4 text warnings fixed in the spec, 2 advisory left for /sdd-spec). Open Questions resolved by the operator: Q2 (C1–C6/N2 split) deferred to /sdd-spec, Q3 one integration PR. Overlap: no FAIL-level collision |
| 2026-11-08 | `spec-ready` (unchanged) | /sdd-review (re-review) | Re-review PASS WITH WARNINGS, 0 blockers: all first-pass warnings verified fixed; AC-13..16 added for the uncovered sub-clauses; 3 defects found in the new scenarios (AC-14, AC-16, AC-13) fixed directly. Overlap re-scan: no FAIL-level collision; merge-order row 29 marked Resolved = Yes |
| 2026-11-09 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved; recon.md + design.md written. Operator steering: separate required `platform` watcher for trading (S1), canonical test doubles reject `<ns>.` keys (S2). Signed spec amendments (FR-1, FR-2 + AC-17, FR-4, FR-5, AC-1, AC-2 row 0.2, AC-9, AC-10) and C-16 CHANGES (295 @AC-15/@AC-19-note/@AC-20, 243 @AC-2 note, 296 @AC-22/@AC-23); 305 owns `config_allow296.py` removal |
| 2026-11-09 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 26 steps (11 test+service family units, strat-lab docs step, 3-step Cf unit) |
| 2026-11-09 | `implementation-ready` → `in-progress` | /sdd-execute (sequential) | First unit committed: steps 1+2 (ledger). Commits land directly on `ccr-e901c541-u0cmts` (PR #1479 is the integration PR) |
| 2026-11-09 | `in-progress` → `code-completed` | /sdd-execute (sequential) | All 26 steps done in 12 commits; `prefixed-read` baseline 180 → 0, `--final` exit 0. Pending: merge-order gate, C-16 promotion (operator yes), PR body. |

| 2026-11-09 | `code-completed` → `launched` | CI workflow | Promoted via PR #1489; committed 93bb23071e2fd370505343d23f44ef98c4f1d49f |
| 2026-11-10 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(2)/fails(1); pruned 4 specs |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- Recon — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Slice B of the config-key canonicalisation: rewrites every consumer's config reads from the namespace-prefixed spelling to the namespace-relative key, drains the `prefixed-read` baseline that feature 296 generates to empty, rewrites the 11 service banners and key tables, and closes out the gate and documents (caveat removal, kind removal, wider doc scan). Depends on 296 being merged first (merge order only).

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-11-09 from the per-step Reviewers; stable unless /sdd-spec re-runs.)_

| Role | Review Focus |
|---|---|
| Service owner — `xstockstrat-trading` | Order execution correctness, paper-only dev invariant; separate required `platform` watcher (halt-path fail-closed, boot exit on nil/late snapshot); the reconciliation poller's `SetConfig` key |
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

Show the C-16 promotion plan to the operator, then update the integration PR #1479 body (merge-order gate first). No merge authority granted.
