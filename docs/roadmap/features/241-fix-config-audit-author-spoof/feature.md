# Feature: fix-config-audit-author-spoof

**Type**: bug
**Development Branch**: `feature/fix-config-audit-author-spoof`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-config-audit-author-caller-spoofable-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-28

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-config-audit-author-caller-spoofable-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (9 warnings) |
| 2026-10-20 | `spec-ready` (unchanged) | /sdd-review | Product spec re-reviewed, PASS WITH WARNINGS (8 warnings); FR-1..FR-4, AC-4, Open Questions Q1-Q5 added |
| 2026-10-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved under operator standing authorization; recon.md + design.md written |
| 2026-10-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 13 steps |
| 2026-10-28 | `implementation-ready` (unchanged) | /sdd-execute | Re-spec: steps 6,7,8,10,12,13 aligned with current codebase (line drift; mcp 2.3.0; Step 6 C-13 literal centralized in `internal/testdata`) |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started (sdd-batch-execute); up-front plan confirmed by operator standing authorization |
| 2026-10-28 | `in-progress` (unchanged) | /sdd-execute | Step 1 done: `SetConfigRequest.author` deprecated in place (`buf lint` / `buf breaking` pass) |
| 2026-10-28 | `in-progress` (unchanged) | /sdd-execute | Step 2 done: stubs regenerated (Go/Python/TS, config-only diff; freshness re-run clean; trading + config builds pass) |
| 2026-10-28 | `in-progress` (unchanged) | /sdd-execute | Step 3 done: config `SetConfig` credits only `x-user-id` or the authorized `x-internal-caller`; body `author` ignored (build + lint pass) |
| 2026-10-28 | `in-progress` (unchanged) | /sdd-execute | Step 4 done: config tests pin AC-1/AC-2/AC-3 attribution and rejection; admin fixtures send `x-user-id` (182/182 pass, c8 86.77% lines, lint 0 errors) |

---

## Reviewers

Canonical snapshot from `docs/runbooks/reviewer-registry.md`, written by /sdd-spec on 2026-10-20 from the
per-step `**Reviewers**` in `implementation-spec.md`.

| Reviewer | Steps | Focus |
|---|---|---|
| Proto Reviewer | 1, 2 | Field number uniqueness, no breaking change without a deprecation comment, `buf lint` / `buf breaking` pass |
| `xstockstrat-config` owner | 1, 2, 3, 4 | Config key naming, environment / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability |
| Security | 3 | Auth scope and audit attribution: derived from propagated headers (`x-user-id` / authorized `x-internal-caller`), never request-body free text |
| `xstockstrat-trading` owner | 1, 2, 5, 6 | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| `xstockstrat-agent` owner | 1, 2, 7, 8 | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; admin `x-access-scope` forwarded only by the management tools; no secret values in tool output |
| `xstockstrat-ui` owner | 1, 2, 9, 10 | Config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI |

Steps 11-13 (docs) have no reviewer.

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 grounded codebase dossier
- [Design](design.md) — approved design (2 rounds, full): chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 13 steps: proto → config → trading → agent → ui → docs
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`SetConfig` authorizes on the verified `x-user-id` / `x-access-scope` but records the caller-supplied free-text
`author` as `updated_by` / `config_audit.changed_by`, so any admin (or a user on their own per-user row) can
attribute a write to someone else. The MCP `set_config` tool passes `author` straight through.

## Next Action

`/sdd-execute fix-config-audit-author-spoof sequential` — Step 8 (test: agent outbound SetConfig carries no author, the parameter is gone, the probe holds (AC-4))
