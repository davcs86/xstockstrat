# Product Spec: fix-agent-getconfig-deadline

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-agent-get-config-value-no-deadline-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** `client.get_config_value` makes a one-shot `GetConfig` call with no `timeout=`
(`services/xstockstrat-agent/app/client.py:1751-1754`). A config service that accepts connections but stalls
blocks every caller indefinitely. The only guard is the fixed 3s `_POLICY_READ_TIMEOUT_S` `asyncio.wait_for`
(`app/tools.py:2367`), and it is applied only to the `list_opportunities` policy read (`:1552-1553`, feature
227). These callers are unbounded:

- `_fetch_url`'s four serial `_agent_policy` reads (`agent.extract.*`, `tools.py:2397-2400`). They run before
  every `extract_website_content` fetch and every `extract_email_content` `urls` fetch (`tools.py:543`).
- `ingest_signal`'s post-commit `signal.alert_threshold` read (`tools.py:627`).
- OAuth DCR `oauth.registration_enabled` / `oauth.allowed_redirect_uris` reads (`app/oauth_server.py:84,104`).

**Expected.** See FR-1..FR-3.

## Functional Requirements

FR-1. `get_config_value` applies a default gRPC deadline D to `GetConfig` for every caller. On a stall the call
  raises `grpc.aio.AioRpcError` `DEADLINE_EXCEEDED` (propagated per feature 093, `client.py:1755-1758`).
  D is a fixed constant, not a config key (see Fix Scope). D ≤ 3.0 s unless the feature-227 `wait_for`
  (`tools.py:1551-1554`) stays: durable rule `services/xstockstrat-agent/acceptance/fix-opportunities-read-hangs.feature`
  `@AC-2 @feature-227` budgets `list_opportunities` under the MCP client's 60 s.
FR-2. On a timeout each caller takes its existing fallback path, because every caller already catches
  `Exception` (`tools.py:2375`, `:633`; `oauth_server.py:87`, `:107`):
  - `_agent_policy` returns its default;
  - `ingest_signal` uses `_ALERT_THRESHOLD_DEFAULT` 0.6 (`tools.py:77`);
  - DCR treats registration as enabled with an empty allowlist (https-only redirect URIs).
FR-3. The success path is unchanged: a config service that answers within D returns the same value as today.

## Reproduction Steps

1. Make the config service accept connections but stall `GetConfig` (e.g. pause the process).
2. Call the `extract_website_content` or `ingest_signal` MCP tool.
3. The tool call does not return until the client-side MCP timeout fires.

## Root Cause Hypothesis

Feature 093 fixed scope, typing and error surfacing in the helper but never added a deadline. Feature 227
patched only its own call site with `wait_for`.

## Affected Services

- xstockstrat-agent
- xstockstrat-config: the stalled dependency only; no change.

## Consumer Surface(s)

These agent MCP tools now return within a bound when config hangs: `extract_website_content`,
`extract_email_content` (`urls` path), `ingest_signal` and `list_opportunities` (already bounded). The agent's
OAuth `/oauth/register` endpoint (`app/main.py:227`) also returns within a bound. Tool names, parameters and
return shapes are unchanged.

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated: the deadline on a config read cannot itself be read from config
  (circular). It is a fixed invariant like `_POLICY_READ_TIMEOUT_S`, and the value is settled at design.

## Acceptance Criteria

See `acceptance.feature`: the regression scenario(s) must fail on the buggy behavior and pass after the
fix (Constitution **C-15**). Also, existing tests pass and the affected service is smoke-tested on dev.

## Out of Scope

- Deadlines on other agent → backend RPCs
- The config service's own stall behaviour
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
