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

## Session 2026-08-27 — sdd-spec

- Generated implementation-spec.md with 5 steps. Status → implementation-ready.
- Steps: (1) client.py — `_BROKER_TYPE` map + `_account_to_dict` helper + four trading-RPC wrappers, migrate `register_offline_account` to `_account_to_dict`; (2) test_broker_account_client.py — mock-stub request/metadata/no-echo tests + BrokerAccount descriptor-parity guard; (3) tools.py — `manage_account` (register/update_credentials/deregister) + read-only `list_accounts` + docstring count thirty→thirty-two; (4) test_account_tools.py + update test_tools_endpoint.py exact name-set; (5) docs — mcp-tools.md (2 count literals + 2 reference entries) + agent CLAUDE.md (count + 2 rows).
- Key codebase findings (all grounded path:line):
  - Client reuse anchors confirmed: `register_offline_account` skeleton (`client.py:1624-1642`), `_OFFLINE_SIDE` map idiom (`:1615`), `_order_to_dict` (`:1619`), `list_account_orders` comprehension (`:1729-1739`); `TRADING_ENDPOINT` (`:26`), `_metadata` (`:59`).
  - Tool reuse anchors: `manage_offline_account` verb-dispatch tool (`tools.py:1467-1548`), `_caller_user_id` (`:116`), `_grpc_error_message` (`:184`); module docstring "Thirty tools:" (`:4`, list ends L34); `/api/tools` built dynamically from `server.list_tools()` (`main.py:112-123`) — no count literal there.
  - Proto verified: BrokerAccount has NO credential field (`trading.proto:217-237`) → MessageToDict is structurally credential-safe; response `.account` on register/update (`:252,:263`), empty deregister response (`:286`), `ListBrokerAccountsResponse.accounts` (`:278`); BROKER_TYPE ALPACA=1/IBKR=2/OFFLINE=3 (`common.proto:68-74`).
  - **New surface the design missed — folded into Step 4:** `tests/test_tools_endpoint.py:22-54` asserts the EXACT set of 30 tool names (`names == {...}`); adding two tools breaks it unless the two names are appended. Included in Step 4 instructions.
  - **Out-of-scope flag:** `services/xstockstrat-ui/src/lib/copilot.ts:14` `COPILOT_MCP_TOOL_COUNT = 24` is a numeric agent-tool-count surface in a DIFFERENT service (xstockstrat-ui, product-spec marks it unaffected) and is ALREADY drifted (24 vs prose "thirty"), so it does not track the live count today. Approved design scoped drift discharge to agent surfaces only; left out of scope, raised in report for operator decision. (fails.md:1530-1532, feature 130.)
  - Agent coverage gate: CI matrix `xstockstrat-agent` threshold 40%, `--cov=app` (`.github/workflows/ci.yml:346-347`); lint `ruff check . && ruff format --check .`; `asyncio_mode = "auto"` (`pyproject.toml:31`).

## Session 2026-08-27 — sdd-execute (implemented on harness branch)

- Implemented all 5 steps on `claude/mcp-account-management-tools-zvbwdl` (harness git rules pin work
  to this branch → single PR into main-dev; SDD per-step-PR model yields to that).
- Step 1 (client.py): `_BROKER_TYPE={"alpaca":1,"ibkr":2}`, `_account_to_dict` helper, four wrappers
  (`register_broker_account`/`update_broker_account_credentials`/`deregister_broker_account`/
  `list_broker_accounts`); migrated `register_offline_account` to `_account_to_dict`.
- Step 3 (tools.py): `manage_account` (register/update_credentials/deregister, case-normalized
  offline steer) + read-only `list_accounts`; docstring count → thirty-two + two list lines.
- Steps 2/4 (tests): `test_broker_account_client.py` (request fields + x-user-id metadata + no
  credential echo + BrokerAccount descriptor-parity guard freezing the 12-field contract),
  `test_account_tools.py` (verb dispatch, offline steer, PERMISSION_DENIED→RuntimeError, unknown-op,
  /api/tools catalog), and appended the two names to `test_tools_endpoint.py`'s exact-match set.
- Step 5 (docs): mcp-tools.md (2 count literals + 2 full reference entries), agent CLAUDE.md (count +
  2 table rows).
- **Deviation (operator-approved):** also synced `services/xstockstrat-ui/src/lib/copilot.ts`
  `COPILOT_MCP_TOOL_COUNT` 24 → 32 — the ledger (fails.md:1530-1532) mandates syncing all six
  tool-count surfaces on every agent-tool change, and it was already stale. One-line UI edit; no test
  asserts a specific value. Recorded in implementation-spec.md Deviation Log.
- Verification: `ruff check .` + `ruff format --check .` clean; full agent suite **316 passed, 77%
  cov** (gate 40%). Offline-client tests still green (the `_account_to_dict` migration is behavior-
  preserving).
- Status: implementation-ready → code-completed.

## Session 2026-08-30 (CI: feature status automation)

- Promotion PR #1047 merged to main
- Feature promoted and committed: 57e40a310ed09b205ce76ca440ee7a40a87fb7ec
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-30
