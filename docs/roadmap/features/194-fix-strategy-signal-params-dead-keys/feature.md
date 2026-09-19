# Feature: fix-strategy-signal-params-dead-keys

**Type**: bug
**Development Branch**: `claude/todays-bug-triage-ubv9ag` (harness-assigned; PR targets `main-dev`)
**Defect Report**: `docs/reports/2026-09-18-deprecated-fields-in-rpc-contracts-defect.md` (Defect 1; GitHub Issues disabled — report is the audit trail)
**Severity**: SEV-3
**Created**: 2026-09-19
**Last Updated**: 2026-09-19

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-19 | `bug-reported` → `draft` | triage (manual, from-report) | Defect 1 of the RPC-contract-hygiene report; contract-hygiene, Track C. (Defect 2 — the 33 deprecated proto fields — routed separately to feature 196 as a governance program.) |
| 2026-09-19 | `draft` → `code-completed` | bug-fix session | Read-side strip chosen after discovering the fingerprint constraint; implemented, tested (4 tests), lint clean. Shipped in the consolidated today's-triage PR. |

---

## Artifacts

- [Product Spec](product-spec.md) — points at the defect report (Defect 1)
- [Acceptance Scenarios](acceptance.feature) — served-payload cleanliness + the fingerprint-stability safety property
- [Context Log](context.md) — the read-side vs write-side/backfill decision (fingerprint-invalidation constraint)

---

## Summary

`StrategyDefinition.signal_params` carries four dead feature-097 blend keys (`signal_sources`,
`signal_weight`, `technical_weight`, `min_conviction`) that no consumer of a `StrategyDefinition`
reads (only `symbols`/`target`/`stop` are load-bearing). They clutter every served payload
(`get_strategy`/`ListStrategyDefinitions`/config-ui/agent), teaching readers a dead field is live
input.

## Fix

Strip the four keys at the read/serialize edge (`_row_to_strategy_definition`, default on) plus on
the write request before persist (REGISTER/full-replace) — NOT via a backfill or an unconditional
write-side re-key, because `_definition_fingerprint` hashes the stored `definition_json`, so re-keying
an existing row (or a backfill) would invalidate its accumulated evidence grade. The one
persist-building mapper call (masked-UPDATE merge) opts out so a rename never churns the fingerprint.

## Next Action

Ships in the consolidated today's-triage PR to `main-dev`. Promote via the next `/promote` cycle.
