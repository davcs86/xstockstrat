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
