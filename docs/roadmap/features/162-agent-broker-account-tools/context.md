# Context: agent-broker-account-tools

**Feature**: `docs/roadmap/features/162-agent-broker-account-tools/feature.md`
**Product Spec**: `docs/roadmap/features/162-agent-broker-account-tools/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/162-agent-broker-account-tools/implementation-spec.md`

---

## Session 2026-08-27 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Scope confirmed with operator up front (AskUserQuestion): **full broker-account CRUD**
  (register + update_credentials + deregister + list) via a `manage_account` write tool, plus a
  `list_accounts` read tool returning broker **and** offline accounts together.
- Key realization: offline accounts are already `BrokerAccount` rows (`broker_type=OFFLINE`), so the
  "unified list" is simply `ListBrokerAccounts` — no aggregation across two backends needed.
- All four trading RPCs already exist (`packages/proto/trading/v1/trading.proto`) → **no proto, config,
  or DB change**. Agent is the only service touched.
- Known trap flagged for design (Ledger F-12 / RC-1): agent tool docstrings + `mcp-tools.md` +
  tool-count statements drift from code; update them in the same PR and consider a
  `BrokerAccount`-field-parity test (the one non-drifting tool, `run_backtest`, has one).
