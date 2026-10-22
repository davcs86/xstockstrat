# Defect: Signal-source bearer secret is orphaned when the source register fails

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: orphaned-secret-rows
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-agent, xstockstrat-config, xstockstrat-ingest, xstockstrat-ui (`src/app/config-ui/hooks/useSignalSourceMutations.ts`, same secret-first flow)
**Config-only fix possible**: no
**Source**: `services/xstockstrat-agent/docs/context-constitution-findings.md` § Open questions, `manage_signal_source` bearer-token orchestration

## Observed
`manage_signal_source register` (source_type `mcp_client`) and `instantiate_template` (kind
`signal_source`) write the bearer token as a per-user encrypted config secret under a fresh
`ingest.mcp_credential.<uuid>` key BEFORE calling ingest. If the ingest call then fails, the
except branch only re-raises — no compensating delete. Each failed retry mints another orphan
secret row (redacted on read, but ciphertext persists indefinitely, unreferenced).

## Expected
Either a compensating cleanup of the just-written secret on a failed register, or an explicit
maintainer ruling that orphans are an accepted trade-off plus a sweep. `config.proto` exposes no
delete RPC (only WatchConfig, GetConfig, SetConfig, ListKeys, GetSecret), so a compensating delete
needs a new config RPC; otherwise the only remedy is a sweep of `ingest.mcp_credential.*` keys that
no source's `credentials_ref` references.

## Reproduction
1. Call `manage_signal_source` `register` with `source_type=mcp_client`, a `bearer_token`, and a slug that already exists (ingest rejects).
2. Tool returns the mapped error.
3. `list_config_keys namespace=ingest` (caller scope) shows a new `mcp_credential.<uuid>` key referenced by no source.

## Evidence
`services/xstockstrat-agent/app/tools.py:344`
> `    Secret-first: a failed source write afterwards only orphans a redacted secret. The key is opaque`

`services/xstockstrat-agent/app/tools.py:1308-1310`
> `        if operation == "register" and source_type == "mcp_client" and bearer_token:`
> `            credentials_ref = await _write_source_bearer(`

`services/xstockstrat-agent/app/tools.py:1320-1321`
> `        except grpc.aio.AioRpcError as e:`
> `            raise RuntimeError(_grpc_error_message(e, not_found="signal source not found")) from e`

`services/xstockstrat-agent/app/tools.py:1222`
> `            credentials_ref = await _write_source_bearer(`

## Root cause hypothesis
No two-phase write across config and ingest; secret-first ordering was chosen so a source never
references a missing secret, accepting orphans without cleanup. Intentional and documented
(`tools.py:344` docstring, from commit a988b1d, feature 224; the UI hook carries the same note).
What remains open is a maintainer ruling on whether the orphans are acceptable.

## Confidence
high. A scratch pytest with mocked clients passed 2/2: for both `manage_signal_source` register
and `instantiate_template` signal_source, an ingest `ALREADY_EXISTS` failure raised the mapped
error, two retries wrote two distinct `mcp_credential.<uuid>` secret rows, and no delete was called
(the client has no config-delete helper).
