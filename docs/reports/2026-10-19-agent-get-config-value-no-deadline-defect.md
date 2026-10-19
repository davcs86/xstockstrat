# Defect: Agent get_config_value issues GetConfig with no deadline

**Recorded**: 2026-10-19
**Severity**: SEV-2
**Impact type**: unbounded-rpc-hang
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-agent (dependency: xstockstrat-config)
**Config-only fix possible**: no
**Source**: `docs/context-constitution-findings.md` § Latent bugs row "Agent `get_config_value` has no gRPC deadline" (flagged by feature 227)

## Observed
`client.get_config_value` makes a one-shot `GetConfig` with no `timeout=`. A hung (accepting but
not responding) config service blocks every caller indefinitely. The only guard is the 3s
`_POLICY_READ_TIMEOUT_S` `asyncio.wait_for`, applied solely to the `list_opportunities` policy read.
Unbounded callers include:
- `fetch_url`'s four `_agent_policy` reads (`agent.extract.*`) — no `wait_for`, run before every
  `extract_website_content` fetch.
- `ingest_signal`'s alert-threshold read.
- OAuth registration-enabled / allowed-redirect reads in `oauth_server.py`.

## Expected
`get_config_value` applies a default gRPC deadline (and `_agent_policy` falls back to its default on
timeout) for every caller, not only `list_opportunities`.

## Reproduction
1. Make the config service accept connections but stall `GetConfig` (e.g. pause the process).
2. Call the `extract_website_content` or `ingest_signal` MCP tool.
3. The tool call never returns until the client-side MCP timeout fires.

## Evidence
`services/xstockstrat-agent/app/client.py:1751-1754`
> snapshot = await stub.GetConfig(
> config_pb2.GetConfigRequest(namespace=namespace, environment=env, user_id=user_id),
> metadata=_metadata(),
> )

`services/xstockstrat-agent/app/tools.py:2390-2393`
> max_redirects = int(await _agent_policy("extract.max_redirects", 5, int))
> max_bytes = int(await _agent_policy("extract.max_bytes", 5_000_000, int))
> connect_timeout = await _agent_policy("extract.connect_timeout_seconds", 10.0, float)
> read_timeout = await _agent_policy("extract.read_timeout_seconds", 30.0, float)

`services/xstockstrat-agent/app/tools.py:1552-1553` (the only bounded call site)
> _agent_policy("opportunities.read_timeout_seconds", 40.0, float),
> _POLICY_READ_TIMEOUT_S,

`services/xstockstrat-agent/app/tools.py:627`
> threshold_str = await client.get_config_value(

## Root cause hypothesis
Feature 093 fixed scope/typing/error surfacing in the helper but never added a deadline; feature 227
patched only its own call site with `wait_for`.

## Confidence
high
