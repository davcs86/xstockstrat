# Feature: fix-push-untargeted-broadcast

**Type**: bug
**Development Branch**: `feature/fix-push-untargeted-broadcast`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-notify-untargeted-push-broadcasts-all-users-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-notify-untargeted-push-broadcasts-all-users-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings; overlap WARN ×3) |
| 2026-10-20 | `spec-ready` (unchanged) | /sdd-review | Product spec re-review: PASS WITH WARNINGS (6 warnings, 4 notes; no Floor breach); overlap WARN ×4 (215 same-function, 244, 240, 251), no FAIL. Low-cost warnings fixed in product-spec.md + acceptance.feature |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved under operator standing authorization; recon.md + design.md written |
| 2026-10-21 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 15 steps |
| 2026-10-28 | `implementation-ready` (unchanged) | /sdd-execute (re-spec) | After `git merge -X ours origin/main-dev`: steps 3, 8, 10, 11, 14, 16 re-specced to current line anchors; Step 10 C-13 premise/grep restated; Step 16 names the out-of-scope systemic escalation alert (`trading.go:2183-2189`) |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Up-front plan confirmed by operator standing authorization (operator chat 2026-10-28, session_01NpS3HShZK6pSnogA7CFo2f) |
| 2026-10-28 | `in-progress` (unchanged) | /sdd-execute sequential | Step 1 done — `IdentityService.ListAdminUserIds` rpc + request/response messages added to `identity.proto`; `buf lint` + `buf breaking` (vs main-dev and origin/main-dev) pass |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 2 done — Go/Python/TS identity stubs regenerated for `ListAdminUserIds` via `./scripts/buf-gen.sh`; identity-only drift, second run empty diff (proto-freshness) |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 3 done — identity `ListAdminUserIds` handler (`src/grpc/adminDirectory.ts`, exact peer-SAN `xstockstrat-notify`, header-blind, IDs-only, generic INTERNAL) + `IdentityServiceImpl` delegate; build/lint/test green |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 4 done — identity `ListAdminUserIds` deny matrix (`adminDirectory.test.ts`, AC-9/AC-10) + real-socket mTLS case (`mtls.test.ts`, notify vs client leaf); identity suite 78 → 89 pass, build/lint green |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 5 done — notify `AdminDirectory` client (`src/services/adminDirectory.ts`: single-flight, no cache, 2000 ms deadline, trio relayed, fail-closed on unset `IDENTITY_ENDPOINT`) + `IDENTITY_ENDPOINT` in the notify block of compose and both DO specs; build/lint/test green |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 6 done — notify `AdminDirectory` tests (`adminDirectory.test.ts`: AC-8 freshness, single-flight, deadline/no `waitForReady`, trio-only relay, AC-11 failure + missing endpoint) + real-socket mTLS case to an `xstockstrat-identity` leaf (`mtls.test.ts`); notify suite 70 → 79 pass, coverage/lint green |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-21), collected from every step's **Reviewers** line.

| Reviewer | Focus | Steps |
|---|---|---|
| Proto Reviewer | Field number uniqueness, no breaking change, `buf lint`/`buf breaking` pass | 1, 2 |
| `xstockstrat-identity` owner | JWT expiry and rotation, API key scoping, secret store integration | 1, 2, 3, 4 |
| `xstockstrat-notify` owner | Stream delivery guarantees, backpressure handling, alert deduplication | 1, 2, 5, 6, 7, 8 |
| Security | Auth scope: the new RPC's only authorization is the mTLS peer SAN; no cross-user exposure | 3 |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 9, 10 |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 11, 12 |

Docs steps 13-15: none (governance matrix).

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 grounded codebase dossier
- [Design](design.md) — debated, approved design (live SAN-gated identity `ListAdminUserIds` lookup)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

An alert emitted with an empty `target_user_id` is Web-Pushed to every row of `notify.push_subscriptions`, so
per-user content (portfolio risk breaches, owner-scoped strategy triggers) reaches every user's devices.
Changes feature 165 FR-3 broadcast semantics for the push channel.

## Next Action

`/sdd-execute fix-push-untargeted-broadcast sequential` — Step 7 (notify untargeted push resolves admin audience) onward
