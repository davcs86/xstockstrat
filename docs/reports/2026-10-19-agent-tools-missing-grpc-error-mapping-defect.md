# Defect: Six agent MCP tools leak raw gRPC errors (no `_grpc_error_message` mapping)

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: error-leak
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-agent
**Config-only fix possible**: no
**Source**: `services/xstockstrat-agent/docs/context-constitution.md` AGENT-5 ("the older tools don't have it")

## Observed
39 of the 45 registered tools wrap their backend call in `except grpc.aio.AioRpcError → RuntimeError(_grpc_error_message(e))`.
Six do not: `list_signal_sources`, `extract_email_content`, `extract_website_content`, `ingest_signal`,
`emit_alert`, `screen_symbols`. A backend failure on these surfaces as a raw `AioRpcError` (full
status/details/debug string) to the MCP client, and `DEADLINE_EXCEEDED` never gets the
"retry shortly" message every other tool returns. `screen_symbols` documents an INVALID_ARGUMENT
rejection for a mistyped `metric_name` that therefore reaches the model unmapped.

## Expected
Every gRPC-calling tool maps `AioRpcError` through `_grpc_error_message`, as AGENT-5 requires.

## Reproduction
1. Call `screen_symbols` with a criterion whose `metric_name` is a typo.
2. Observe the tool error is the raw `AioRpcError` text rather than a concise mapped message.
3. Repeat with `emit_alert` while `xstockstrat-notify` is down — raw UNAVAILABLE error, no mapping.

## Evidence
`services/xstockstrat-agent/app/tools.py:847`
> `        return await client.screen_symbols(`

`services/xstockstrat-agent/app/tools.py:700`
> `        return await client.emit_alert(`

`services/xstockstrat-agent/app/tools.py:612`
> `        result = await client.ingest_signal(`

`services/xstockstrat-agent/app/tools.py:486`
> `        sources = await client.list_signal_sources(include_inactive=False)`

`services/xstockstrat-agent/app/tools.py:228-230` (the mapping these tools skip)
> `    if code == grpc.StatusCode.DEADLINE_EXCEEDED:`
> `        if deadline_s is None:`
> `            return "upstream did not respond (deadline exceeded); retry shortly"`

## Root cause hypothesis
The wrapper is opt-in per tool; these six tools predate it and were never retrofitted. The two
extract tools reach gRPC via `list_signal_sources` (`app/tools.py:2313`) inside the shared helper.

## Confidence
high
