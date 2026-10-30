# Defect: Agent backend gRPC calls carry no deadline, so a stalled backend hangs MCP tool calls indefinitely

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: unbounded-rpc-hang
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-agent
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), finding D-16. Re-verified against main-dev @ a053b0e on 2026-10-21; current lines below. The single `get_config_value` → `GetConfig` call is already covered by `2026-10-19-agent-get-config-value-no-deadline-defect` (feature `247-fix-agent-getconfig-deadline`) and is excluded here; this report covers every other agent → backend RPC.
**Cross-reference** (added 2026-10-29): feature 247 excluded `client.get_config` (`GetConfig`, the `get_config` tool) and `register_oauth_client` (`RegisterOAuthClient`, identity, used by `/oauth/register`) from its fix and routes both here (feature 273) instead of filing a separate report.

## Observed

### D-16 — Agent `client.py` repeats ephemeral-channel boilerplate with no default deadline

`services/xstockstrat-agent/app/client.py` opens a fresh `mtls.secure_channel(...)` per call (69 sites) and issues
71 unary stub calls. Exactly one passes `timeout=` (`ListOpportunities`, plumbed by feature 227), and one more
(`get_config_value`'s `GetConfig`) is being fixed by feature 247. Every other call — `IngestSignal`, `EmitAlert`,
`RunBacktest`, `ScreenSymbols`, `RunFundamentalsScan`, `TriggerBackfill`, every trading/portfolio/indicators/
identity/ledger/notify read and management call, and the second config `GetConfig` used by the `get_config` tool —
waits forever if the backend accepts the connection but does not respond (a hung handler such as the config
await-outside-try paths, a stuck DB pool, a paused process). `mtls.secure_channel` sets no default deadline or
keepalive either. The MCP tool call then blocks until the client-side MCP timeout fires, holding the agent request
and its channel, with no `DEADLINE_EXCEEDED` surfaced to the caller or to logs.

## Expected

Every agent → backend unary RPC has a bounded deadline. Short reads/writes get a default deadline; known
long-running RPCs (`RunBacktest`, `TriggerBackfill`, `RunFundamentalsScan`, `ScreenSymbols`) get an explicit,
larger budget that still sits inside the MCP request timeout (PLAT-13 cross-hop ordering). A stalled backend
surfaces `DEADLINE_EXCEEDED`, mapped by the tools' existing gRPC error handling to a clear tool error.

## Reproduction

1. Run the agent against a backend that accepts connections but stalls its handler (e.g. `kill -STOP` the
   `xstockstrat-portfolio` process, or a fake gRPC server whose handler awaits forever).
2. Call an MCP tool backed by it, e.g. `get_positions` (→ `client.list_positions` → `ListPositions`, `client.py:2374`).
3. Observed: the tool never returns until the MCP client gives up. Expected: a `DEADLINE_EXCEEDED`-derived tool error
   within the default deadline.
4. Static check: `grep -c "secure_channel(" services/xstockstrat-agent/app/client.py` → 69;
   `grep -n "timeout=" services/xstockstrat-agent/app/client.py` → only `:872`.

## Evidence

### D-16 — no default deadline on agent backend calls

`services/xstockstrat-agent/app/mtls.py:37-43` (channel factory: no deadline, no keepalive options)
> def secure_channel(endpoint: str, target_service: str) -> grpc.aio.Channel:
>     return grpc.aio.secure_channel(
>         endpoint,
>         channel_credentials(),
>         options=[("grpc.ssl_target_name_override", target_service)],

`services/xstockstrat-agent/app/client.py:866-872` (the only call with a deadline)
> resp = await stub.ListOpportunities(
> ...
>     timeout=timeout,

Representative unbounded calls in `services/xstockstrat-agent/app/client.py`:
- `:242` `await stub.IngestSignal(`
- `:282` `await stub.EmitAlert(req, metadata=_metadata())`
- `:634` `await stub.RunBacktest(req, metadata=_metadata(("x-user-id", user_id)))`
- `:746` `await stub.ScreenSymbols(`
- `:1712` `await stub.RunFundamentalsScan(`
- `:1949` `await stub.TriggerBackfill(req, metadata=meta)`
- `:2043` `await stub.GetConfig(` (the `get_config` tool path — not the `get_config_value` site that feature 247 fixes at `:1751`)

The only tool-level bound is `services/xstockstrat-agent/app/tools.py:1551` (`asyncio.wait_for` on the
`list_opportunities` policy read).

## Root cause hypothesis

Each client function was written as a self-contained "open channel, call, close" block with no shared call helper,
so no default deadline ever had one place to live; deadlines were added per call site only when a specific hang was
reported (features 227 and 247).

## Confidence

high (static read of current code; the hang is the documented behaviour of a grpc.aio unary call without a
deadline, matching the reproduced `get_config_value` case in the covered report).
