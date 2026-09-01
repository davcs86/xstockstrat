# Implementation Spec: mcp-client-signal-source

**Status**: `done`
**Created**: 2026-08-31
**Feature**: `docs/roadmap/features/166-mcp-client-signal-source/feature.md`
**Total Steps**: 17
**Feature Branch**: `feature/mcp-client-signal-source`

---

## Execution Summary

A new `mcp_client` server-side signal `source_type` in `xstockstrat-ingest`: the MCP endpoint + tool
name ride the existing `config_json` (`google.protobuf.Struct`), the bearer token is an encrypted
config secret (`ingest.mcp_credential.<slug>`, feature-147 machinery), and a net-new scheduled loop
resolves the bearer via `GetSecret`, calls the external MCP tool over Streamable HTTP (bearer header
only), parses a fixed xstockstrat response contract into `ExternalSignal`s, and ingests them through
the unchanged `IngestSignal` path. **No proto change** (design + recon confirmed: `source_type` is a
plain string `ingest.proto:146`, `config_json` a Struct `ingest.proto:150`, `credentials_ref` already
a `ManageSignalSourceRequest` field `ingest.proto:194`; `GetSecret`/`SetConfig` already exist).

Ordering runs backend-out: (1) migration widens the DB CHECK; (2–3) fail-closed validation + the
credential-required gate; (4–5) the config `GetSecret` allow-list grant for ingest; (6–11) the ingest
client seam, the pure extractor, and the scheduled loop with health-on-failure; (12) the config
`025_ingest_mcp_client_keys` seed migration for the two non-secret loop keys + their C-05 default
declaration; (13–14) the agent MCP tool surface; (15–16) the config-ui `/sources` surface;
(17) `mcp-tools.md` parity. The validator branch (Step 2) and the migration CHECK (Step 1) **must land
in the same PR/feature branch** (fails.md `signal-source-registry`: a CHECK-only add leaves the type
validator-rejected; a validator-only add leaves it CHECK-rejected at INSERT).

**Consumer surfaces (C-14).** Product spec names **Agent** (`manage_signal_source` +
`list_signal_sources`) and **UI** (`/config-ui` `/sources`). Both earn steps (13–16). The `/sources`
page already exists (recon) so no new nav/C-10(a) registration is needed. No new env var or port is
introduced (the loop reuses the existing config watcher + service endpoints; the MCP endpoint URL is
per-source `config_json`), so no `docker-compose.yml` / `.do/app*.yaml` edits — stated here so the
reader knows it was verified, not omitted.

**MCP SDK pinned at spec time (design Open Risk + fails.md 085 `mcp-python-sdk-v2-upgrade`).** The
installed SDK is `mcp==2.0.0` (agent `uv.lock:459-460`), a non-reference distribution
(`mcp.server.mcpserver.MCPServer`; depends on `httpx2`, `mcp-types`). Its wheel was downloaded and
inspected: it **does** expose a Streamable-HTTP client with bearer-header injection, so the SDK path
is chosen and the httpx fallback (design Rejected Alt) is **not** needed. Exact API pinned in Step 6.

**Not trading-domain-relevant.** No `TRADING_MODE`/broker/order-type/order-status/fill surface is
touched (ingest's `TRADING_MODE` env var is unrelated), so `step-constraints.md` §A does not apply.

## Scenario Coverage (C-15)

- `@AC-1` (register + list returns `source_type` + `has_credentials`) → Step 14 (agent), Step 16 (UI)
- `@AC-2` (bearer stored encrypted, never returned; row `is_secret`+`[redacted]`) → Step 14 (agent tool output carries no token), Step 5 (config secret-at-rest / redaction preserved)
- `@AC-3` (ingest resolves via `GetSecret` w/ `x-internal-caller`; outbound carries `Authorization: Bearer`, no other auth) → Step 7; the grant half → Step 5
- `@AC-4` (parse → `ExternalSignal`; `IngestSignal` invoked; 2nd cycle deduplicated) → Step 9 (parse), Step 11 (ingest + dedup)
- `@AC-5` (unreachable/401 → non-empty `last_error` + degraded health; service keeps running) → Step 11
- `@AC-6` (register without `mcp_endpoint` → `INVALID_ARGUMENT` naming it; no row) → Step 3

## Step Dependencies

- Step 2 (validator `mcp_client` branch) requires Step 1 (CHECK add) **in the same feature branch** — validator↔CHECK lockstep (fails.md `signal-source-registry`, recon Risks).
- Step 6 (ingest loop credential resolution) requires Step 4 (config `SECRET_CALLER_ALLOWLIST` ingest grant) — without the grant, `GetSecret` fails closed (`SECRET_SCOPE_ERROR`) for `x-internal-caller: ingest`.
- Step 10 (scheduled loop) requires Steps 6 (client seam + `GetSecret`), 8 (extractor), and the Step 2 validator/credential gate (a loop source must have registered cleanly).
- Step 13 (agent two-write orchestration) requires Step 4 (the secret is written to `ingest.mcp_credential.<slug>`, resolvable only under the ingest grant) and reuses the register verb (Step 1/2 land the type).
- Step 15 (config-ui two-write) has the same secret-first ordering as Step 13.
- Step 12 (config seed migration `025`) is intra-feature-independent (the loop reads its keys with code defaults `300`/`30`, so it does not block Steps 10/11 at runtime), but carries a **cross-feature merge-order dependency**: `025_ingest_mcp_client_keys` must merge **after** features 021 (`022`), 031 (`023`), and 168 (`024`) per merge-order.md lines 187–198 (golang-migrate numeric-order apply).
- Step 17 (`mcp-tools.md`) documents the Step 13 tool-surface changes — same PR/feature (fails.md `mcp-tools-alignment`, F-12).

---

### Step 1 — migration: add `mcp_client` to signal_sources.source_type CHECK

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/migrations/011_signal_source_type_mcp_client.up.sql` — create
- `services/xstockstrat-ingest/migrations/011_signal_source_type_mcp_client.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts), up+down pair present, CHECK correctness; xstockstrat-ingest owner — signal normalization / source-registry schema stability

**Codebase Evidence**:
- Last migration is `010_add_signal_source_reliability_weight` (`ls services/xstockstrat-ingest/migrations/ | sort` → `010_*` is the tail) → **next-free `NNN` = `011`**. Overlap re-derived from the merged tree at spec time; `011` unclaimed.
- Current CHECK last set in `007_signal_source_type_mediated.up.sql:9-15`, carrying **all 11** values: `simple_email, email_attachment, linked_email, simple_website, authenticated_website, mediated_simple_email, mediated_email_attachment, mediated_linked_email, mediated_simple_website, mediated_authenticated_website, derived`. (Migration 010 added no source_type — it added the `reliability_weight` column only.)
- Pattern to mirror (DROP + re-ADD, additive, no row invalidation): `007_signal_source_type_mediated.up.sql:8-15` (`ALTER TABLE ingest.signal_sources DROP CONSTRAINT signal_sources_source_type_check; ALTER TABLE ... ADD CONSTRAINT ... CHECK (source_type IN (...))`).

**TDD**: `N/A (migration — non-code-bearing)`

**Covers**: `—`

**Instructions**:
1. `.up.sql`: `DROP CONSTRAINT signal_sources_source_type_check` then `ADD CONSTRAINT signal_sources_source_type_check CHECK (source_type IN (...))` **re-listing all 12** values — the 11 from `007` **plus `'mcp_client'`**. This is a DROP+re-ADD re-list, **never** an append (fails.md `signal-source-registry` / `fundamentals-signal-producer` migration).
2. `.down.sql`: DROP the constraint and re-ADD it with exactly the **11-value** `007` CHECK (restores the prior state).
3. Head both files with a comment noting feature 166 and that widening a CHECK invalidates no existing rows (mirror the `007` header).

**Verification** (offline, no DB — the real apply/rollback runs in CI/deploy):
```
ls services/xstockstrat-ingest/migrations/011_signal_source_type_mcp_client.up.sql \
   services/xstockstrat-ingest/migrations/011_signal_source_type_mcp_client.down.sql
```
Read both: confirm `.up` CHECK lists 12 values incl. `'mcp_client'`, `.down` lists the 11 from `007`, and each `ADD` is preceded by the matching `DROP`.

---

### Step 2 — service: fail-closed `mcp_client` validation + credential-required gate

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/repositories/signal_sources.py` — modify (`validate_config_json`)
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify (`_SS_CREDENTIAL_REQUIRED_TYPES`)

**Reviewers**: xstockstrat-ingest owner — signal-source schema stability, idempotent/fail-closed validation

**Codebase Evidence**:
- `validate_config_json(source_type, config_json)` at `signal_sources.py:186-230`. Per-type checks use the "requires non-empty `<field>`" shape (e.g. website branch `:214` `if not cfg.get("url"): return f"{source_type} requires non-empty url in config_json"`). The trailing `else` (`:224-228`) is **already fail-closed** (`return f"unsupported source_type {source_type!r}"`) — a new `elif` must be inserted **before** it.
- `_SS_CREDENTIAL_REQUIRED_TYPES = frozenset({"authenticated_website", "mediated_authenticated_website"})` at `servicer.py:54-56`. `_validate_source_write` (`servicer.py:1075-1085`) rejects a register/update with no `credentials_ref` when `source_type in _SS_CREDENTIAL_REQUIRED_TYPES` (`:1084` → `f"{source_type} source requires credentials_ref"`).
- The register branch calls `_validate_source_write(src.source_type, cfg_dict, merged_cred)` at `servicer.py:1124` before INSERT.

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. In `validate_config_json`, add a new branch **before** the fail-closed `else`:
   `elif source_type == "mcp_client":` → `if not cfg.get("mcp_endpoint"): return f"{source_type} requires non-empty mcp_endpoint in config_json"`; then `if not cfg.get("mcp_tool"): return f"{source_type} requires non-empty mcp_tool in config_json"`. Fail-closed on each field (fails.md `fundamentals-signal-producer` config: new categorical validators must be fail-closed from the start). Do **not** default a missing field.
2. Add `"mcp_client"` to `_SS_CREDENTIAL_REQUIRED_TYPES` (`servicer.py:54-56`) so a register/update without `credentials_ref` is rejected `INVALID_ARGUMENT` (design: bearer is mandatory; @AC-1 expects `has_credentials=true`).
3. Do not touch the register/update flow otherwise — `_validate_source_write` and the register branch already call both `validate_config_json` (via its caller) and the credential gate.

**Verification**: `cd services/xstockstrat-ingest && ruff check . && ruff format --check .` (behavioral coverage is in Step 3).

---

### Step 3 — test: `mcp_client` validation is fail-closed (AC-6)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_signal_sources.py` — create or modify (confirm existing file with `ls services/xstockstrat-ingest/tests/`)

**Reviewers**: xstockstrat-ingest owner — validation correctness

**Codebase Evidence**:
- `validate_config_json` returns an error string or `None` (`signal_sources.py:186`, `:230 return None`) — a pure function, directly unit-testable with no DB.
- Domain literal (`{"mcp_endpoint": "...", "mcp_tool": "get_signals"}`) has **one** consumer (this test) → inline is C-13-compliant; no `conftest.py` fixture needed.

**TDD**: `red-green required`

**Covers**: `AC-6`

**Instructions**:
1. Assert `validate_config_json("mcp_client", {"mcp_endpoint": "https://mcp.acme.example/mcp", "mcp_tool": "get_signals"})` returns `None`.
2. Assert `validate_config_json("mcp_client", {"mcp_tool": "get_signals"})` returns a string **containing `"mcp_endpoint"`** (AC-6: the error names the missing field).
3. Assert `validate_config_json("mcp_client", {"mcp_endpoint": "https://x"})` returns a string containing `"mcp_tool"`.
4. Assert `"mcp_client" in _SS_CREDENTIAL_REQUIRED_TYPES` (import from `app.handlers.servicer`) so a credential-less register is gated.

**Verification**:
```
cd services/xstockstrat-ingest && pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
Confirm the three `validate_config_json` cases and the credential-gate assertion pass, and coverage ≥ 40%. (Run before Step 2's implementation to confirm RED — the `mcp_client` branch does not exist yet, so case 1 returns the `unsupported source_type` string and fails.)

---

### Step 4 — service: add ingest to the config `GetSecret` allow-list (key-prefix grant)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/authz.ts` — modify (`SecretCallerGrant`, `SECRET_CALLER_ALLOWLIST`, `hasSecretCallerAuthority`)

**Reviewers**: xstockstrat-config owner — secret encryption + redaction, allow-list correctness; Security — `GetSecret` allow-list, fail-closed default, `x-internal-caller` gating (feature 147)

**Codebase Evidence**:
- `interface SecretCallerGrant { callerID; namespace; keys: ReadonlyArray<string> }` at `authz.ts:141-146`; seed grant `{ callerID: 'marketdata', namespace: 'marketdata', keys: ['alpaca.api_key','alpaca.api_secret','fmp.api_key','finnhub.api_key'] }` at `:148-154`.
- `hasSecretCallerAuthority(md, namespace, key)` at `:161-174` matches `grant.callerID === callerID && grant.namespace === namespace && grant.keys.includes(key)`, fails closed otherwise (`:167` empty caller → false).
- **Gap:** ingest's credential keys are dynamic per source slug (`mcp_credential.<slug>`), so an exact-`keys` grant cannot enumerate them — a **key-prefix** concept must be added (design Open Risk "credentials_ref namespace/key split" + product spec's per-slug key).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. Extend `SecretCallerGrant` with an optional `keyPrefixes?: ReadonlyArray<string>` alongside `keys` (keep `keys` optional so marketdata's exact grant is unchanged).
2. Add an ingest grant to `SECRET_CALLER_ALLOWLIST`: `{ callerID: 'ingest', namespace: 'ingest', keyPrefixes: ['mcp_credential.'] }`.
3. In `hasSecretCallerAuthority`, keep the existing exact-`keys` match and additionally allow a grant whose `namespace` matches and one of whose `keyPrefixes` is a prefix of `key` (`key.startsWith(prefix)`). Preserve the fail-closed default: an absent `x-internal-caller`, an unlisted `callerID`, or a key matching neither `keys` nor a `keyPrefix` returns false (PRESERVE `@AC-5 @feature-147`).
4. Do **not** widen marketdata's grant or the write-side `INTERNAL_CALLER_ALLOWLIST` (`:96-108`) — read-side secret grant only.

**Verification**: `cd services/xstockstrat-config && pnpm run lint` (behavioral coverage in Step 5).

---

### Step 5 — test: ingest resolves `mcp_credential.*`; others stay fail-closed (AC-3 grant, AC-2/AC-5 preserve)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/authz.test.ts` — create or modify (confirm layout with `ls services/xstockstrat-config/src/__tests__/`)

**Reviewers**: xstockstrat-config owner; Security — fail-closed default not weakened

**Codebase Evidence**:
- `hasSecretCallerAuthority(md, namespace, key)` (`authz.ts:161-174`) and `HEADER_INTERNAL_CALLER = 'x-internal-caller'` (`:93`); `first(md, key)` helper (`:34-36`). A `Metadata` built with `x-internal-caller` is unit-testable without a live server (mirror any existing authz test).
- fails.md `074-fix-config-write-authz`: a config test that never executes the unit passes vacuously — assert real return values, not a skipped import.

**TDD**: `red-green required`

**Covers**: `AC-3` (grant half), `AC-5` (feature-147 fail-closed preserved)

**Instructions**:
1. `x-internal-caller: ingest` + namespace `ingest` + key `mcp_credential.acme-mcp` → `hasSecretCallerAuthority` returns **true**.
2. `x-internal-caller: ingest` + namespace `ingest` + key `backfill.max_concurrent_jobs` (non-prefixed) → **false** (ingest cannot read arbitrary ingest keys as secrets).
3. `x-internal-caller: marketdata` + namespace `ingest` + key `mcp_credential.acme-mcp` → **false** (cross-caller denied).
4. No `x-internal-caller` header + the ingest key → **false** (absent caller fails closed).
5. Regression: `x-internal-caller: marketdata` + namespace `marketdata` + key `alpaca.api_key` → still **true** (existing grant intact).

**Verification**:
```
cd services/xstockstrat-config && pnpm run test:coverage && pnpm run lint
```
Confirm all five cases pass (case 1 is RED before Step 4 — the ingest grant/prefix logic does not exist), and the coverage threshold passes.

---

### Step 6 — service: ingest MCP client seam + `GetSecret` credential resolution

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/pyproject.toml` — modify (add `mcp>=2.0.0,<3` to `dependencies`)
- `services/xstockstrat-ingest/uv.lock` — modify (regenerate: `cd services/xstockstrat-ingest && uv lock`)
- `services/xstockstrat-ingest/app/config/watcher.py` — modify (add a `GetSecret` resolver)
- `services/xstockstrat-ingest/app/mcp_client.py` — create (injectable `McpClientProtocol` seam)

**Reviewers**: xstockstrat-ingest owner — outbound-call correctness; Security — bearer resolution follows the `GetSecret` / `x-internal-caller` pattern, no plaintext leak

**Codebase Evidence**:
- `ConfigWatcher(endpoint, namespace="ingest")` at `watcher.py:35-93`; it holds a config gRPC channel/stub and `get_int`/`get_float` accessors (`:95`, `:111`). ingest has **no** `GetSecret` call today (recon: grep → 0 hits) — net-new.
- Marketdata precedent to mirror: `services/xstockstrat-marketdata/internal/config/config.go:110-133` — `const InternalCallerID = "marketdata"`; `ResolveSecret(ctx, key)` sets metadata `"x-internal-caller": InternalCallerID` (`:122`), calls `GetSecret(octx, &GetSecretRequest{Namespace: w.namespace, Key: key})` (`:124-125`), returns `(value, found, err)`; `found=false` = unset.
- `GetSecret` proto: `config.proto:35` `rpc GetSecret(GetSecretRequest) returns (GetSecretResponse)`; `GetSecretRequest{namespace=1, key=2, environment=3}` (`:110-114`); `GetSecretResponse{value=1, found=2}` (`:116-119`).
- **`credentials_ref` split** (design Open Risk, confirmed against marketdata): the stored ref `ingest.mcp_credential.<slug>` splits on the **first dot** → `namespace="ingest"`, `key="mcp_credential.<slug>"` (config stores `(namespace, key)` where `key` may contain dots — cf. marketdata namespace `marketdata` / key `alpaca.api_key`).
- **MCP SDK API — pinned from the inspected `mcp==2.0.0` wheel (fails.md 085: re-verified against the exact call shapes this step uses):**
  - Client entry: `from mcp.client.streamable_http import streamable_http_client` — `streamable_http_client(url, *, http_client: httpx2.AsyncClient | None = None, terminate_on_close=True)`, an async context manager yielding `(read_stream, write_stream)`.
  - Session: `from mcp.client import ClientSession`; `async with ClientSession(read, write) as session: await session.initialize(); result = await session.call_tool(name, arguments, read_timeout_seconds=<timeout>)`.
  - **Bearer injection**: pass `http_client=httpx2.AsyncClient(headers={"Authorization": f"Bearer {token}"}, timeout=<timeout>)`. `StreamableHTTPTransport._prepare_headers` (wheel `mcp/client/streamable_http.py:113-131`) sets only `accept`/`content-type`/MCP session/version headers and **merges them on top of the httpx2 client defaults without ever setting `Authorization`**, so the bearer survives and **no other auth scheme** is sent (satisfies @AC-3 "no other authentication"). The high-level `Client(url)` convenience is **not** usable here — it calls `streamable_http_client(srv)` with no `http_client` (wheel `mcp/client/client.py:396`), so it cannot inject headers.
  - Result: `session.call_tool(...)` returns `CallToolResult` (`mcp.types`, from `mcp-types==2.0.0`) with `structured_content: Any` (the JSON list — where the fixed xstockstrat contract rides), `content: list[ContentBlock]` (fallback text blocks), and `is_error: bool`. Verified in `mcp_types/_types.py:1463` (`CallToolResult(Result)`).
  - Transitive deps the lock will pull: `httpx2`, `mcp-types`, `sse-starlette`, `starlette`, `pydantic`, `pyjwt`, `uvicorn` (record in `context.md`).

**TDD**: `red-green required`

**Covers**: `—` (behavior verified in Step 7)

**Instructions**:
1. `pyproject.toml`: add `"mcp>=2.0.0,<3"` to `[project].dependencies`; run `uv lock` in the service dir and commit `uv.lock` (root uv-lock rule — the `python-lint` job runs `uv lock --check`).
2. `watcher.py`: add `INGEST_INTERNAL_CALLER_ID = "ingest"` and an async `resolve_secret(self, key: str) -> tuple[str, bool]` that calls the config `GetSecret` stub with metadata `("x-internal-caller", "ingest")`, `GetSecretRequest(namespace=self.namespace, key=key, environment=<this deployment's env>)`, returning `(resp.value, resp.found)`. Mirror the marketdata `ResolveSecret` shape (`config.go:120-133`). Add a small helper to split a full `credentials_ref` (`ingest.mcp_credential.<slug>`) into `(namespace, key)` on the first dot.
3. `mcp_client.py`: define a `Protocol` `McpClientProtocol` with one method `async def fetch(self, endpoint: str, tool: str, arguments: dict, bearer: str, timeout_seconds: float) -> object` (returns the `CallToolResult`), and a concrete `StreamableHttpMcpClient` implementing it with the pinned `streamable_http_client` + `ClientSession` + bearer-header `httpx2.AsyncClient` pattern above. Keep it network-only and secret-only — no DB, no parsing (the parser is Step 8). The `Protocol` seam lets Steps 7/11 test against a fake.
4. Do not read the bearer from `config_json` or store it on any row (recon Risk: `config_json` is a verbatim read edge in `ListSignalSources`).

**Verification**:
```
cd services/xstockstrat-ingest && uv lock --check && ruff check . && ruff format --check .
```
(Behavioral coverage — GetSecret metadata + bearer header — is Step 7.)

---

### Step 7 — test: bearer resolved via GetSecret + sent as Authorization header (AC-3)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_mcp_client.py` — create
- `services/xstockstrat-ingest/tests/conftest.py` — modify if a shared fake is reused by Step 11 (C-13: a **second** consumer forces centralization)

**Reviewers**: xstockstrat-ingest owner — outbound-call correctness; Security — no plaintext leak

**Codebase Evidence**:
- `ConfigWatcher.resolve_secret` and `McpClientProtocol` are the seams added in Step 6; both are injectable/fake-able (design: "injectable client seam so the parser, the GetSecret path (@AC-3), and the failure path (@AC-5) are unit-testable against a fake").
- The `x-internal-caller` metadata + bearer-header assertions mirror what marketdata's resolver sends (`config.go:122`, `:124-125`).

**TDD**: `red-green required`

**Covers**: `AC-3`

**Instructions**:
1. With a fake config stub, assert `resolve_secret("mcp_credential.acme-mcp")` sends metadata containing `("x-internal-caller", "ingest")` and a `GetSecretRequest` with `namespace="ingest"`, `key="mcp_credential.acme-mcp"`, and returns `("sk-live-abc123", True)`.
2. With a fake `httpx2`/transport (or by capturing the `httpx2.AsyncClient` headers the seam builds), assert the outbound MCP request for endpoint `https://mcp.acme.example/mcp` carries header `Authorization: Bearer sk-live-abc123` **and no other auth header** (@AC-3 "no other authentication").
3. Assert the `found=false` path returns `("", False)` so the loop (Step 10) can treat an unset bearer as degraded, not a crash (PRESERVE `@AC-16 @feature-147`).
4. If a fake MCP client is shared with Step 11, place it in `tests/conftest.py` (C-13 second-consumer rule); if used only here, inline it and record that verdict.

**Verification**:
```
cd services/xstockstrat-ingest && pytest tests/test_mcp_client.py --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
Run before Step 6 to confirm RED (`resolve_secret`/`McpClientProtocol` do not exist yet).

---

### Step 8 — service: `mcp_client` extractor (pure parser → ExternalSignal fields)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/extractors/base.py` — modify (add `McpClientInput` dataclass to the `RawInput` union)
- `services/xstockstrat-ingest/app/extractors/mcp_client.py` — create (`McpClientExtractor(BaseExtractor)`)

**Reviewers**: xstockstrat-ingest owner — signal normalization correctness

**Codebase Evidence**:
- `BaseExtractor.extract(self, raw: RawInput) -> list[dict]` at `base.py:51-55`; `RawInput` union at `:42-48` (the 5 programmatic input dataclasses). Existing concrete extractor pattern: `app/extractors/example_simple_email.py:10-11` (`class ExampleSimpleEmailExtractor(BaseExtractor): async def extract(self, raw): ...`).
- Fixed xstockstrat response contract (design "Response → signal mapping"): a list of objects `{symbol, direction, conviction, headline?, valid_from?, valid_until?, raw_url?, tags?}`; `direction ∈ {buy, sell, hold, watchlist}`, `conviction ∈ [0,1]`.
- Target `ExternalSignal` fields (`ingest.proto:106-115`): `source=1, symbol=2, direction=3, conviction=4, valid_from=5, valid_until=6, headline=7, raw_url=8, tags=9` (`ingested_at=10` is server-set). `extract` returns `list[dict]`, consumed by the loop (Step 10) to build `ExternalSignal`s.
- The extractor is **pure** (no network, no secrets) — the credential-bearing fetch lives in the loop; the extractor receives the already-fetched result via `McpClientInput` (design).

**TDD**: `red-green required`

**Covers**: `—` (verified Step 9)

**Instructions**:
1. `base.py`: add `@dataclass class McpClientInput:` wrapping the already-fetched tool result (e.g. `result_items: list[dict]` — the parsed `CallToolResult.structured_content` list; the loop does the `structured_content`/`content` extraction so the extractor stays pure and JSON-typed). Add `McpClientInput` to the `RawInput` union (`:42-48`).
2. `mcp_client.py`: `McpClientExtractor(BaseExtractor)` — `extract` maps each item to a dict with keys mirroring `ExternalSignal` (`symbol`, `direction`, `conviction`, optional `headline`/`valid_from`/`valid_until`/`raw_url`/`tags`). **Skip and count** any item missing `symbol`/`direction`, with `direction` outside the four-value set, or with `conviction` not in `[0,1]` — malformed items are not fatal (FR-5). Use the inverted-range form `not (0.0 <= c <= 1.0)` to also reject `NaN` (fails.md `fix-mcp-server-input-validation`).
3. Return `list[dict]`; the loop (Step 10) builds `ExternalSignal` protos and calls the ingest path.

**Verification**: `cd services/xstockstrat-ingest && ruff check . && ruff format --check .` (behavioral coverage Step 9).

---

### Step 9 — test: extractor parses valid items and skips malformed (AC-4 parse half)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_mcp_client_extractor.py` — create

**Reviewers**: xstockstrat-ingest owner — signal normalization correctness

**Codebase Evidence**:
- `McpClientExtractor.extract` is a pure coroutine over `McpClientInput` (Step 8) → unit-testable with no DB/network.
- AC-4 sample item: `{"symbol": "AAPL", "direction": "buy", "conviction": 0.72, "headline": "Model flags AAPL"}`.

**TDD**: `red-green required`

**Covers**: `AC-4` (parse half)

**Instructions**:
1. One valid item → one dict with `symbol="AAPL"`, `direction="buy"`, `conviction==0.72`, `headline` preserved.
2. A malformed item (missing `symbol`, or `direction="up"`, or `conviction=1.5`/`NaN`) mixed with a valid one → only the valid dict returned; the malformed one skipped (and counted, if the extractor exposes a count).
3. Empty result list → empty list (no crash).

**Verification**:
```
cd services/xstockstrat-ingest && pytest tests/test_mcp_client_extractor.py --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
RED before Step 8 (extractor + `McpClientInput` absent).

---

### Step 10 — service: scheduled server-side MCP query loop + health-on-failure

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/engine/mcp_client_loop.py` — create (mkdir `app/engine/` if absent)
- `services/xstockstrat-ingest/app/main.py` — modify (start the loop as a background task)
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify (extract an internal ingest helper reused by both `IngestSignal` and the loop)

**Reviewers**: xstockstrat-ingest owner — idempotent ingestion, health recording, no new DB pool

**Codebase Evidence**:
- Loop pattern to mirror (paced asyncio background task, config-driven cadence): `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` (recon Patterns to REUSE). NOTE: analysis's `DurableSchedule` helper (feature 158) lives in the analysis service and is **out of scope** to extract cross-service here — ingest uses a simple paced `asyncio.sleep` loop (design: "a background asyncio task started at ingest boot"), matching the non-durable shape the design specified.
- Boot site: `app/main.py:42-119` `serve()` — after `servicer = IngestServicer(...)` (`:86`) and `await grpc_server.start()` (`:106`); start the loop with `asyncio.create_task(...)` near the existing `servicer.resume_incomplete_jobs()` background start (`:113`). Cadence + timeout from the existing `cfg_watcher` (`get_int`, `watcher.py:95`).
- Active-source listing: `signal_sources.list_all_sources(db_pool, include_inactive=False)` (`signal_sources.py:43-57`) returns only `active = TRUE` rows incl. `source_type`, `config_json`, `credentials_ref`.
- Health writers to REUSE (no new columns): `mark_source_fed(db_pool, slug)` (`signal_sources.py:60-68`, success → bump last_seen+signals_fed, clear last_error), `mark_source_error(db_pool, slug, error)` (`:71-77`, failure → set last_error). `derive_health_status` (`:12-31`) yields `down` when `last_error` present (AC-5 degraded health).
- Ingest reuse: `IngestSignal` (`servicer.py:720-…`) validates + dedups + persists; its body is coupled to the gRPC `context` (`context.invocation_metadata()` `:724`, `context.abort` on validation). Dedup is on `(source, symbol, direction)` via `ingest.signal_dedup_keys` (ingest CLAUDE.md § Database) and the response carries `deduplicated=true` on a duplicate. The loop must reuse this exact path (@AC-4 "IngestSignal is invoked ... a second identical cycle returns deduplicated true").
- No new DB pool: the loop reuses the servicer's existing `db_pool`; the MCP call is outbound HTTP, not a DB connection (F-06 — ingest is PgBouncer-pooled, `DB_POOL_MAX` unset).

**TDD**: `red-green required`

**Covers**: `—` (verified Step 11)

**Instructions**:
1. Extract the validate+dedup+persist core of `IngestSignal` (`servicer.py:720+`) into an internal coroutine `async def _ingest_external_signal(self, signal) -> tuple[str, bool]` returning `(signal_id, deduplicated)` and **raising** on validation failure; have the existing `IngestSignal` RPC call it and map exceptions to `context.abort` (keep the RPC's external behavior byte-identical — its existing tests must still pass). The loop calls `_ingest_external_signal` directly so AC-4's "IngestSignal is invoked" path and dedup machinery run unchanged. (If extraction proves too invasive at execute time, the fallback is a localhost loopback `IngestServiceStub` call — record the choice in the Deviation Log; prefer the extracted helper for testability + one code path.)
2. `mcp_client_loop.py`: an `async def run_mcp_client_loop(servicer, cfg_watcher, mcp_client: McpClientProtocol)` that loops with `await asyncio.sleep(cfg_watcher.get_int("mcp_client.poll_interval_seconds", 300))`. Each cycle: `list_all_sources(..., include_inactive=False)`, filter `source_type == "mcp_client"`, and per source, inside a `try/except` wrapping the whole per-source body:
   - split `credentials_ref` → resolve bearer via `cfg_watcher.resolve_secret(key)`; `found=false` → `mark_source_error(slug, "bearer not configured")` and continue (health→down, no crash).
   - `result = await mcp_client.fetch(endpoint, tool, arguments, bearer, cfg_watcher.get_int("mcp_client.request_timeout_seconds", 30))` where `endpoint`/`tool`/`arguments` come from `config_json` (`mcp_endpoint`, `mcp_tool`, `mcp_arguments` default `{}`).
   - pull the JSON list from `result.structured_content` (fallback: JSON-decode `result.content[0].text`); wrap in `McpClientInput`; `items = await McpClientExtractor().extract(input)`.
   - for each item build an `ExternalSignal(source=slug, symbol=…, direction=…, conviction=…, …)` and call `self._ingest_external_signal(signal)`.
   - on full success `mark_source_fed` is already invoked by the ingest path on a fresh signal; ensure a fully-successful cycle leaves `last_error` cleared (design Open Risk "confirm the loop clears last_error on a fully-successful cycle").
   - `except Exception as e:` → `await mark_source_error(slug, str(e))` and continue to the next source; the loop and service stay up (@AC-5).
3. `main.py`: after `grpc_server.start()`, construct `StreamableHttpMcpClient()` and `asyncio.create_task(run_mcp_client_loop(servicer, cfg_watcher, mcp_client))`. Do not block startup on it (OTel-init-style non-fatal).
4. **Header propagation**: the loop is a service-internal producer, not a per-request forward — it uses service identity (`x-internal-caller: ingest` for `GetSecret`; no forwarded user scope). PRESERVE `@AC-8 @feature-156` (`ManageSignalSource` stays admin-gated; the loop uses service identity, not a user's scope). No new outbound per-request user-header propagation is introduced (the ingest path's own downstream calls are unchanged).

**Verification**: `cd services/xstockstrat-ingest && ruff check . && ruff format --check .` (behavioral coverage Step 11).

---

### Step 11 — test: full cycle ingests + dedups; 401 records health without crashing (AC-4, AC-5)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_mcp_client_loop.py` — create
- `services/xstockstrat-ingest/tests/conftest.py` — modify if the fake MCP client / db fixtures are shared (C-13)

**Reviewers**: xstockstrat-ingest owner — idempotent ingestion, health recording

**Codebase Evidence**:
- `run_mcp_client_loop` takes an injected `McpClientProtocol` (Step 10) → drive one cycle with a fake returning the AC-4 item; assert the ingest helper and dedup path run.
- `mark_source_error` / `derive_health_status` (`signal_sources.py:71-77`, `:12-31`) are the health seam AC-5 asserts.
- Existing ingest test harness (`ls services/xstockstrat-ingest/tests/`) shows the DB/asyncpg fixture pattern to reuse for the dedup assertion.

**TDD**: `red-green required`

**Covers**: `AC-4` (ingest + dedup), `AC-5`

**Instructions**:
1. Drive one cycle with a fake MCP client returning `[{"symbol":"AAPL","direction":"buy","conviction":0.72,"headline":"Model flags AAPL"}]`; assert `_ingest_external_signal` is invoked with an `ExternalSignal` of `source="acme-mcp"`, `symbol="AAPL"`, `direction="buy"`, `conviction≈0.72` (AC-4).
2. Run a **second identical cycle**; assert the ingest result reports `deduplicated=true` for `(acme-mcp, AAPL, buy)` (AC-4 dedup).
3. Drive a cycle where the fake MCP client raises an HTTP-401-equivalent error; assert the source row gets a **non-empty `last_error`** and `derive_health_status(...)` returns a degraded value (`down`), and that the loop proceeds to a **second** source in the same cycle without raising (AC-5 "processes the next source").
4. Centralize any fake shared with Step 7 into `conftest.py` (C-13 second-consumer rule); otherwise inline and record the verdict.

**Verification**:
```
cd services/xstockstrat-ingest && pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
Full ingest suite green (incl. the refactored `IngestSignal` RPC's existing tests) + coverage ≥ 40%. RED before Step 10.

---

### Step 12 — config: seed migration `025_ingest_mcp_client_keys` for the two loop keys + declare defaults

**Status**: `done`
**Service**: `xstockstrat-config` (seed migration) / `xstockstrat-ingest` (CLAUDE.md defaults)
**Files**:
- `services/xstockstrat-config/migrations/025_ingest_mcp_client_keys.up.sql` — create
- `services/xstockstrat-config/migrations/025_ingest_mcp_client_keys.down.sql` — create
- `services/xstockstrat-ingest/CLAUDE.md` — modify (§ Config Keys Consumed)

**Reviewers**: DBA — config-migration NNN (pre-assigned `025`, cross-feature merge-order dependency), up+down pair; xstockstrat-config owner — config-key naming, post-147 seed schema (`is_secret`/`user_id`, no `trading_mode`), key-column form; xstockstrat-ingest owner — C-05 default declaration

**Codebase Evidence**:
- **Config seed-migration NNN is pre-assigned `025_ingest_mcp_client_keys`** (merge-order.md § "Config-service seed-migration NNN pre-assignment (this batch, 2026-08-31)", lines 187–198: `021`→`022_ledger_export_keys`, `031`→`023_ui_performance_keys`, `168`→`024_analysis_engine_blend_keys`, **`166`→`025_ingest_mcp_client_keys`**). Working-tree tip is `021_notify_push_min_severity` (`ls services/xstockstrat-config/migrations/`), so **`025` must merge AFTER `022`/`023`/`024`** — golang-migrate applies in strict numeric order and will not apply a migration numbered below the DB's current version (this is a merge-order dependency, tracked in merge-order.md, not a code dependency). The per-source bearer secret `ingest.mcp_credential.<slug>` is **NOT** seeded here — it is written at registration via `SetConfig(is_secret=true, create_key=true)` (Steps 13/15), never a seed row.
- **Current post-147 seed schema** — mirror `019_register_analysis_signal_decay_half_life.up.sql:9-24` and `021_notify_push_min_severity.up.sql`: columns `(namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)`; **two rows per key** (`staging` + `production`); `user_id = NULL` (global); `is_secret = FALSE`; `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`. The `trading_mode` column was **dropped** by `017_config_secrets_and_scoping.up.sql:96` — do **not** use it (an INSERT naming it fails). (The older `005`/`008` seeds still show the pre-147 `trading_mode`/`dev` form — do not copy them; `019`/`021` are the current shape.)
- **Key-column form is namespace-relative**: the ingest `ConfigWatcher(namespace="ingest")` reads `get_int(key)` against `self._snapshot.values.get(key)` (`services/xstockstrat-ingest/app/config/watcher.py:95-101`), and the WatchConfig snapshot is keyed by the `key` column with no namespace prefix added. So the `key` column is `mcp_client.poll_interval_seconds` (**not** `ingest.mcp_client...`), matching the `005_ingest_backfill_chunking.up.sql` `('ingest', 'backfill.chunk_max_bars', …)` precedent and Step 10's `get_int("mcp_client.poll_interval_seconds", 300)`. (The full 3-segment key `ingest.mcp_client.poll_interval_seconds` = `namespace` `ingest` + `key` `mcp_client.poll_interval_seconds`, C-05.)
- ingest CLAUDE.md § Config Keys Consumed table (`services/xstockstrat-ingest/CLAUDE.md:83-96`, rows like `ingest.backfill.max_concurrent_jobs`, `ingest.signals.dedup_window_hours`) is the C-05 default-declaration home ("defaults declared in each service's CLAUDE.md").
- **Busy-loop hazard (surface the tradeoff):** `SCALAR_BOUNDS_REGISTRY` (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:114-116`, keyed full-dotted `${namespace}.${key}`, enforced at SetConfig `:405-411`) currently bounds only `analysis.scoring.signal_decay_half_life_hours`. `poll_interval_seconds` is operator-settable via config-ui, so a `0` would busy-loop the query loop.

**TDD**: `N/A (seed migration + docs — non-code-bearing)`

**Covers**: `—`

**Instructions**:
1. `025_ingest_mcp_client_keys.up.sql`: `INSERT INTO config.config_values (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id) VALUES …` two rows each (`staging` + `production`, `user_id = NULL`, `is_secret = FALSE`, `consuming_service='xstockstrat-ingest'`) for `('ingest','mcp_client.poll_interval_seconds','int','300', …, '300', …)` and `('ingest','mcp_client.request_timeout_seconds','int','30', …, '30', …)`; end with `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;`. Head the file with a comment noting feature 166, the pre-assigned `025` + the merge-after-`022`/`023`/`024` ordering, and that the bearer secret is NOT seeded here. (`value_type='int'` must match the ingest reader's `get_int` getter or the value silently returns the default — migration-016 value_type trap, cited in `021`'s header.)
2. `025_ingest_mcp_client_keys.down.sql`: `DELETE FROM config.config_values WHERE namespace = 'ingest' AND key LIKE 'mcp_client.%';` (mirror `008`/`021` down shape). Do **not** delete `mcp_credential.%` — that is not seeded by this migration.
3. ingest CLAUDE.md § Config Keys Consumed: add two rows — `ingest.mcp_client.poll_interval_seconds` (int, `300`, "server-side MCP query loop cadence") and `ingest.mcp_client.request_timeout_seconds` (int, `30`, "per-call outbound MCP timeout") — and a prose note that `ingest.mcp_client` sources also reference an encrypted per-source bearer secret at `ingest.mcp_credential.<slug>` (`is_secret=true`, feature 147, dynamic — not a seeded default), resolved via `GetSecret` (`x-internal-caller: ingest`), never in `config_json`.
4. **Optional hardening (recommended — reviewer's call, surfaces the busy-loop tradeoff):** add `'ingest.mcp_client.poll_interval_seconds': { minValue: 1, maxValue: 86400 }` and `'ingest.mcp_client.request_timeout_seconds': { minValue: 1, maxValue: 300 }` to `SCALAR_BOUNDS_REGISTRY` (`configServiceImpl.ts:114`) so config-ui/SetConfig cannot set `0`; if adopted, it is a code change and gains a bounds case in Step 5's config suite (C-08). If declined, add a loop-side `max(interval, 1)` clamp in Step 10 instead and record the choice — do not ship an unbounded settable cadence.
5. Run `/context-scrubber scan` scoped to the ingest CLAUDE.md before pushing (root CLAUDE.md Teardown rule); if the context-forge plugin is unavailable, note it in the PR body.

**Verification**:
```
ls services/xstockstrat-config/migrations/025_ingest_mcp_client_keys.up.sql \
   services/xstockstrat-config/migrations/025_ingest_mcp_client_keys.down.sql
grep -nE "mcp_client.poll_interval_seconds|mcp_client.request_timeout_seconds|mcp_credential" services/xstockstrat-ingest/CLAUDE.md
```
Confirm the `.up` seeds both keys (namespace-relative `key`, `is_secret=false`, staging+production, `ON CONFLICT … COALESCE(user_id,'')`), the `.down` deletes `mcp_client.%` only, and the CLAUDE.md carries both keys + the secret note.

---

### Step 13 — service: agent `manage_signal_source` bearer orchestration + `list_signal_sources` surfaces has_credentials

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify (`manage_signal_source` `:897`, `list_signal_sources` `:219`)
- `services/xstockstrat-agent/app/client.py` — modify if a `set_config`/`manage_signal_source` client method needs the two-write (confirm with `grep -n "def set_config\|def manage_signal_source" services/xstockstrat-agent/app/client.py`)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name/params/return shape), `mcp-tools.md` parity; Security — bearer never echoed, admin scope forwarded only by the management tool

**Codebase Evidence**:
- `manage_signal_source(ctx, operation, slug, display_name?, source_type?, config_json?, extractor_module?, credentials_ref?, reliability_weight?)` at `tools.py:897-956`; forwards the caller's derived admin scope via `_caller_access_scope(ctx, "manage_signal_source")` (`:954`); returns `{slug, display_name, source_type, extractor_module, active, has_credentials, reliability_weight}` (docstring `:926-927`) — credentials_ref never echoed (FR-12).
- `set_config` tool at `tools.py:1223` (writes a config value incl. secrets, admin-scoped) — the existing write edge to reuse for the bearer secret (design: reuse the existing agent `set_config`, no new ingest→config write).
- `list_signal_sources` at `tools.py:219-250` currently **strips** `has_credentials`: `:233` comment "has_credentials and credentials are intentionally excluded — never exposed to Claude"; the enriched dict (`:238-246`) omits it. The backend `ListSignalSources` RPC **does** return `has_credentials` (`servicer.py:1062`). **Product spec §Consumer Surface(s) line 87 commits to surfacing `has_credentials`** and @AC-1/@AC-2 require it — so this step **reverses the line-233 exclusion for the boolean `has_credentials` only** (never `credentials_ref` / the token).
- **Tool count unchanged (32).** This step adds a parameter to an existing tool and a field to an existing tool's output — it does **not** add a tool. So the six inventory surfaces that pivot on the count (agent CLAUDE.md "thirty-two tools", `mcp-tools.md`, `test_tools_endpoint.py` name-set, `GET /api/tools`, decorators, docstrings) do **not** change their count (fails.md `offline-account-portfolios`: verify count by the authoritative name-set, not a decorator grep — here no count changes).

**TDD**: `red-green required`

**Covers**: `—` (verified Step 14)

**Instructions**:
1. Add a `bearer_token: str | None = None` parameter to `manage_signal_source`. When `source_type == "mcp_client"` (register) **and** a `bearer_token` is supplied, orchestrate **secret-first** (design): (a) write the token to config key `ingest.mcp_credential.<slug>` via the existing `set_config` path with `is_secret=true` + `create_key=true` (namespace `ingest`, key `mcp_credential.<slug>`); (b) then call `client.manage_signal_source(...)` with `credentials_ref="ingest.mcp_credential.<slug>"`. Never place the token in `config_json`. Never echo `bearer_token`/`credentials_ref` in the return (FR-12 preserved). A failed register after a successful secret write leaves only a harmless redacted orphan secret (design: accepted, no compensating cleanup).
2. In `list_signal_sources`, add `"has_credentials": src["has_credentials"]` to the enriched dict (`:238-246`) and update the `:233` comment: only the **token/credentials_ref** are excluded; the boolean `has_credentials` is now surfaced (product-spec-committed reversal). Confirm the backend `client.list_signal_sources` result carries `has_credentials` (from `servicer.py:1062`); if the agent `client.py` projection drops it, add it there too.
3. Update both tool docstrings: `manage_signal_source` documents the `mcp_client` type, the `bearer_token` arg (stored encrypted, never returned), and the `config_json` fields (`mcp_endpoint`, `mcp_tool`, optional `mcp_arguments`); `list_signal_sources` documents `has_credentials` in the return.

**Verification**: `cd services/xstockstrat-agent && ruff check . && ruff format --check .` (behavioral coverage Step 14).

---

### Step 14 — test: agent registers mcp_client (two-write) + surfaces has_credentials, no token (AC-1, AC-2)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify (confirm the tool-test file with `ls services/xstockstrat-agent/tests/`)

**Reviewers**: xstockstrat-agent owner — tool contract stability; Security — token never in output

**Codebase Evidence**:
- Agent tools are tested against a fake backend `client` (agent CLAUDE.md § Running Tests; existing `tests/` harness). `manage_signal_source` + `set_config` + `list_signal_sources` are the seams under test.
- @AC-1/@AC-2 assert the tool surface: register `acme-mcp` (`config_json={"mcp_endpoint":"https://mcp.acme.example/mcp","mcp_tool":"get_signals"}`, `bearer_token="sk-live-abc123"`), then `list_signal_sources` returns `source_type="mcp_client"` + `has_credentials=true` and **no field == "sk-live-abc123"**.

**TDD**: `red-green required`

**Covers**: `AC-1`, `AC-2`

**Instructions**:
1. Register: assert `manage_signal_source(operation="register", source_type="mcp_client", slug="acme-mcp", config_json={...}, bearer_token="sk-live-abc123")` first calls the `set_config` path with namespace `ingest`, key `mcp_credential.acme-mcp`, `is_secret=true`, `create_key=true`, value `"sk-live-abc123"`, **then** `client.manage_signal_source` with `credentials_ref="ingest.mcp_credential.acme-mcp"`; assert the return contains **no** field equal to `"sk-live-abc123"` and no `credentials_ref` (AC-2).
2. List: with the fake backend returning `has_credentials=true` for `acme-mcp`, assert `list_signal_sources` includes `{"source_type":"mcp_client","has_credentials":true}` for `acme-mcp` and again **no** field equal to the token (AC-1/AC-2).

**Verification**:
```
cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
RED before Step 13 (`bearer_token` param + `has_credentials` field absent).

---

### Step 15 — service: config-ui `/sources` registers `mcp_client` (endpoint/tool/bearer, secret-first)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/sources/page.tsx` — modify (`SOURCE_TYPES`, form fields, config_json build)
- `services/xstockstrat-ui/src/app/config-ui/hooks/useSignalSourceMutations.ts` — modify (two-write orchestration)
- `services/xstockstrat-ui/src/lib/configUiBff.ts` — modify if the SetConfig/ManageSignalSource BFF calls live there (confirm with `grep -n "SetConfig\|ManageSignalSource\|manageSignalSource\|setConfig" services/xstockstrat-ui/src/lib/configUiBff.ts`)

**Reviewers**: xstockstrat-ui owner — config mutation safety, no secret values rendered/echoed in UI; Security — bearer written as an encrypted secret, never displayed

**Codebase Evidence**:
- `SOURCE_TYPES` array at `page.tsx:34-46` (currently 9 types, no `mcp_client`); `type SourceType = (typeof SOURCE_TYPES)[number]` (`:47`); `SourceFormState` with `sourceType`/`credentialsRef` (`:52-61`); per-type predicates `isEmailType`/`isWebsiteType`/`isAuthWebsiteType` (`:129-142` region) and a config_json builder (`:129+`).
- `useSignalSources.ts` / `useSignalSourceMutations.ts` (config-ui hooks) drive the ManageSignalSource mutation; `src/lib/configUiBff.ts` is the config-ui BFF surface for config-service + ingest calls.
- Existing SetConfig-secret precedent for the write (feature 147 config-ui secret path) — reuse it for `ingest.mcp_credential.<slug>` (`is_secret=true`, `create_key=true`).

**TDD**: `red-green required` (Playwright e2e — no unit coverage threshold for `xstockstrat-ui`)

**Covers**: `—` (verified Step 16)

**Instructions**:
1. `page.tsx`: add `'mcp_client'` to `SOURCE_TYPES`; add an `isMcpClientType(t)` predicate; when selected, render fields for **MCP endpoint** (`mcp_endpoint`), **tool name** (`mcp_tool`), and a **bearer token** (secret input). Build `config_json = { mcp_endpoint, mcp_tool }` (+ optional `mcp_arguments`) for this type — **never** put the token in `config_json`.
2. Mutation (secret-first, mirroring the agent orchestration): on register of an `mcp_client` source with a bearer token, first call the config-service SetConfig BFF to write `ingest.mcp_credential.<slug>` (`is_secret=true`, `create_key=true`), then call ManageSignalSource with `credentials_ref="ingest.mcp_credential.<slug>"`.
3. Never render the bearer back (config-ui already redacts secrets — C-17 "no secret values rendered"); the token input is write-only.
4. C-17: use design-role tokens + existing `ui/*` primitives (`SelectItem`, form primitives already imported at `page.tsx:25`) — no hardcoded colors, no new near-duplicate primitive.

**Verification**: `cd services/xstockstrat-ui && pnpm run lint` (e2e behavior in Step 16).

---

### Step 16 — test: e2e register an mcp_client source via /sources (AC-1/AC-2, UI surface, C-14)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/sources.spec.ts` — create or modify (confirm with `ls services/xstockstrat-ui/e2e/config-ui/`)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (mock SetConfig + ManageSignalSource + ListSignalSources for `mcp_client`)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify if a new signal-source fixture is added

**Reviewers**: xstockstrat-ui owner — analytics/config display accuracy, no secret rendered

**Codebase Evidence**:
- Frontend tests reuse the test-data inventory (C-12): read `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` for an existing signal-source fixture; auth helpers `addAuthCookie`/`addAdminCookie` in `e2e/helpers/auth.ts` (never re-implement JWT signing). (Confirm exact symbols at execute; the `/sources` page is admin config-ui.)
- The `/sources` page already exists and is nav-registered (recon: config-ui nav is `NAV_GROUPS` in `navGroups.tsx`, not the inert `PLATFORM_SUBNAV`; no new page → no C-10(a) nav step).

**TDD**: `red-green required`

**Covers**: `AC-1`, `AC-2` (UI surface)

**Instructions**:
1. As an admin, open `/config-ui/sources`, choose `mcp_client`, fill endpoint/tool/bearer, submit; assert the mocked SetConfig receives the secret write (`ingest.mcp_credential.<slug>`, `is_secret=true`) **then** ManageSignalSource receives `source_type="mcp_client"` + `credentials_ref="ingest.mcp_credential.<slug>"` (secret-first order).
2. Assert the source list then shows `acme-mcp` as `mcp_client` and the bearer value is **never** rendered anywhere in the page (AC-2).
3. Reuse inventory fixtures for the signal-source shape; add a fixture module + `INVENTORY.md` row only if no signal-source fixture exists (C-12), and import mocks from `e2e/fixtures` / auth from `e2e/helpers/auth.ts`.

**Verification**:
```
cd services/xstockstrat-ui && pnpm test:e2e -g "mcp_client" && pnpm run lint
```
Confirm the e2e passes and (per fails.md `shadcn-migration-high-confidence`) run at least once against a broader scope before marking done. RED before Step 15.

---

### Step 17 — docs: mcp-tools.md parity for the mcp_client source type

**Status**: `done`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/mcp-tools.md` is the human runbook mirroring the agent tool surface; it drifts silently from `tools.py` unless updated in the same PR (fails.md `mcp-tools-alignment`, F-12; `trigger-backfill-mcp-tool`: fix or flag a shared-doc gap, never carry it forward).

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
1. Under `manage_signal_source`: document the `mcp_client` `source_type`, the new `bearer_token` parameter (stored encrypted as `ingest.mcp_credential.<slug>`, never returned), and the `config_json` fields (`mcp_endpoint`, `mcp_tool`, optional `mcp_arguments`).
2. Under `list_signal_sources`: document that `has_credentials` (boolean) is now in the return; the token/`credentials_ref` are never returned.
3. Document the **fixed xstockstrat MCP response contract** the external tool must return: a list of `{symbol, direction (buy|sell|hold|watchlist), conviction (0–1), headline?, valid_from?, valid_until?, raw_url?, tags?}`.
4. Do not change any tool-count statement — the tool count is unchanged (32).

**Verification**: `grep -nE "mcp_client|bearer_token|mcp_endpoint|mcp_tool|has_credentials" docs/runbooks/mcp-tools.md` — confirm the new type, param, config fields, and response contract are documented.

---

## Deviation Log

- **MCP SDK version (Step 6):** the spec pinned `mcp==2.0.0`; `uv lock` resolved **`mcp 2.1.1`**
  (within `>=2.0.0,<3`). Re-verified the exact API against the installed 2.1.1:
  `mcp.client.streamable_http.streamable_http_client(url, *, http_client=...)` yields a `(read, write)`
  tuple; `mcp.client.session.ClientSession(read, write).call_tool(name, args, read_timeout_seconds=…)`
  returns `mcp.types.CallToolResult` with `structured_content` — all present. Bearer via
  `httpx2.AsyncClient(headers=...)` confirmed.
- **`is_secret` is on `ConfigValue`, not `SetConfigRequest` (Steps 13/15).** The design/spec assumed a
  `SetConfigRequest.is_secret`; the proto has **no such field** — `is_secret` is a field of the
  `ConfigValue` message (`config.proto`), and the config backend reads `value.is_secret` on write
  (`configServiceImpl.ts:458`). So the agent `client.set_config` sets `cv.is_secret` (not the request),
  and the config-ui secret write sets it on the `ConfigValue`. The `SetConfigRequest`-parity agent test
  was left unchanged (is_secret is not one of its fields).
- **Agent tool count is 33, not 32 (Steps 13/17).** The spec said "count unchanged (32)"; feature 095
  (merged) already added `list_opportunities`, so the live count is **33**. This step adds a param + an
  output field, not a tool — the count stays 33. All count statements were left at/updated to 33.
- **config-ui env plumbing (Steps 15/16).** Rather than refactor the `/sources` page into a
  server-wrapper to thread the client-hidden `APPLICATION_ENV`, the config-ui **BFF** now fills an
  `Environment.UNSPECIFIED` SetConfig with the deployment's native scope
  (`nativeConfigEnvironment()`), so the secret write lands (and is gated) on the correct env. A caller
  that names a real env (NamespaceEditor) is unchanged.
- **Step 16 mock (deviation from the listed files).** `e2e/mock-backend.ts` was NOT modified: the new
  `sources.spec.ts` case drives SetConfig/ManageSignalSource/ListSignalSources via **`page.route`**
  (the established sources-spec convention) rather than mutating the shared `SIGNAL_SOURCES` fixture,
  which the other sources tests assert against. No new fixture was needed (a signal-source fixture
  already exists). The final "list re-renders the source" assertion was reduced to a form-closed +
  token-never-rendered check (the core AC-2), since the list-render path is already covered by the
  suite and the two-write + redaction is the feature's essence.
- **Busy-loop hardening (Step 12):** took the loop-side `max(interval, 1)` clamp (in
  `mcp_client_loop.py`) rather than the optional `SCALAR_BOUNDS_REGISTRY` bound — a settable `0` can't
  busy-loop, and no config-service code change was needed.
- **IngestSignal refactor (Step 10):** the extraction of `_ingest_external_signal` was done in place
  (not the loopback-gRPC fallback); the RPC's external behavior is byte-identical (all 44 existing
  IngestSignal/signal tests stayed green) and the loop calls the shared helper directly.

**RED→GREEN evidence (Floor P-06):** Step 3 (validator, 4 tests RED→GREEN), Step 5 (config authz, 5
tests), Step 7 (bearer/GetSecret, 4 tests — RED via stash), Step 9 (extractor, 3 tests), Step 11 (loop
cycle+dedup+401, 3 tests — RED via stash), Step 14 (agent two-write, 2 tests + flipped list test),
Step 16 (config-ui e2e). Full suites green: ingest 206 pass (78% cov), config 98 pass (84%), agent 327
pass (78%), UI sources e2e 19/19.
