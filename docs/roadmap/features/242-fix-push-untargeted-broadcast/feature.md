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
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Steps 7 + 8 done in one commit (operator Option B) — untargeted Web Push resolves the admin audience (`listAdminUserIds(md)` → `WHERE user_id = ANY($1::text[])`, lookup failure → ERROR once per 60s, no push); `dispatch(alert, call.metadata)`; `createAdminDirectory()` wired in `index.ts`; feature-165 broadcast test rewritten (AC-1/2/5/8/11); notify suite 79 → 88 pass, coverage/lint green |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 9 done — portfolio `emitRiskAlert(ctx, userID, msg)` sets `TargetUserId: userID` on both risk alerts (concentration + drawdown); build/lint/service tests green |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 10 done — portfolio tests pin `TargetUserId` to the owner on concentration (`@AC-3`) and drawdown (`@AC-9`, new `@AC-6`) risk alerts; red→green, coverage, lint green |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 11 done — analysis live loop sets `target_user_id=definition.user_id` on the strategy-trigger and fundamentals-unavailable alerts; `fundsignal_loop` stays a broadcast; ruff green |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 12 done — analysis tests pin `target_user_id` to the owner on the strategy-trigger (`@AC-4`) and fundamentals-unavailable (`@AC-7`, `@AC-6 @feature-215` extended) alerts; red→green, coverage 88.6%, ruff green |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 13 done — agent `emit_alert` docstring and `docs/runbooks/mcp-tools.md` (intro + `broadcast` row) state a broadcast's Web Push reaches admin-role users only; ruff + agent tool tests green |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 14 done — root `CLAUDE.md` (Node outbound callers + notify → identity diagram edge), PLAT-4, `header-propagation.md` (explicit-threading Node form + notify → identity edge) and `inter-service-mtls.md` (Peer-SAN authorization) document the `ListAdminUserIds` edge; verification greps green |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 15 done — notify `CLAUDE.md` (identity dependency, admin-only untargeted push, `IDENTITY_ENDPOINT`), NOTIFY-8 + Pointers, notify findings broadcast bullet → Resolved, identity `CLAUDE.md` (uncounted method phrase + `ListAdminUserIds`), IDENTITY-12 + IDENTITY-3 second exception; manual Teardown for Steps 14-15 (plugin unavailable); verification greps green |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 16 done — C-14 follow-up: defect report `docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md` + `.status` (`open`) for trading's untargeted per-account halt/reconciliation alerts (systemic escalation excluded); provisional slug `fix-trading-account-alert-targeting` recorded in context.md; verification green |
| 2026-10-29 | `in-progress` → `code-completed` | /sdd-execute sequential (sdd-batch-execute) | All 16 steps done; C-16 promotion plan applied (operator standing authorization, auto-confirm): 11 `@AC-*` scenarios promoted as NEW into `services/xstockstrat-{notify,portfolio,analysis,identity}/acceptance/fix-push-untargeted-broadcast.feature` (5/2/2/2); integration PR opened to `main-dev` |

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

Integration PR open against `main-dev` (merge held for the operator). Before it merges, route `/sdd-triage --from-report docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md` (C-14).
