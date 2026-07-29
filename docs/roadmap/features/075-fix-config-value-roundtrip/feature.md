# Feature: fix-config-value-roundtrip

**Type**: bug
**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/fix-config-value-roundtrip` (this run: implemented on the
harness-designated branch `claude/runs-073-074-sdd-6wtwal` → `main-dev`)
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`; captured directly from
code recon, same adaptation as features 067 and 074
**Severity**: SEV-2
**Created**: 2026-07-29
**Last Updated**: 2026-07-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-29 | `bug-reported` → `draft` | /sdd-triage | Two defects surfaced by `/sdd-review` of feature 073 and confirmed directly in code; split out rather than bundled, following the 073→074 precedent. |
| 2026-07-29 | `draft` → `code-completed` | direct fix | Both defects fixed with a real-wire test suite; red-before-green proven (6 fail → 26/26). Backfill of already-corrupted rows (AC-5) outstanding. |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Step Category | Reviewer Roles |
|---|---|
| `service` — xstockstrat-config | Service owner — config value storage/round-trip, `is_secret` propagation, WatchConfig stream stability |
| Security | Required — defect 2 is the mechanism feature 073's secret redaction depends on |

## Summary

Two related defects in `xstockstrat-config`, both blocking feature 073:

1. **`SetConfig` corrupts every value it writes.** It stores `JSON.stringify(value)` — the whole
   `ConfigValue` message — into `value_data`, while every read path parses `value_data` as a bare
   scalar. A write of `"abc"` reads back as the literal `{"stringVal":"abc"}`. `inferValueType`
   compounds it by testing snake_case fields against a camelCase request, so every int/float/bool
   write is recorded as `value_type='string'`. Live today for any key written through config-ui.
2. **`ConfigValue.is_secret` is never populated on the read path**, so `GetConfig`/`WatchConfig`
   report `is_secret == false` for every key — including `secret.*` ones. Latent today; it becomes
   a secret-disclosure bug the moment any consumer trusts the field, which is exactly what feature
   073's `get_config` redaction is specified to do.

## Next Action

Merge with PR #805. **Outstanding:** size and repair already-corrupted rows —
`SELECT key, value_data FROM config.config_values WHERE value_data LIKE '{%Val%}'` per environment.
The fix stops new corruption but does not repair existing rows.
