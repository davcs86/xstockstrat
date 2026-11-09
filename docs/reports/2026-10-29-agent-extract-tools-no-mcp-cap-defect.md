# Defect: Agent `extract_*` tools have no MCP-level cap on HTTP egress

**Recorded**: 2026-10-29
**Severity**: SEV-2
**Impact type**: mcp-budget-exceeded
**Environment**: dev (feature/fix-agent-client-deadlines)
**Affected service(s)**: xstockstrat-agent, xstockstrat-config
**Config-only fix possible**: no
**Source**: feature 273 (`docs/roadmap/features/273-fix-agent-client-deadlines/design.md` § Open Risks, R10 and the R7
residual). Feature 273 bounded the backend gRPC part of these tools and left the HTTP part as an accepted exception.

## Observed

`extract_email_content` and `extract_website_content` fetch URLs through `_fetch_url`. Each fetch is bounded only
by the per-request `agent.extract.connect_timeout_seconds` (default 10 s) and `agent.extract.read_timeout_seconds`
(default 30 s); `extract_email_content` fetches its URLs serially. Nothing bounds the tool call as a whole, so with
more than two slow URLs the call runs past the MCP client's 60 s timeout (feature 273 design: backend part 22 s, HTTP
part unbounded at the MCP level). The config-stall cost of the per-URL policy reads is a separate report
(`docs/reports/2026-10-29-agent-config-snapshot-read-defect.md`).

Related residual (feature 273 R7): `test_formula` → `ExecuteFormula` carries a fixed 10 s client deadline
(`_RPC_TIMEOUT_S`), but `indicators.sandbox.timeout_ms` has no SetConfig upper bound. An operator value of 10 000 ms
or more makes every long dry run end in a client deadline instead of the sandbox's own timeout.

## Expected

An extract tool call returns within the MCP budget: a whole-call deadline (or a URL-count / total-time cap) that
returns the texts gathered so far plus a clear error for the rest. `indicators.sandbox.timeout_ms` gets a SetConfig
ceiling below the agent's 10 s `ExecuteFormula` deadline.

## Reproduction

1. Serve three URLs that each accept the connection and trickle bytes just inside the 30 s read timeout.
2. Call `extract_email_content(source_slug=<a source without credentials>, urls=[the three URLs])` over MCP.
3. Observed: the MCP client times out at 60 s. Expected: the tool returns before 60 s.

## Evidence

`services/xstockstrat-agent/app/tools.py:564-567` (serial per-URL fetch, no call-level bound)
> if urls:
>     for url in urls:
>         text = await _fetch_url(url, password=None)

`services/xstockstrat-agent/app/tools.py:2561-2562` (per-request timeouts only)
> connect_timeout = await _agent_policy("extract.connect_timeout_seconds", 10.0, float)
> read_timeout = await _agent_policy("extract.read_timeout_seconds", 30.0, float)

`services/xstockstrat-agent/app/client.py:1054` (fixed 10 s `ExecuteFormula` deadline)
> resp = await stub.ExecuteFormula(req, metadata=_metadata(), timeout=_RPC_TIMEOUT_S)

`services/xstockstrat-indicators/app/handlers/servicer.py:66-68` (an override can only lower the configured value)
> def _clamp_override(override: int, configured: int) -> int:

`services/xstockstrat-config/src/grpc/configServiceImpl.ts` has a SetConfig bound row for
`agent.opportunities.read_timeout_seconds` but none for `indicators.sandbox.timeout_ms` (grep finds no match).

## Root cause hypothesis

The extract tools bound each HTTP request but not the tool call, and the sandbox timeout key was never given a
ceiling tied to the agent's client deadline.

## Confidence

high (static read of the cited code)
