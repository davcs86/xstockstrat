# Recon: extract-tool-ssrf-hardening

**Created**: 2026-09-28
**From**: product-spec.md
**Affected services**: xstockstrat-agent

---

## Objective

Add fail-closed SSRF egress controls to the agent's shared HTTP fetch helper `_fetch_url`, through
which both `extract_website_content` and `extract_email_content` fetch caller-influenced URLs. Today
`_fetch_url` does no scheme/address/size validation and follows redirects blindly, so a prompt-injected
agent can reach cloud metadata, loopback, and private-network gRPC services (audit M-list / DT-2).

## Codebase Map

- **`xstockstrat-agent`** (Python 3.12 runtime; MCP server, port 9000)
  - Shared fetch helper: `app/tools.py:2226-2241` — `_fetch_url(url, password=None, headers=None)`:
    lazy `import httpx` (`:2232`); `httpx.AsyncClient(timeout=30.0, follow_redirects=True)`; `c.get(url,
    headers=...)`; `r.raise_for_status(); return r.text` — **no scheme check, no IP validation, no size
    cap**; optional Bearer from `password` (`:2235-2236`).
  - Callers: `extract_email_content` `app/tools.py:508-510` (loops caller-supplied `urls` → `_fetch_url`
    directly); `extract_website_content` `:531,540-544` (URL from source-registry `config_json.url`, not
    caller-constructed, + optional `request_headers`). Tool defs at `:474` / `:515`.
  - Config reader: `app/client.py:1610-1612` `get_config_value(key, *, namespace, environment,
    user_id="")` (one-shot `GetConfig` gRPC, env-scoped). Call-site pattern to mirror:
    `app/oauth_server.py:82-85` (`namespace="agent"`, env via `resolve_scope("")` from `app/scopes.py`).
  - Registered agent keys + defaults convention: `services/xstockstrat-agent/CLAUDE.md:185-194`
    (§ "Config Keys Consumed": `agent.oauth.*`, `agent.signal.*`). New `agent.extract.*` keys go here.
  - Telemetry: `app/telemetry.py` is init-only (`init_telemetry:31`, global `TracerProvider:48-50`) — no
    per-span helper importable by tools.py. Module logger `log` is used throughout tools.py (`:2219`).
  - Tests: `tests/test_tools.py` — extract tools mocked with **respx** (`test_extract_website_content_fetches_url:240-246`,
    `_sends_request_headers:252-277`; email at `:199-236`). respx dev-dep `pyproject.toml:21` (resolved 0.23.1).

- **Installed HTTP stack (the crux — grounded against the venv, per ledger fails.md:637/:1021):**
  - httpx **0.28.1** (`uv.lock:380-382`), on httpcore **1.0.9** (`uv.lock:325-327`).
  - httpx public `AsyncHTTPTransport` exposes `local_address` + `socket_options` but **NOT
    `network_backend`** (`httpx/_transports/default.py:280-311`) — confirmed absence.
  - `httpcore.AsyncConnectionPool.__init__` **does** accept `network_backend` (`httpcore/_async/connection_pool.py:60`,
    default `AutoBackend`).
  - The pin hook: `AsyncNetworkBackend.connect_tcp(host, port, timeout, local_address, socket_options)`
    (`httpcore/_backends/base.py:82-89`) — a subclass resolves `host`, validates each resolved IP, and
    connects to the **pinned** validated IP here. This hook fires on **every** connection, including
    each redirect hop, so per-hop address validation is automatic at the connect layer.
  - SNI/Host preserved: TLS is a **separate** `start_tls(server_hostname=...)` step
    (`httpcore/_backends/anyio.py:55-73`), distinct from `connect_tcp` — pinning the TCP IP does not
    change SNI.

## Patterns to REUSE

- **Config reads** → reuse `client.get_config_value("extract.<key>", namespace="agent",
  environment=resolve_scope(""))` (`app/client.py:1610`, pattern at `oauth_server.py:82-85`). Do NOT add
  a new config mechanism.
- **Config key registration** → add `agent.extract.*` rows to `services/xstockstrat-agent/CLAUDE.md`
  § Config Keys Consumed (`:185`), same as `agent.oauth.*`.
- **Blocked-fetch record (FR-6)** → reuse the module `log` (`log.warning`, cf. `oauth_server.py:108`
  best-effort warnings). An OTel span is possible via the global provider but there is no wrapper today.
- **Happy-path test** → reuse the respx pattern (`test_tools.py:240-246`). The IP-validation function
  is unit-tested directly (respx patches at the transport layer and would bypass a custom backend).

## Existing Business Rules (preserve / extend)

Constitution **C-16** (from scenario-recon):
- **PRESERVE** `@AC-1 @FR-1 @feature-214` "agent advertises no db_ tool / tool count = 43"
  (`services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature`) — 207 is behavioral-only;
  both extract_* tools must stay advertised and the count must remain **43** (no tool add/remove/rename).
- No existing durable scenario asserts extract_* fetch-and-return behavior — 207 adds the **first**
  durable coverage (public URL succeeds; private/internal blocked). New acceptance, not a CHANGE.

## Dependencies

- Proto/RPC: none (reuses existing `GetConfig`).
- Migration: none.
- Config keys: new `agent.extract.*` (exact set = design fork). Registered via config service; declared
  in agent CLAUDE.md. **Must be config/env-sourced, never hardcoded (C-05 / F-07)** — @AC-8.
- Inter-service edges: none new.
- New deps: none required — pinning uses the already-installed httpcore 1.0.9 + stdlib `ipaddress`/`socket`.

## Risks / Not-found

- **Pinning couples to httpcore internals** (`network_backend` / `connect_tcp`): httpx's public API has no
  pin hook, so the custom `AsyncNetworkBackend` sits one layer below httpx and is version-coupled to
  httpcore 1.x. Design must weigh this vs a simpler-but-weaker approach (a pre-resolve+validate that
  re-resolves at connect is **not** DNS-rebind-safe and fails FR-2). This is the central design fork.
- **Redirect handling**: `follow_redirects=True` bypasses app-layer per-hop checks, BUT the custom
  connect_tcp validates every hop's IP automatically; scheme (FR-3) and max-hop bound (FR-4) still need
  the client layer (`max_redirects=`, scheme check pre-request).
- **Response size cap (FR-4)**: `_fetch_url` returns full `r.text`; needs streamed read with a byte cap
  (`iter_bytes`/`aiter_bytes` + limit) instead of `r.text`.
- **respx bypasses a custom transport** — validation/pinning logic must be unit-tested directly (pure IP
  function + resolver monkeypatch); respx stays for the allowed happy path (recon fails.md:637 discipline).
- **FR-6 audit mechanism** = design decision: structured `log.warning` (light, exists) vs OTel span
  (needs a new tracer wrapper). Not-found: no per-span helper in telemetry.py.
- **Config fork**: exact `agent.extract.*` key set + whether an operator **domain allowlist** ships in v1
  (deny-by-range is the fail-closed core; allowlist is additive) — operator decision at the design gate.

## Recommended Scope

Advisory step boundaries for `/sdd-spec`:
1. **Pure IP/scheme-validation module** (`app/egress.py` or similar): `ipaddress`-based deny check for
   RFC1918/loopback/link-local (incl. 169.254.169.254)/ULA/unspecified (FR-1), scheme allowlist (FR-3).
   Unit-tested directly.
2. **Custom httpcore `AsyncNetworkBackend`** wrapping the validator in `connect_tcp` (resolve → validate
   every A/AAAA → connect pinned IP), wired into an `httpx.AsyncClient` via `httpcore.AsyncConnectionPool`
   (FR-1/FR-2/FR-4-per-hop).
3. **`_fetch_url` hardening**: use the pinned client, `max_redirects` bound, streamed size cap, non-
   enumerating error, FR-6 record. Both extract tools inherit it.
4. **Config wiring**: `agent.extract.*` reads via `get_config_value` + CLAUDE.md registration (FR-5).
5. **Tests** (paired): unit tests for the validator (deny ranges, scheme, rebind case) + respx happy path
   + a blocked-fetch error/telemetry assertion; agent suite green, tool count still 43.
