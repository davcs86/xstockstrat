# Design: extract-tool-ssrf-hardening

**Created**: 2026-09-28
**Rounds**: 2 (full; termination: approved — operator chose deny-by-range core, domain allowlist deferred)
**Approved by**: user @ 2026-09-28
**Grounded in**: recon.md (all library claims verified against installed httpx 0.28.1 / httpcore 1.0.9 / stdlib ipaddress)

---

## Chosen Approach

Three-layer hardening of the single shared fetch chokepoint `_fetch_url` (`app/tools.py:2226`), through
which **both** `extract_website_content` (`:544`) and `extract_email_content` (`:510`) fetch — so one
hardening covers both tools (C-10). No new tool, no proto, no migration; tool count stays **43** (C-16).
Consumer surface (C-14): the two Agent tools, behavioral change only (denied targets now error).

**Layer 1 — pure validator `app/egress.py` (FR-1/FR-3).**
- `assert_public_ip(ip_str)`: parse via `ipaddress.ip_address`; **PRIMARY gate = reject if `not
  ip.is_global`** — denies anything not globally routable. This closes the CGNAT `100.64.0.0/10`
  fail-open hole that `is_private` leaves (`ipaddress.py:1344,1354-1357`), delegates through
  `ipv4_mapped` unwrapping so `::ffff:169.254.169.254` / `::ffff:127.0.0.1` are covered, and
  auto-covers future special ranges (`ipaddress.py:1556-1566`). **Defense-in-depth** (guards
  interpreter-version drift): also explicitly reject `is_loopback`, `is_link_local`, `is_unspecified`,
  `is_reserved`, `is_private`, and a literal `169.254.169.254` / `::ffff:a9fe:a9fe`.
- `assert_allowed_scheme(scheme)`: allow only `{http, https}`.
- Both raise an opaque internal `EgressBlocked` (no address echoed — FR-6). Unit-tested directly (respx
  patches above this layer).

**Layer 2 — pinning transport (FR-1/FR-2/FR-4-per-hop).** **Subclass `httpx.AsyncHTTPTransport`**,
call `super().__init__()`, then assign `self._pool = httpcore.AsyncConnectionPool(...,
network_backend=<PinnedValidatingBackend instance>)` — inheriting httpx's tested request/stream/
exception bridge (a from-scratch `AsyncBaseTransport` was **rejected** round 2: its hand-rolled
`handle_async_request` can silently drop `request.extensions` connect-timeout/SNI and botch
`AsyncResponseStream` close semantics, leaking pooled connections). `__init__` ends with a
**fail-closed identity assertion**: hold a reference to the `PinnedValidatingBackend` instance and
assert `self._pool._network_backend is that_instance` — raise and refuse to start otherwise, so the
pin can never be silently absent (guards a future `self._pool` revert; the private-attr read is the
intentional guard).
- `PinnedValidatingBackend(httpcore.AsyncNetworkBackend)` overrides `connect_tcp` (`_backends/base.py:82-89`):
  resolve host via **`await anyio.to_thread.run_sync(socket.getaddrinfo, ...)`** (never blocking
  `socket.getaddrinfo` on the event loop — round-2 DoS finding); if **ANY** resolved A/AAAA fails
  `assert_public_ip` → raise `EgressBlocked` (**reject-if-any**; a mixed public+private answer is the
  rebind signal — never filter); else connect to the pinned validated IP via a **single held**
  `AutoBackend().connect_tcp(host=<validated_ip>, ...)`. SNI/Host unaffected — TLS `start_tls(
  server_hostname=...)` is a separate step (`_backends/anyio.py:55-73`). Fires on every hop.

**Layer 3 — hardened `_fetch_url` (FR-3/FR-4/FR-6).** Run the client with `follow_redirects=False` and a
**manual bounded redirect loop** up to `max_redirects`: per 3xx, resolve `Location` against the current
URL, `assert_allowed_scheme` on it (httpx 0.28.1 does **not** re-check scheme on redirect —
`_client.py:517-544,1474-1483`), and **replicate httpx's cross-origin credential strip** — drop
`Authorization` (and `Cookie`) and reset `Host` when the hop is not same-origin (except HTTP→HTTPS same
host), mirroring `_client.py:552-569` (round-2 finding: the `password`→`Authorization: Bearer` at
`tools.py:2235-2236` must not leak to a redirect host). Body read via `async with client.stream("GET",
url)` + `aiter_bytes()`, aborting past `max_bytes` (the context manager releases the connection on early
break — `c.get()` would buffer the whole body and defeat FR-4). Bounded `httpx.Timeout(connect=, read=)`.
On any block → `log.warning` a non-enumerating record (FR-6, reuse module `log`) and raise a generic
tool error carrying no host/IP/port.

**Config (FR-5).** Four scalar keys read via `client.get_config_value("extract.<key>", namespace="agent",
environment=resolve_scope(""))` (pattern `oauth_server.py:82-85`), declared in
`services/xstockstrat-agent/CLAUDE.md` § Config Keys Consumed: `agent.extract.max_redirects`,
`agent.extract.max_bytes`, `agent.extract.connect_timeout_seconds`, `agent.extract.read_timeout_seconds`,
each parsed with a safe fallback default. **Deny-ranges are stdlib-derived** by the `not is_global` rule,
not a configured CIDR literal — so no CIDR config key (this is a security invariant, not a tunable;
satisfies F-07/C-05, which govern config *values*, not RFC semantics).

**Domain allowlist: deferred (operator decision @ 2026-09-28).** Deny-by-range is the fail-closed core
that closes the internal-SSRF pivot (the audit finding). An operator domain allowlist is additive and
drops in later as one `agent.extract.domain_allowlist` key if wanted (see Open Risks residual).

**Tests.** `assert_public_ip` unit tests MUST include `::ffff:169.254.169.254`, `::ffff:127.0.0.1`,
NAT64 `64:ff9b::7f00:1`, and CGNAT `100.64.0.1` (regardless of interpreter version); reject-if-any
mixed-resolution; per-hop scheme; cross-origin Authorization-strip; byte-cap; respx happy path (public
URL still fetched — @AC-6); and a C-16 assertion that tool count == 43. Pin/verify the test interpreter
against the agent Docker image's Python (recon 3.12 vs CLAUDE.md 3.13 — reconcile at /sdd-spec).

## Rejected Alternatives

- **`ipaddress.is_private` (or enumerated `is_private|is_loopback|...`) as the primary gate** — rejected: fail-OPEN for CGNAT `100.64.0.0/10` and brittle to future special ranges. `not is_global` is strictly safer.
- **Pre-resolve + validate, then hand the hostname back to httpx** — rejected: httpcore re-resolves at connect → TOCTOU DNS-rebind, fails FR-2. Pinning the literal validated IP at `connect_tcp` is the only rebind-safe seam.
- **From-scratch `httpx.AsyncBaseTransport` owning the pool** (round-1 proposal) — rejected round 2: the hand-rolled `handle_async_request` can silently drop connect-timeout/SNI extensions and mishandle stream close (connection leak); subclassing inherits the tested bridge, and the identity assertion already covers the `self._pool`-revert risk the from-scratch approach was meant to avoid.
- **Keep `follow_redirects=True` and rely only on the connect-layer IP pin** — rejected: loses the app-layer per-hop *scheme* check and the explicit `max_redirects` bound; but note it would have given cross-origin credential-strip for free — which the manual loop must now replicate (the crux round-2 fix).
- **Blocking `socket.getaddrinfo` in `connect_tcp`** — rejected: stalls the single asyncio loop (DoS); use `anyio.to_thread.run_sync`.
- **Domain allowlist in v1** — deferred (operator): deny-by-range is the fail-closed core; allowlist is additive and risks breaking legitimate public extraction.

## Open Risks

- [ ] **Accepted C-14 residual**: deny-by-range does not stop a prompt-injected agent fetching arbitrary *public* attacker hosts (content exfil via `extract_email_content` caller URLs). The cross-origin credential-strip removes the auth-leak vector; residual content-exfil is explicitly accepted — a domain allowlist is the named future mitigation (`agent.extract.domain_allowlist`). → recorded; no follow-up feature filed yet.
- [ ] **httpx/httpcore internal coupling**: the `self._pool` assignment + `connect_tcp`/`AsyncConnectionPool` seam is version-coupled to httpx 0.28.x / httpcore 1.x. The construction-time identity assertion fails closed on a revert; an httpcore bump that renames the pool's backend attr would make the assertion read the wrong attr → /sdd-spec must assert on the held instance identity, and CI must run the rebind fail-closed test. → target: transport step + its test.
- [ ] **Python version**: reconcile 3.12 (recon/venv) vs 3.13 (CLAUDE.md); verify `is_global` mapped-address semantics on the deployed image's interpreter; the explicit deny-list defense-in-depth covers a pre-3.12.4 image. → target: /sdd-spec + validator test step.

## Constitution Rules Touched

- **C-05 / F-07** — honored: the tunable knobs (`agent.extract.*` scalars) are config-sourced via `get_config_value`; RFC deny-ranges are stdlib security semantics, not config values (not an F-07 breach).
- **C-10** — honored: both extract tools share the one hardened `_fetch_url`; the paired test exercises both callers.
- **C-11** — honored: this is the mandatory design grounding (full mode, 2 rounds).
- **C-13** — honored: new Python tests use `tests/` conventions (respx happy path + direct unit tests); no inline domain-fixture duplication introduced.
- **C-14** — honored: the two Agent extract tools are the named consumer surface; residual public-host exfil recorded, not hidden.
- **C-16** — honored: PRESERVE tool count = 43 (`remove-agent-postgres-mcp.feature` `@AC-1`); 207 adds the first durable extract_* coverage (new, promoted at launch).
- **C-18** — honored: least-mechanism (one helper, no allowlist v1, stdlib validator); `not is_global` over a hand-maintained CIDR list; subclass over reimplemented bridge.
- **P-06** — honored: RED-before-green per code step (validator denies before impl; blocked-fetch test).
- **F-04/P-03** — honored: every library mechanism grounded against the installed source; unknowns surfaced, not guessed.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @FR-1 @feature-214` "agent tool count = 43" (`services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature`) — not regressed by: behavioral-only change to `_fetch_url`, no tool add/remove/rename; paired test asserts == 43.
- NEW durable coverage (promoted at launch): extract_* public-URL fetch succeeds / private-or-internal target blocked (`@AC-1..@AC-8` of this feature). Not a CHANGE to any existing rule.
