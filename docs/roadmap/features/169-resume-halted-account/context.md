# Context: resume-halted-account

**Feature**: `docs/roadmap/features/169-resume-halted-account/feature.md`
**Product Spec**: `docs/roadmap/features/169-resume-halted-account/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/169-resume-halted-account/implementation-spec.md`

---

## Session 2026-09-02T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Motivation: PR #1067 fixes the root cause of false `unknown_broker_order` halts (DB-grounding the reconciliation poller's classification). This feature adds the operator-facing recovery path so existing (or future) halts can be cleared without DBA intervention or service restart.
- Ledger cross-references:
  - Feature 100 (`account-trading-halt-and-kill-switch`) — `halted` (per-account, automated) and `platform.maintenance_mode` (platform-wide, operator) are orthogonal; this feature touches only `halted`.
  - Feature 102 (`broker-state-reconciliation`) — internal-caller authz patterns; reconciliation poller is the primary producer of automated halts.
  - Feature 030 (`position-limit-brackets`) — introduced `broker_accounts.halted` schema columns.

## Session 2026-09-02 — sdd-design

- Phase 0 Recon: wrote recon.md (services: trading, agent; key reuse patterns: `haltAccount` inverted, `DeregisterBrokerAccountSvc` lifecycle).
- Phase 1 Grilling: 1 round (quick). Chosen approach: ResumeAccount RPC mirroring haltAccount inverted with DB-first ordering, admin-scope gating, manage_account resume branch. Rejected: separate resume_account tool (discoverability cost), memory-first ordering (fail-safe inverts), FailedPrecondition on non-halted (idempotent no-op safer).
- Key adversary finding accepted: DB-first ordering for fail-safe (056 dual-path trap inverted).
- Key adversary finding accepted: TRADING-1 dual Connect+gRPC adapter twin required for wire reachability.
- Constitution rules touched: C-01, C-04, C-08, C-14, C-16, P-03, F-04, F-06, F-11.
- Floor breaches: none.
- Status: draft → design-approved.

## Decisions

- **DB-first resume ordering**: Clear DB halt columns before in-memory maps. Fail-safe reasoning inverts from haltAccount: a DB failure after memory-clear would let the account trade until restart re-halts it from the still-halted DB row. DB-first keeps "stay halted" as the failure mode in both directions.
- **manage_account not a separate tool**: Product spec FR-6 explicitly requires manage_account; discoverability > contract purity. Docstring updated to note conditional auth model.
- **Silent no-op on non-halted**: Consistency with haltAccount's already-halted short-circuit. Idempotent, safe for automation/retry.
- **reason parameter optional**: Default empty string; operator may provide context but it's not required.

## Open Threads

- [ ] First Go-native access-scope check (`requireAdminScope`) — untested propagation chain. Target: implementation step (unit test + integration verification).
- [ ] Stale line citations (~44 lines off) — re-ground at `/sdd-spec` discovery. Target: /sdd-spec.
