# Defect: Agent `extract_email_content` exceeds the MCP 60 s budget during a config stall for five or more URLs

**Recorded**: 2026-10-29
**Severity**: SEV-2
**Impact type**: mcp-budget-exceeded
**Environment**: dev (feature/fix-agent-getconfig-deadline @ 841b404a)
**Affected service(s)**: xstockstrat-agent
**Config-only fix possible**: no
**Source**: feature 247 (`docs/roadmap/features/247-fix-agent-getconfig-deadline/design.md` § Open Risks). This is the
residual left after feature 247 bounded each `get_config_value` read at `_CONFIG_READ_TIMEOUT_S` = 3.0 s (D).

## Observed

With feature 247, every `get_config_value` read expires after D = 3.0 s when the config service stalls. `_fetch_url`
still makes four serial `_agent_policy` reads per call, so each URL costs 4×D = 12 s before its fetch starts.
`extract_email_content` calls `_fetch_url` once per URL in a loop, so a config stall costs N×4×D. At N >= 5 URLs
that is 60 s or more, which exceeds the MCP client's 60 s request budget. The tool call times out even though every
read falls back to its default.

## Expected

One `GetConfig` snapshot per tool call. `GetConfig` already returns the whole `agent` namespace, so a single read
(bounded at D) supplies all four `extract.*` policy values for every URL in the call. A stall then costs D, not
N×4×D. Running the reads concurrently with `asyncio.gather` is rejected as the remedy: it adds concurrency over
still-redundant reads instead of removing them (`docs/roadmap/ledger/insights.md:2240-2244`).

## Reproduction

1. Run the agent against a config service that accepts connections but never answers `GetConfig` (the
   `hung_config_server` fixture in `services/xstockstrat-agent/tests/conftest.py`, hang mode).
2. Call `extract_email_content(source_slug=<a source without credentials>, urls=[5 URLs])`.
3. Observed: about 5 × 4 × 3.0 s = 60 s pass before the tool returns, so the MCP client gives up first. Expected:
   the tool returns within about D plus the fetch time.

## Evidence

`services/xstockstrat-agent/app/tools.py:541-543` (per-URL `_fetch_url` in `extract_email_content`)
> if urls:
>     for url in urls:
>         text = await _fetch_url(url, password=None)

`services/xstockstrat-agent/app/tools.py:2410-2413` (four serial policy reads per `_fetch_url` call)
> max_redirects = int(await _agent_policy("extract.max_redirects", 5, int))
> max_bytes = int(await _agent_policy("extract.max_bytes", 5_000_000, int))
> connect_timeout = await _agent_policy("extract.connect_timeout_seconds", 10.0, float)
> read_timeout = await _agent_policy("extract.read_timeout_seconds", 30.0, float)

`packages/proto/config/v1/config.proto:49` (the RPC already returns the whole namespace)
> message ConfigSnapshot {

## Root cause hypothesis

`_agent_policy` reads one key per `GetConfig` call, and `_fetch_url` re-reads all four keys per URL. The stall
cost therefore scales with keys × URLs instead of being paid once per tool call.

## Confidence

high (static read; feature 247's `test_extract_email_content_urls_proceeds_on_stalled_config` measures the 4 reads
for one URL)
