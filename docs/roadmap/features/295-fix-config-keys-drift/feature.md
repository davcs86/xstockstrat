# Feature: fix-config-keys-drift

**Type**: bug
**Development Branch**: `feature/fix-config-keys-drift`
**GitHub Issue**: n/a — Issues disabled; defect report `docs/reports/2026-11-04-config-key-drift-and-subscription-gaps-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-04
**Last Updated**: 2026-11-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report 2026-11-04-config-key-drift-and-subscription-gaps |
| 2026-11-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved on second pass (FR-1..15, AC-1..21; 5 advisory warnings) |
| 2026-11-04 | `spec-ready` (unchanged) | /sdd-review | Re-scoped to Release A (operator decision 13; Release B → feature 296); re-reviewed FAIL (FR-10 wording) → fixed → PASS WITH WARNINGS (FR-1..15, AC-1..27) |
| 2026-11-05 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full; operator decisions 1–25) and approved; recon.md + design.md written; Release B split to 296 |
| 2026-11-05 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 39 steps (config migrations renumbered 035/036 → 040/041 pending operator confirmation) |
| 2026-11-05 | `implementation-ready` (unchanged) | /sdd-execute sequential | Re-spec gate after the main-dev merge: Steps 1,3,4,7–13,19–21,25,27–29,33,36–38 aligned with the current codebase (line drift, decision 28's pinned 040/041 order, Files completed). Step 12 needed no change. |
| 2026-11-05 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Execution started on the operator's up-front confirmation; Step 1 has not run yet (decision-27 gate items still open, see context.md) |
| 2026-11-05 | `in-progress` (unchanged) | /sdd-execute sequential (sdd-batch-execute) | Second re-spec gate (main-dev already merged; ledger-guard clean): Steps 1,3,9,11,30,36 aligned with the current codebase. Step 1's decision-27 gate and the Step 11 spike ordering still need operator rulings |
| 2026-11-06 | `in-progress` (unchanged) | /sdd-execute sequential (sdd-batch-execute) | Targeted re-spec (operator Option A): decision-27 items (a),(b),(c),(e) closed — coverage lines in Steps 14/16/18/22/24/26, Steps 15/17 Files expanded, Step 23 order-type/fill-state list, AC-28 reworded to `migrate force 40` (same ID); item (d) left unsplit by operator choice (decision 30). Gate cleared |
| 2026-11-06 | `in-progress` (unchanged) | /sdd-execute sequential (sdd-batch-execute) | Re-spec gate after merging origin/main-dev (282 merged, `0ea9b5c5`; #1458 dropped the root CLAUDE.md Teardown): Steps 7,8,9,10,11,20,21,28,29,33,36,37,38 aligned with the current codebase (line anchors +7 in configServiceImpl.ts and shifted marketdata/agent/config-governance.md anchors; 040/041 precondition now met; Step 38 drops the satisfied 295→282 merge-order row and the Teardown instruction). ledger-guard clean |
| 2026-11-06 | `in-progress` (unchanged) | /sdd-execute sequential (sdd-batch-execute) | Steps 3+4 done as one atomic unit (operator decision 31): config-wiring gate reads the generated stored JSON, attributes reads via `registry.receivers`, adds 5 kinds, `--inventory`/`--emit-heal-data`, `--final` freshness + 296 membership; CI `config-wiring-stored` job; baseline 124 → 130 |
| 2026-11-06 | `in-progress` (unchanged) | /sdd-execute sequential (operator G1) | Step 5 (G1) done: operator ran `python -m app.maintenance.config_inventory` on the staging indicators console (tool shipped early to main-dev via #1462, `d868c039`); 204 records committed verbatim as `scripts/config-heal/inventory-staging.jsonl`; output_sha256 `633f91d5…ab701b`, tool_sha256 `5515ed6e…65d1e5` = branch file |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md)
- [Recon](recon.md) — Phase 0 dossier
- [Design](design.md) — approved architecture, rejected alternatives, open risks
- [Context Log](context.md) — session history, decisions, deviations
- Companion: feature 296 `fix-config-keys-contract` (Release B, branch `feature/fix-config-keys-contract`)

---

## Reviewers

| Reviewer | Focus |
|---|---|
| xstockstrat-config owner | Config key naming, environment / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability |
| xstockstrat-trading owner | Order execution correctness, broker API safety, paper-only dev invariant |
| xstockstrat-portfolio owner | Position snapshot consistency |
| xstockstrat-marketdata owner | OHLCV ingestion integrity, Alpaca feed idempotency |
| xstockstrat-indicators owner | Formula sandboxing, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects |
| xstockstrat-ingest owner | Idempotent ingestion |
| xstockstrat-analysis owner | Backtest reproducibility, scoring determinism |
| xstockstrat-ledger owner | Append-only invariant |
| xstockstrat-identity owner | JWT expiry and rotation |
| xstockstrat-notify owner | Stream delivery guarantees |
| xstockstrat-agent owner | MCP tool contract stability, `mcp-tools.md` parity, no secrets in tool output |
| xstockstrat-ui owner | Environment (`production`/`staging`) scope correctness, Connect-RPC call safety |
| DBA | Migration NNN numbering (040/041), up+down pair, run-order compliance with `scripts/db-migrate.sh`, connection budget (F-06) |
| Security | Secrets never revealed, deleted or reported in plaintext; `is_secret` row-authoritative on write |

---

## Summary

Config keys drift from their readers, about 60 read keys have no DB seed row, and several values do
not update until restart (the agent has no watcher, readers cache values at startup, and a watcher
can stall silently). This feature fixes all three: it makes stored keys namespace-relative, seeds
every key the code reads, makes every key live, and adds a CI gate plus SDD skill changes so the
drift cannot come back.

## Next Action

`/sdd-execute fix-config-keys-drift sequential` — continue at Step 5 (Steps 1–4 done 2026-11-06; Step 5 G1 is the operator's run of the Step 2 tool on staging)
