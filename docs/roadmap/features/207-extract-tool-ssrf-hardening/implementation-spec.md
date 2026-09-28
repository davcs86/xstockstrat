# Implementation Spec: extract-tool-ssrf-hardening

**Status**: `pending`
**Created**: 2026-09-28
**Feature**: `docs/roadmap/features/207-extract-tool-ssrf-hardening/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/extract-tool-ssrf-hardening`

---

## Execution Summary

Implements the design's three-layer hardening of the single shared fetch chokepoint `_fetch_url`
(`services/xstockstrat-agent/app/tools.py:2226`), through which both `extract_website_content`
(`:544`) and `extract_email_content` (`:510`) fetch — one hardening covers both tools (C-10). Build
bottom-up so each layer is red-green testable in isolation: (1) a pure `app/egress.py` validator
(`not is_global` primary gate + defense-in-depth explicit deny list + scheme allowlist), unit-tested
directly; (2) a DNS-rebind-safe pinning transport in the same module (subclassed
`httpx.AsyncHTTPTransport` owning an `httpcore.AsyncConnectionPool` whose `network_backend` resolves →
validates every A/AAAA → connects the pinned validated IP), unit-tested with a monkeypatched resolver
because respx patches above this layer; (3) the hardened `_fetch_url` (manual bounded redirect loop
with per-hop scheme + cross-origin credential strip, streamed byte-cap, non-enumerating error + FR-6
`log.warning` record), verified with respx for the happy path and monkeypatched resolver for blocks.
Config (FR-5) is four scalar `agent.extract.*` keys read via the existing `get_config_value` pattern
with safe fallbacks, declared in the service CLAUDE.md.

Deny-ranges are **stdlib-derived** by the `not is_global` rule, not a configured CIDR literal — a
security invariant, not a tunable (satisfies F-07/C-05, which govern config *values*, not RFC
semantics). No proto, no migration, no new dependency (uses installed httpx 0.28.1 / httpcore 1.0.9 /
anyio 4.13.0 + stdlib `ipaddress`/`socket`). Tool count is unchanged (C-16); the existing exact-name-set
guard `tests/test_tools_endpoint.py::test_list_tools_returns_all_registered_tools` is the C-16
regression guard and must stay green — no numeric duplicate is added (C-18/DRY).

**Python-version reconcile (design Open Risk #3):** the deployed image is `python:3.13-slim`
(`services/xstockstrat-agent/Dockerfile:1`); `pyproject.toml:4` requires `>=3.12`; the local venv is
3.12. 3.13 has the modern `is_global` IPv4-mapped semantics; the explicit deny-list defense-in-depth in
Step 1 covers any pre-3.12.4 interpreter, and Step 2's unit tests assert the mapped/NAT64/CGNAT cases
**regardless of interpreter version**.

**Consumer surface (C-14):** the two named Agent tools `extract_website_content` /
`extract_email_content` are reached in Step 5 (hardened `_fetch_url` that both call). No UI surface.
Behavioral-only change — denied targets now return a generic error; legitimate public-URL extraction is
unchanged. Their MCP contract (name / params / return shape) does not change, so no
`docs/runbooks/mcp-tools.md` contract edit is required (a decision, not an omission).

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` cloud-metadata blocked | Step 2 (validator unit) + Step 6 (end-to-end via `_fetch_url`) |
| `@AC-2` RFC1918 / loopback blocked before socket | Step 2 (validator unit) + Step 6 |
| `@AC-3` DNS-rebind-safe (resolve → validate → pin) | Step 4 (transport unit) |
| `@AC-4` non-http(s) scheme rejected | Step 2 (validator unit) |
| `@AC-5` redirect to internal blocked mid-chain | Step 6 |
| `@AC-6` legitimate public URL still fetched | Step 6 (respx happy path) |
| `@AC-7` blocked fetch leaks nothing + is recorded | Step 6 |
| `@AC-8` egress policy config-sourced, no hardcoded literals | Step 6 |

## Step Dependencies

- Step 2 [test] covers Step 1 [service] (validator unit tests).
- Step 3 requires Step 1: the pinning backend calls `assert_public_ip` from `app/egress.py`.
- Step 4 [test] covers Step 3 [service] (transport unit tests). This is where the design's
  httpx/httpcore internal-coupling risk is pinned down: Step 4 asserts on the **held backend instance
  identity** (not a re-read attr name) and includes the rebind fail-closed case that CI must run.
- Step 5 requires Steps 1 + 3: the hardened `_fetch_url` uses `assert_allowed_scheme` (Step 1) and the
  pinning transport (Step 3), and reads config for its limits (Step 7 keys; safe fallbacks make Step 5
  runnable before Step 7 lands).
- Step 6 [test] covers Step 5 [service] (`_fetch_url` + extract-tool tests).
- Step 7 [config] declares the `agent.extract.*` keys in the service CLAUDE.md; the code fallbacks in
  Step 5 mean Step 7 has no code dependency, but both must ship in the same PR (FR-5 / C-05).

---

### Step 1 — service: Pure egress validator module (`app/egress.py`)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/egress.py` — create

**Reviewers**: Security — SSRF egress-policy correctness: deny-by-default of RFC1918/loopback/link-local/metadata/ULA/unspecified, no address echoed in the error (FR-6); `xstockstrat-agent` — change confined to the extract_* fetch path, no tool-count/contract change

**Codebase Evidence**:
- No existing SSRF/egress helper in the agent — greenfield (product-spec OQ2, grep-confirmed at review). `find services/xstockstrat-agent/app -name egress.py` → **Not found**; this file is created from scratch.
- Module logger convention to reuse for FR-6 records in later steps: `services/xstockstrat-agent/app/tools.py:90` → `log = logging.getLogger(__name__)`.
- Installed stdlib: `ipaddress` (stdlib) provides `ip_address(...).is_global` / `.is_loopback` / `.is_link_local` / `.is_unspecified` / `.is_reserved` / `.is_private` / `.ipv4_mapped`.

**TDD**: `red-green required` (paired with Step 2)

**Covers**: `—`

**Instructions**:
1. Create `services/xstockstrat-agent/app/egress.py`.
2. Define an internal exception `class EgressBlocked(Exception)` — opaque, carries **no** address/host/port
   in its message (FR-6). Its `str()` is a fixed generic string (e.g. `"egress blocked"`); callers map it
   to the caller-facing tool error (Step 5). Design note: it must never be constructed with the offending
   IP/host interpolated.
3. `def assert_public_ip(ip_str: str) -> None`: parse via `ipaddress.ip_address(ip_str)`. **Primary gate:**
   if the parsed address has an `ipv4_mapped` (IPv4-mapped IPv6, e.g. `::ffff:169.254.169.254`), evaluate
   the checks against the unwrapped IPv4; then **reject if `not ip.is_global`** (denies anything not
   globally routable — closes the CGNAT `100.64.0.0/10` and future-special-range holes that `is_private`
   leaves). **Defense-in-depth** (guards pre-3.12.4 interpreter drift — see Execution Summary): also
   explicitly `raise EgressBlocked` when any of `is_loopback`, `is_link_local`, `is_unspecified`,
   `is_reserved`, `is_private` is true, or when the address equals the literal `169.254.169.254` /
   `::ffff:a9fe:a9fe`. Any parse failure → `raise EgressBlocked` (fail-closed). Never include `ip_str` in
   the raised message.
4. `def assert_allowed_scheme(scheme: str) -> None`: allow only `{"http", "https"}` (case-insensitive);
   anything else → `raise EgressBlocked` with no scheme echoed.
5. Do **not** hardcode any CIDR list or numeric limit here — deny-ranges are derived from `ipaddress`
   semantics (design: stdlib invariant, not a config value); numeric limits live in Step 5's config reads.
6. Keep the module import-light (stdlib `ipaddress` only at module top; `EgressBlocked` + the two
   validators are the only public surface used by Steps 3 and 5).

**Verification**:
`python -c "import ast,sys; ast.parse(open('services/xstockstrat-agent/app/egress.py').read())"` — parses;
then confirm the public surface exists: `grep -n "class EgressBlocked\|def assert_public_ip\|def assert_allowed_scheme" services/xstockstrat-agent/app/egress.py` — all three present. Full behavioral proof is Step 2.

---

### Step 2 — test: Validator unit tests (deny ranges, scheme, mapped/CGNAT)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_egress.py` — create

**Reviewers**: `xstockstrat-agent` — service owner of the tested service; Security — deny-range / scheme / mapped-address coverage completeness

**Codebase Evidence**:
- Test conventions: `services/xstockstrat-agent/tests/test_tools.py:1-14` (module docstring, `import pytest`, direct symbol import from `app.*`). Async not needed here (pure sync functions).
- Coverage threshold + invocation: `services/xstockstrat-agent/CLAUDE.md` § Running Tests → `uv run pytest --cov=app --cov-fail-under=40`; lint per `.github/workflows/ci.yml` python-lint (ruff).
- C-13: `app/egress.py` deny-range literals are test inputs (IP strings), one consumer (this file) → inline is compliant; no fixture home needed (agent has `tests/conftest.py` but these are scenario one-offs).

**TDD**: `red-green required` — written to fail against the pre-Step-1 tree (module absent → import error), pass after.

**Covers**: `AC-1, AC-2, AC-4`

**Instructions**:
1. Create `tests/test_egress.py` importing `from app.egress import assert_public_ip, assert_allowed_scheme, EgressBlocked`.
2. `assert_public_ip` **deny** cases (each `with pytest.raises(EgressBlocked)`): `169.254.169.254`
   (cloud metadata — AC-1); `10.0.0.5`, `172.16.0.1`, `192.168.1.1` (RFC1918 — AC-2); `127.0.0.1`, `::1`
   (loopback — AC-2); `169.254.10.10`, `fe80::1` (link-local); `fc00::1` (ULA); `0.0.0.0`, `::`
   (unspecified); and — **regardless of interpreter version** (design requirement) — `::ffff:169.254.169.254`,
   `::ffff:127.0.0.1` (IPv4-mapped), `64:ff9b::7f00:1` (NAT64 to `127.0.0.1`), `100.64.0.1` (CGNAT — the
   `is_private` fail-open the `not is_global` gate closes). Also assert a malformed string (e.g. `"not-an-ip"`)
   raises `EgressBlocked` (fail-closed parse).
3. `assert_public_ip` **allow** cases (must **not** raise): `93.184.216.34` (example.com public), `8.8.8.8`,
   `2606:2800:220:1:248:1893:25c8:1946` (public IPv6).
4. `assert_allowed_scheme`: `http` and `https` (and `HTTP`/`HTTPS`) do not raise; `file`, `gopher`, `ftp`,
   `data`, `dict` each `with pytest.raises(EgressBlocked)` (AC-4).
5. **FR-6 leak assertion:** for a representative deny (e.g. `10.0.0.5`), capture the raised exception and
   assert its `str()` contains **none** of the offending octets/host — `assert "10.0.0.5" not in str(exc.value)`.

**Verification**:
`cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . && uv run pytest tests/test_egress.py -q` — all pass; then the suite/coverage gate `uv run pytest --cov=app --cov-fail-under=40` — threshold holds.

---

### Step 3 — service: DNS-rebind-safe pinning transport (`app/egress.py`)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/egress.py` — modify

**Reviewers**: Security — DNS-rebinding pin (resolve → validate every A/AAAA → connect the pinned validated IP), reject-if-any on mixed resolution, per-hop revalidation fires at connect layer, construction-time fail-closed identity assertion; `xstockstrat-agent`

**Codebase Evidence**:
- Installed stack (recon, grounded against the venv): httpx **0.28.1** (`services/xstockstrat-agent/uv.lock:380-382`), httpcore **1.0.9** (`uv.lock:325-327`), anyio **4.13.0** (`uv.lock:20-21`) — confirmed present.
- httpx public `AsyncHTTPTransport` exposes `local_address` + `socket_options` but **not** `network_backend` (`httpx/_transports/default.py:280-311`, recon) — so the pin sits one layer below, on httpcore.
- `httpcore.AsyncConnectionPool.__init__` accepts `network_backend` (`httpcore/_async/connection_pool.py:60`, default `AutoBackend`) (recon).
- Pin hook: `httpcore.AsyncNetworkBackend.connect_tcp(host, port, timeout, local_address, socket_options)` (`httpcore/_backends/base.py:82-89`, recon) — fires on **every** connection incl. each redirect hop.
- SNI/Host preserved: TLS is a separate `start_tls(server_hostname=...)` step (`httpcore/_backends/anyio.py:55-73`, recon) — pinning the TCP IP does not change SNI.
- `assert_public_ip` / `EgressBlocked` from Step 1 (`services/xstockstrat-agent/app/egress.py`).

**TDD**: `red-green required` (paired with Step 4)

**Covers**: `—`

**Instructions**:
1. Add `import httpcore`, `import socket`, `import anyio` to `app/egress.py` (all installed — see Evidence).
2. Define `class PinnedValidatingBackend(httpcore.AsyncNetworkBackend)` overriding `async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None)`:
   - Resolve **off the event loop**: `infos = await anyio.to_thread.run_sync(lambda: socket.getaddrinfo(host, port, type=socket.SOCK_STREAM))` (never call blocking `socket.getaddrinfo` directly — design round-2 DoS finding).
   - Collect every resolved address `ip = info[4][0]` and call `assert_public_ip(ip)` for **all** of them.
     **Reject-if-any**: if any resolved A/AAAA fails, let `EgressBlocked` propagate (a mixed public+private
     answer is the rebind signal — never filter to the "good" ones).
   - Pick one validated IP and connect to the **pinned literal IP**, not the hostname, via a single
     **held** `httpcore.AutoBackend()` instance: `return await self._auto.connect_tcp(host=<validated_ip>, port=port, timeout=timeout, local_address=local_address, socket_options=socket_options)`. Hold the
     `AutoBackend()` on `self._auto` in `__init__`.
   - Do not override `connect_unix_socket` for real use; if httpcore requires it, raise `EgressBlocked`.
3. Define `class PinningTransport(httpx.AsyncHTTPTransport)`:
   - `def __init__(self, *args, **kwargs)`: call `super().__init__(*args, **kwargs)`, build
     `backend = PinnedValidatingBackend()`, then assign
     `self._pool = httpcore.AsyncConnectionPool(network_backend=backend, ...)` — carry over the pool config
     httpx's own `__init__` used (reuse the constructed `self._pool`'s existing kwargs where practical; the
     goal is only to swap in `network_backend`).
   - **Fail-closed identity assertion** at the end of `__init__`: hold the `backend` reference and
     `assert self._pool._network_backend is backend, "egress pin missing"` — raise (do not start) if the pin
     is ever silently absent. Assert on the **held instance identity**, so a future `self._pool` revert
     fails closed (design Open Risk #2 / Step Dependencies). Add a 2-line constraint comment: this private-attr
     read is the intentional fail-closed guard against a pin-absent revert.
4. Expose a small factory `def build_pinned_client(*, connect_timeout: float, read_timeout: float) -> httpx.AsyncClient`
   returning `httpx.AsyncClient(transport=PinningTransport(), timeout=httpx.Timeout(connect=connect_timeout, read=read_timeout), follow_redirects=False)` — Step 5 supplies the timeouts from config and owns the redirect loop.

**Verification**:
`cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check .` — clean; `python -c "import ast; ast.parse(open('services/xstockstrat-agent/app/egress.py').read())"` — parses. Behavioral proof (rebind, pinned-IP, identity assert) is Step 4.

---

### Step 4 — test: Transport pinning + rebind + identity-assert unit tests

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_egress.py` — modify

**Reviewers**: `xstockstrat-agent`; Security — rebind fail-closed coverage (public name → internal A record blocked, no connect), reject-if-any mixed resolution, pinned-IP connect, construction-time identity assertion

**Codebase Evidence**:
- respx **bypasses** a custom transport (recon Risks) — so these tests monkeypatch the resolver /
  `AutoBackend.connect_tcp` directly rather than using respx. respx stays for the Step 6 happy path only.
- `PinnedValidatingBackend`, `PinningTransport`, `build_pinned_client`, `EgressBlocked` from Step 3.
- anyio present (`uv.lock:20`) → `anyio.to_thread.run_sync` is the resolver seam to assert is used.

**TDD**: `red-green required` — fails before Step 3 (symbols absent), passes after.

**Covers**: `AC-3`

**Instructions**:
1. In `test_egress.py`, add async tests (mark `@pytest.mark.asyncio`, mirroring `test_tools.py`).
2. **Rebind block (AC-3):** monkeypatch `socket.getaddrinfo` (module-patched as seen by `app.egress`) to
   return an internal address for `evil.example.com` (e.g. a single tuple resolving to `10.1.2.3`).
   Instantiate `PinnedValidatingBackend()` and `await backend.connect_tcp("evil.example.com", 443)`; assert
   it raises `EgressBlocked` **and** that the held `AutoBackend`'s `connect_tcp` was **never called** (patch
   `self._auto.connect_tcp` with an `AsyncMock` and assert `not called`) — no connection to `10.1.2.3`.
3. **Reject-if-any mixed resolution:** resolver returns two addresses, one public (`93.184.216.34`) and one
   private (`10.0.0.9`); assert `connect_tcp` raises `EgressBlocked` and the inner backend is not called.
4. **Pinned-IP connect (AC-3 second clause):** resolver returns only a public IP; patch the held
   `AutoBackend.connect_tcp` (`AsyncMock`) and assert `connect_tcp` calls it with `host=<the resolved public
   IP literal>` (not the hostname) — the connection targets the pinned validated address, never a re-resolved
   name.
5. **Identity assertion:** construct `PinningTransport()`; assert `t._pool._network_backend` **is** the same
   `PinnedValidatingBackend` instance it holds. Then simulate the revert (set `t._pool` to a fresh
   `httpcore.AsyncConnectionPool()` with no pin) and assert a re-run of the identity check would fail — i.e.
   confirm the assertion is on instance identity, so a pin-absent pool is rejected at construction.
6. **Resolver off-loop:** assert `anyio.to_thread.run_sync` is invoked during `connect_tcp` (patch it with a
   pass-through wrapper `MagicMock` and assert called) — guards the blocking-getaddrinfo regression.

**Verification**:
`cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . && uv run pytest tests/test_egress.py -q` — all pass.

---

### Step 5 — service: Harden `_fetch_url` (redirect loop, byte-cap, config, FR-6 record)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify (`_fetch_url` at `:2226-2241`)

**Reviewers**: Security — redirect re-validation on every hop (scheme + IP), cross-origin credential strip (no `Authorization`/`Cookie` leak to a redirect host), bounded redirects/size/timeouts, no internal host/IP/port enumeration leaked to the model; `xstockstrat-agent` — MCP tool contract (name/params/return) unchanged, `docs/runbooks/mcp-tools.md` parity (no contract edit needed — decision recorded)

**Codebase Evidence**:
- `services/xstockstrat-agent/app/tools.py:2226-2241` — current `_fetch_url(url, password=None, headers=None)`:
  lazy `import httpx` (`:2232`); builds headers + optional `Authorization: Bearer {password}` (`:2234-2236`);
  `httpx.AsyncClient(timeout=30.0, follow_redirects=True)` then `c.get(url, headers=...)`;
  `r.raise_for_status(); return r.text` (`:2238-2241`) — **no scheme check, no IP validation, no size cap**.
- Callers (both must keep working unchanged): `extract_email_content` loops caller `urls` → `_fetch_url`
  (`services/xstockstrat-agent/app/tools.py:508-510`); `extract_website_content` → `_fetch_url` with source
  `config_json.url` + optional `request_headers` (`:544`). Tool defs at `:474-475` / `:515-516`.
- Config read pattern to mirror: `services/xstockstrat-agent/app/oauth_server.py:82-85` →
  `await client.get_config_value("oauth.registration_enabled", namespace="agent", environment=resolve_scope(""))`
  wrapped in try/except with a safe default on failure; `resolve_scope` at `services/xstockstrat-agent/app/scopes.py:21`;
  `get_config_value` at `services/xstockstrat-agent/app/client.py:1610`.
- Module logger for the FR-6 record: `services/xstockstrat-agent/app/tools.py:90` → `log`.
- httpx 0.28.1 does **not** re-check scheme on redirect and strips cross-origin credentials in its own
  follow path (`_client.py:517-544,552-569,1474-1483`, design) — the manual loop must replicate both.

**TDD**: `red-green required` (paired with Step 6)

**Covers**: `—`

**Instructions**:
1. Add `from app import egress` (and reuse the existing lazy `import httpx` at `:2232`). Read the four
   policy scalars via the `oauth_server.py:82-85` pattern, each in a try/except with a safe fallback default
   and namespace/env `namespace="agent", environment=resolve_scope("")`:
   - `agent.extract.max_redirects` → int, default `5`
   - `agent.extract.max_bytes` → int, default `5_000_000`
   - `agent.extract.connect_timeout_seconds` → float, default `10.0`
   - `agent.extract.read_timeout_seconds` → float, default `30.0`
   These defaults are the fallback-on-read-failure path (C-05: defaults declared in CLAUDE.md — Step 7); the
   **effective** value always comes from config when present (F-07 — no hardcoded policy literal is the
   authoritative source; the numeric fallbacks exist only for a config-read failure, mirroring the existing
   `agent.oauth.*` reads).
2. Build the client via `egress.build_pinned_client(connect_timeout=..., read_timeout=...)` (Step 3) with
   `follow_redirects=False`.
3. **Pre-request:** `egress.assert_allowed_scheme(urlparse(url).scheme)` before any fetch (FR-3). Keep the
   existing `Authorization: Bearer {password}` header construction (`:2235-2236`).
4. **Manual bounded redirect loop** up to `max_redirects`:
   - Issue the request with `async with client.stream("GET", current_url, headers=headers) as r:` (streamed,
     so the byte-cap can abort early — `c.get()` would buffer the whole body and defeat FR-4).
   - If status is a 3xx with a `Location`: resolve `Location` against `current_url` (`httpx.URL.join` or
     `urllib.parse.urljoin`), `egress.assert_allowed_scheme` the new scheme (per-hop FR-3/FR-4), and
     **replicate httpx's cross-origin credential strip** — when the next hop is not same-origin (except an
     HTTP→HTTPS upgrade on the same host), drop `Authorization` and `Cookie` from `headers` and reset any
     `Host` (mirrors `_client.py:552-569`; prevents the `password`-derived Bearer leaking to a redirect host).
     Decrement the budget; on exceeding `max_redirects` raise the generic tool error.
   - The connect-layer IP pin (Step 3) re-validates every hop's resolved address automatically, so no
     per-hop IP check is duplicated in the loop — cite this in the code comment (2-line cap).
   - On a non-redirect response: `raise_for_status()`, then read the body via `aiter_bytes()`, accumulating
     and **aborting past `max_bytes`** (break + raise the generic error); decode to text and return.
5. **FR-6:** wrap the fetch so any `egress.EgressBlocked` (from the pinning backend or the scheme check) — or
   a `max_redirects`/`max_bytes` breach — is caught, `log.warning(...)` a **non-enumerating** record (e.g.
   `"extract egress blocked"` with a static reason code, **no** url/host/IP/port), and re-raised as a generic
   tool error (a `RuntimeError`/`ValueError` whose message carries no internal target detail). The caller-facing
   error the model sees must contain no hostname/IP/port.
6. Do **not** change either tool's signature, the `urls`/`config_json.url` call sites (`:510`, `:544`), or the
   `{raw_text: ...}` return shape — the contract is preserved (C-16 tool set, C-14 surface).

**Verification**:
`cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check .` — clean; then
`grep -nE "10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.0\.0\.1|169\.254|max_redirects\s*=\s*[0-9]|max_bytes\s*=\s*[0-9]{4,}" services/xstockstrat-agent/app/tools.py` — the only numeric matches are the labeled `default=` fallbacks in the config reads, never an authoritative policy literal (F-07/@AC-8). Behavioral proof is Step 6.

---

### Step 6 — test: `_fetch_url` + extract-tool behavior (block / happy path / no-leak / config)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify (extract sections at `:195-327`)

**Reviewers**: `xstockstrat-agent` — service owner; Security — end-to-end block correctness, non-enumerating error, config-sourced limits enforced

**Codebase Evidence**:
- Existing extract tests + respx happy-path pattern to extend: `services/xstockstrat-agent/tests/test_tools.py`
  `test_extract_website_content_fetches_url:240-246`, `_sends_request_headers:252-277`, email section `:199-236`;
  helpers `_make_server`/`_tool_fn` (`:17-25`), `import respx`/`import httpx` (`:8-10`), `from tests.conftest import ADMIN, _ctx` (`:14`).
- C-16 regression guard (do **not** duplicate): `services/xstockstrat-agent/tests/test_tools_endpoint.py:17`
  `test_list_tools_returns_all_registered_tools` asserts the exact 43-name set incl. `extract_website_content`
  + `extract_email_content` — this is the tool-count guarantee (`services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature:9-14` "advertised tool count is 43"). Keep it green; add no numeric duplicate.
- Config read seam to override in-test: `client.get_config_value` (patch it to return controlled limits).
- respx bypasses the custom transport (recon) → block cases monkeypatch the resolver (as in Step 4); the
  happy path uses respx because it patches above the transport and exercises the public-URL path.

**TDD**: `red-green required` — the block/no-leak/config assertions fail against the pre-Step-5 `_fetch_url`
(which fetches internal targets and returns their text), pass after.

**Covers**: `AC-1, AC-2, AC-5, AC-6, AC-7, AC-8`

**Instructions**:
1. **AC-6 happy path (respx):** keep/extend `test_extract_website_content_fetches_url` — a public
   `https://example.com/article` returning HTML within the size limit is still fetched and its extracted text
   returned unchanged. Confirm `test_extract_website_content_sends_request_headers` still passes (per-source
   `request_headers` still forwarded). This proves behavior for well-formed public requests is unchanged.
2. **AC-1 / AC-2 end-to-end block:** call `extract_website_content` (via a source whose `config_json.url`
   is `http://169.254.169.254/latest/meta-data/...`, then `http://10.0.0.5:50060/`, then
   `http://127.0.0.1:50051/`) and, separately, `extract_email_content(..., urls=[...])` with an internal URL;
   with the resolver monkeypatched so those hosts resolve to themselves, assert each raises the generic tool
   error and that **no** HTTP request / socket connect reached the target (patch the held `AutoBackend.connect_tcp`
   as an `AsyncMock` and assert not called; or assert respx recorded no matching request).
3. **AC-5 redirect mid-chain:** with respx, a public `https://public.example.com/r` returns `302` to
   `http://169.254.169.254/`; assert `extract_website_content` returns the egress error, does not follow to the
   metadata host, and returns no metadata content. (Because respx bypasses the pin, this test asserts the
   **app-layer** redirect-loop revalidation — the `assert_allowed_scheme`/target check in the manual loop.)
4. **AC-7 no leak + recorded:** for a blocked internal call, assert the raised error's `str()` contains no
   internal hostname, IP, or port; and assert the FR-6 record fired — use `caplog` (pytest) to assert a
   `log.warning` was emitted whose message likewise contains no host/IP/port (a static reason string only).
5. **AC-8 config-sourced:** patch `client.get_config_value` to return a **lowered** `agent.extract.max_bytes`
   (e.g. 10) and assert a public response larger than that is aborted with the generic error (limit enforced
   from config); separately lower `agent.extract.max_redirects` to `0` and assert a single redirect is refused.
   Then assert the source has no hardcoded authoritative limit: `grep -nE "max_bytes|max_redirects|connect_timeout|read_timeout" services/xstockstrat-agent/app/tools.py` shows the values sourced via `get_config_value` (numeric literals only as labeled `default=` fallbacks).
6. Ensure the existing `tests/test_tools_endpoint.py::test_list_tools_returns_all_registered_tools` still
   passes (C-16 — both extract tools present, set unchanged); run it as part of verification.

**Verification**:
`cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . && uv run pytest tests/test_tools.py tests/test_egress.py tests/test_tools_endpoint.py -q` — all pass; then the coverage gate
`cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40` — threshold (40%) holds.

---

### Step 7 — config: Declare `agent.extract.*` keys in the service CLAUDE.md

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/CLAUDE.md` — modify (§ Config Keys Consumed table)

**Reviewers**: `xstockstrat-agent` — config key naming (`<service>.<category>.<key>`) and declared defaults (C-05)

**Codebase Evidence**:
- `services/xstockstrat-agent/CLAUDE.md:185` → `## Config Keys Consumed` (namespace `agent`, resolved via
  `client.get_config_value()`); existing rows at `:192` (`agent.oauth.registration_enabled`) and `:194`
  (`agent.signal.alert_threshold`) — the exact table shape to extend (Key | Type | Default | Description).
- C-05 requires defaults declared in each service's CLAUDE.md; F-07 satisfied because these are the
  fallback-on-read-failure defaults, the authoritative values come from the config service (Step 5 reads).

**TDD**: `N/A (docs/config declaration — no code path; enforced behaviorally by @AC-8 in Step 6)`

**Covers**: `—`

**Instructions**:
1. In `services/xstockstrat-agent/CLAUDE.md` § Config Keys Consumed (`:185`), append four rows matching the
   Step 5 reads and defaults:
   - `agent.extract.max_redirects` | int | `5` | Max redirect hops the extract_* fetch path will follow; each hop's scheme + resolved address is re-validated (SSRF hardening, feature 207)
   - `agent.extract.max_bytes` | int | `5000000` | Max response body bytes read before the extract_* fetch aborts (feature 207)
   - `agent.extract.connect_timeout_seconds` | float | `10.0` | Connect timeout for the extract_* fetch (feature 207)
   - `agent.extract.read_timeout_seconds` | float | `30.0` | Read timeout for the extract_* fetch (feature 207)
2. Keep the values **identical** to the Step 5 fallback defaults (a mismatch is the drift @AC-8 guards
   against). Do not add a CIDR/deny-range key — deny-ranges are stdlib-derived (design), not a config value.
3. **Teardown (root CLAUDE.md § Teardown):** this step edits a context file (`CLAUDE.md`). At execute time,
   after this step, run `/context-forge:context-constitution refresh` scoped to `services/xstockstrat-agent/`
   and reconcile any grounded drift before the PR (or record the manual reconciliation in the PR body if the
   plugin is unavailable).

**Verification**:
`grep -n "agent.extract.max_redirects\|agent.extract.max_bytes\|agent.extract.connect_timeout_seconds\|agent.extract.read_timeout_seconds" services/xstockstrat-agent/CLAUDE.md` — all four present; confirm each Default column value equals the corresponding Step 5 `default=` fallback.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
