# Context: broker-accounts-ui

**Feature**: `docs/roadmap/features/broker-accounts-ui/feature.md`
**Product Spec**: `docs/roadmap/features/broker-accounts-ui/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/broker-accounts-ui/implementation-spec.md`

---

## Session 2026-05-06T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.

## Session 2026-05-06T00:01:00Z — OQ resolution

- OQ-1 RESOLVED: Account Selector in global persistent header (root layout). Avoids per-page fetch duplication and prop drilling.
- OQ-2 RESOLVED: insights defaults to first account; "All Accounts" option aggregates client-side; selection in URL state for deep-link support.
- Control panel (RegisterBrokerAccount / DeregisterBrokerAccount UI) intentionally kept OUT OF SCOPE — deferred to a separate admin feature. Rationale: credential entry in the browser is a sensitive flow that deserves its own UX design (secure fields, confirmation, error handling); mixing it into the selector adds scope and risk.
- Story: expand `add-ikbr-account-support` scope into a new feature to surface broker accounts in the trader UI.
- Slug `broker-accounts-ui` chosen over literal first argument `expand` (action verb, not a feature name).
- This feature is the explicit UI follow-up deferred in `add-ikbr-account-support` product-spec "Out of Scope": "xstockstrat-trader UI changes: account_id and broker_type are available on Order proto; account selector UI and per-account portfolio view are follow-up features."
- No new proto, migrations, or config keys required — all backend RPCs are already defined by `add-ikbr-account-support`.
- Dependency noted: `feature/add-ikbr-account-support` must be merged to main-dev before this branch's integration PR can land.
