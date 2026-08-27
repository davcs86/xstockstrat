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

## Session 2026-08-27 — sdd-design

- Phase 0 Recon: wrote recon.md (service: xstockstrat-agent only; reuse patterns: manage_offline_account tool shape, register_offline_account client wrapper, _OFFLINE_SIDE enum-map idiom, descriptor-parity test).
- Phase 1 Grilling: 1 round (quick). Proposer + adversary + synthesis + operator gate.
- Chosen approach: manage_account (register/update_credentials/deregister verb dispatch) + read-only list_accounts; ownership-gated on x-user-id; _account_to_dict helper; _BROKER_TYPE map (case-normalized).
- Operator decisions at gate: (1) register REJECTS broker_type=offline (one creation path per kind); (2) migrate the existing register_offline_account inline MessageToDict to the new _account_to_dict helper too.
- Adversary findings resolved against the Go backend: UpdateBrokerAccountCredentials rejects OFFLINE (FailedPrecondition, trading.go:2267-2270) and validates JSON server-side (2257) → no client-side guard/validation needed; DeregisterBrokerAccount intentionally supports offline (trading.go:2754-2761) → deregister stays unified. Inbound credential-logging vector checked: CallerPropagationMiddleware forwards trio only, no tool-arg logging/OTel span attrs (main.py/tools.py verified).
- Doc-drift (ledger RC-1): six edits scoped (2 mcp-tools count literals + 2 full entries; CLAUDE.md count + 2 rows; tools.py docstring count + 2 lines).
- Constitution rules touched: C-11, C-14, C-15, C-13, P-03. Floor breaches: none.
- Status: draft → design-approved.
