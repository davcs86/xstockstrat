# Context: agent-broker-account-tools  (archived 2026-09-01)
**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-01 — /sdd-archiver

**What**: Added two MCP agent tools: `manage_account` (register / update_credentials / deregister a
broker account) and `list_accounts` (read-only, returns broker + offline accounts together). All four
trading RPCs already existed; the agent was the only service touched. Offline accounts are
`BrokerAccount` rows (`broker_type=OFFLINE`), so "unified list" is simply `ListBrokerAccounts` — no
aggregation across two backends needed. `_account_to_dict` helper centralized the `BrokerAccount`
dict projection and replaced the inline `MessageToDict` in `register_offline_account`. A
`BrokerAccount` descriptor-parity test freezes the 12-field contract. Tool count: 30 → 32.

Also: feature was originally numbered 162 before a numbering collision was discovered. Per
feature-workflow.md, the earlier-created feature (fix-insights-offline-ticket, first commit
2026-08-26) kept 162; this feature moved to 164 (2026-08-31 session, operator-authorized override
of the launched-immutability rule, documentation-only scope change).

**Why (irrecoverable rationale)**:
- The authorization invariants (UpdateBrokerAccountCredentials rejects OFFLINE accounts via
  `FailedPrecondition`, JSON validated server-side; DeregisterBrokerAccount intentionally supports
  offline) were confirmed from the Go backend and NOT duplicated client-side — client-side re-validation
  would drift from the backend rule.
- `_BROKER_TYPE = {"alpaca": 1, "ibkr": 2}` is the explicit broker-type map for incoming string
  normalization; `OFFLINE=3` is intentionally omitted (register REJECTS `broker_type=offline` —
  only one creation path per kind).
- `tests/test_tools_endpoint.py:22-54` asserts the EXACT set of 30 tool names; adding two names
  without updating this test breaks CI. This was caught at `/sdd-spec` grounding time (not design
  time) and added to Step 4's instructions.
- `COPILOT_MCP_TOOL_COUNT` in `services/xstockstrat-ui/src/lib/copilot.ts:14` was already stale
  (24 vs actual 30) before this feature; synced to 32 as an operator-approved deviation, per the
  ledger mandate to keep all six tool-count surfaces in sync.

**Rejected alternatives**:
- Client-side OFFLINE guard on `update_credentials`: rejected (backend already rejects with
  `FailedPrecondition`; duplication risks drift).
- Separate `register_broker_account` + `deregister_broker_account` tools instead of verb dispatch
  under `manage_account`: rejected (consistency with `manage_offline_account` / `manage_strategy`
  pattern; reduces tool-count surface).

**Scars & gotchas**:
- All six tool-count surfaces must be updated atomically on every agent tool addition: (1) `tools.py`
  docstring count + enumeration, (2) agent `CLAUDE.md` count + table rows, (3) `mcp-tools.md` header
  count, (4) `mcp-tools.md` per-tool reference entries, (5) `test_tools_endpoint.py` exact-name set,
  (6) `copilot.ts` `COPILOT_MCP_TOOL_COUNT`. The `BrokerAccount` descriptor-parity test in
  `test_broker_account_client.py` guards against field drops on the projection.
- The 2026-08-31 renumbering (162→164) changed only documentation and provenance comments — no
  behavior, API, schema, or migration change. `feature/agent-broker-account-tools` branch was also
  renamed; the CI commit hash `57e40a310ed09b205ce76ca440ee7a40a87fb7ec` is unchanged.

**Permanent deviations**:
- Operator-authorized renumbering 162→164 after launch (Constitution immutability override,
  documented in context.md).
- `COPILOT_MCP_TOOL_COUNT` 24→32 at execute time (was already stale pre-feature; synced as deviation).

**Cross-feature signal**:
- The six-surface tool-count sync rule is now captured in ledger insights.md 2026-09-01.
- `test_tools_endpoint.py` exact-set assertion is a CI trap for any agent tool addition — check it
  at `/sdd-spec` grounding time, not at CI.

**Deferred follow-ons**: None.

**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-09-01 entries for 164-agent-broker-account-tools.

**Runtime-invariant recommendations (→ /context-constitution)**: None.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at
commit preceding the archive branch `claude/archive-batch-2026-09-01`.
