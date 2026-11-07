# Feature: fix-config-keys-contract

**Type**: bug
**Development Branch**: `feature/fix-config-keys-contract`
**GitHub Issue**: n/a. Defect report `docs/reports/2026-11-04-config-key-drift-and-subscription-gaps-defect.md` (shared with feature 295)
**Severity**: SEV-2
**Created**: 2026-11-04
**Last Updated**: 2026-11-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` → `draft` | /sdd-design (295 re-scope) | Split from 295 as Release B (contract), per operator decision 13 recorded in 295's context.md |
| 2026-11-05 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 review passes; 1 advisory warning fixed; overlap: no FAIL attributable to 296) |
| 2026-11-07 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + design.md written. Scope split into 4 features (296 contract / B consumers / C dead rows / D alias removal); product-spec FR-2/FR-3/FR-5/FR-7/FR-8/FR-9 and acceptance.feature amended (AC-2/7/13/14 retired, AC-16..24 appended) per operator decisions; C-16 CHANGE list signed off (context.md) |
| 2026-11-07 | `design-approved` (unchanged) | /sdd-review product-spec (re-review) | Amended spec + acceptance re-reviewed: PASS WITH WARNINGS (4 advisory, 3 fixed in the spec, AC-wording tightening deferred to /sdd-spec); overlap FAIL attributed to drafts 280 and 299 (prefixed seeds), resolved by new blocking merge-order rows; merge-order row 26 resolved (295 launched, 040/041/043 on origin/main) |

---

## Artifacts

- [Product Spec](product-spec.md): contract half of the config-key canonicalisation (amended at design approval)
- [Recon Dossier](recon.md): grounded codebase map, patterns to reuse, existing business rules
- [Design](design.md): debated architecture (5 rounds), rejected alternatives, open risks
- [Acceptance Scenarios](acceptance.feature): `@AC-*`, C-15
- [Implementation Spec](implementation-spec.md): _not yet generated_
- [Context Log](context.md)

---

## Summary

This is the **contract PR** of the config-key canonicalisation (the contract half of 295, split four ways at design approval). It renames every stored config key to the namespace-relative form (migration R), adds the DB CHECK (R+1), rejects prefixed keys on `SetConfig`/`create_key`/`GetSecret` (with a bounded poller exception), activates 295's dormant alias, adds the `prefixed-read` gate kind with a generated shrink-only baseline, and makes config-ui and the agent display the FQN. The consumer literal rewrite (304), dead-row deletion (305) and alias removal (306) are separate features created from this design. It may merge only after `040_config_markers` is on `origin/main` (a `main-dev` → `main` promotion) and 295's staging window has closed; a rollback to 295's images still resolves every key through the alias.

## Next Action

`/sdd-spec fix-config-keys-contract` — generate the implementation spec from the approved design (steps S1–S9 in `design.md` §8). Follow-on features are created: 304 `config-keys-relative-consumers`, 305 `config-dead-rows-prune`, 306 `config-keys-alias-removal` (each `draft`; review/design them in their own sessions). Tighten AC-8, AC-19, AC-22, AC-23 wording during spec (review advisory).
