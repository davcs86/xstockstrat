# Context: extract-tool-ssrf-hardening

**Feature**: `docs/roadmap/features/207-extract-tool-ssrf-hardening/feature.md`
**Product Spec**: `docs/roadmap/features/207-extract-tool-ssrf-hardening/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/207-extract-tool-ssrf-hardening/implementation-spec.md`

---

## Session 2026-09-25 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Provenance**: backlog security follow-on from the 2026-09-16 trading-system security audit
  (`docs/reports/2026-09-16-trading-system-security-audit.md`). The agent SSRF is the "M-list"
  backlog item and is explicitly called out in the DT-2 remediation (§150): "fix the agent SSRF —
  `extract_*` follow redirects to caller-supplied URLs with no allowlist, reaching [internal]." It is
  the prompt-injection **ingress** left out of scope by the agent DB-tooling remediation. That
  remediation is now feature 214 (`remove-agent-postgres-mcp`), which removes the `db_*` SQL egress;
  this feature closes the fetch ingress. The two are independent — no ordering dependency. (History:
  the DB remediation began as feature 193 `sysadmin-db-write-role` — separation — demoted/imported as
  feature 212, then replaced by the 214 removal when postgres-mcp was judged inherently insecure.)
- **Not a dup of `093-fix-mcp-extract-credentials`**: 093 (launched) concerned credentials handling
  on the extract path; this feature concerns SSRF egress validation of the fetch target. Distinct
  scope — confirmed before allocating the number.
- Created for pickup by another session per operator direction (Phase D security backlog).
- Open forks recorded in product-spec.md § Open Questions (config surface + whether a domain
  allowlist ships in v1 + the email-tool remote-fetch path). Resolve in `/sdd-design`.

## Session 2026-09-28 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria pass: initially **FAIL** on one C-15 blocker — FR-5 (egress policy sourced from config) had
  no covering `@AC-*` scenario. **Fixed before advancing** (operator standing rule): added
  `@AC-8 @FR-5` (config-sourced egress policy; operator lowers a limit → subsequent fetches enforce it;
  no hardcoded CIDR/limit). Re-verified criterion 8: FR-1→AC-1/2, FR-2→AC-3, FR-3→AC-4, FR-4→AC-5/6,
  FR-5→AC-8, FR-6→AC-7 — all covered, AC IDs unique.
- Warnings addressed:
  - OQ2 RESOLVED (code): both extract tools share one `_fetch_url` (`app/tools.py:2226`; callers `:544`,
    `:510`) — currently no scheme/address/size validation. Hardening the single helper covers both (C-10).
  - OQ1 (config key set + domain-allowlist-in-v1?) and FR-6 audit mechanism (span vs structured log) →
    genuine design forks, routed to /sdd-design (their named venue); will surface to operator at design gate.
  - OQ3 (no hardcoded egress literals, C-05/F-07) → standing execution-time guard, asserted by @AC-8.
  - AC-3 `Then` de-implementation-flavored per the advisory NOTE.
- Overlap: WARN-only — soft `app/tools.py` rebase vs 214 (disjoint db_* block); now moot (214 merged to
  main-dev fc86bb5). `agent.extract.*` keys unique repo-wide; no migration/proto/config FAIL; no merge-order entry.

## Session 2026-09-28 — sdd-design (full, 2 rounds)

- Phase 0 Recon: recon.md (service: xstockstrat-agent). Reuse: single shared `_fetch_url` chokepoint;
  `get_config_value(namespace="agent")`; module `log` for FR-6; respx happy-path + direct validator units.
- Phase 1 Grilling: 2 rounds. Chosen: 3-layer SSRF hardening — pure `not-is_global` validator (app/egress.py)
  → subclassed httpx.AsyncHTTPTransport owning a pinned-connect httpcore backend (reject-if-any, async
  getaddrinfo, identity fail-closed assert) → hardened `_fetch_url` (manual per-hop redirect loop: scheme +
  IP + cross-origin credential-strip; streamed byte-cap). Config: 4 scalar agent.extract.* keys; deny-ranges
  stdlib-derived. FR-6: log.warning. Domain allowlist DEFERRED (operator decision 2026-09-28).
- Round 1 adversary (all folded): CGNAT is_private fail-open → not-is_global; self._pool silent-revert =
  TOTAL bypass → identity assert; per-hop scheme unenforced (httpx 0.28.1 grounded); pick-one → reject-if-any;
  python-version mapped-address semantics → explicit unit tests + interpreter pin.
- Round 2 adversary (all folded): manual redirect loop must replicate httpx cross-origin Authorization-strip
  (credential-exfil regression) → per-hop strip; blocking getaddrinfo → anyio.to_thread; byte-cap needs
  c.stream()+aclose not c.get(); FROM-SCRATCH transport REVERSED → subclass AsyncHTTPTransport (inherit tested
  bridge) + identity assert.
- Constitution: C-05/F-07 (config knobs vs stdlib invariants), C-10, C-14, C-16, C-18, P-06, F-04. Floor: none.
- Status: spec-ready → design-approved.

## Session 2026-09-28 — sdd-spec

- Generated implementation-spec.md with 7 steps. Status → implementation-ready.
- Structure (bottom-up, all one service `xstockstrat-agent`; no proto/migration/trading-domain):
  1 service `app/egress.py` validator (create) → 2 test (validator units, AC-1/2/4) → 3 service pinning
  transport in `app/egress.py` → 4 test (rebind/identity/pinned-IP, AC-3) → 5 service harden `_fetch_url`
  in `app/tools.py` → 6 test (block/happy/no-leak/config, AC-1/2/5/6/7/8) → 7 config declare
  `agent.extract.*` keys in service CLAUDE.md. Every @AC covered; scenario-coverage table in the spec.
- Key codebase findings (all grep/read-confirmed this session):
  - `_fetch_url` at `app/tools.py:2226-2241` (no scheme/IP/size check, `follow_redirects=True`, `c.get`+`r.text`);
    callers `extract_email_content` `:508-510`, `extract_website_content` `:544`; module `log` at `:90`.
  - Config read pattern `oauth_server.py:82-85` (try/except + safe default) via `client.get_config_value`
    (`app/client.py:1610`) + `resolve_scope` (`app/scopes.py:21`); § Config Keys Consumed at `CLAUDE.md:185`
    (existing rows `:192`,`:194`).
  - **C-16 guard is the existing exact-name-set test** `tests/test_tools_endpoint.py:17`
    `test_list_tools_returns_all_registered_tools` (asserts the full 43-name set incl. both extract tools) —
    reused, no numeric duplicate added (C-18/DRY). Ties to `remove-agent-postgres-mcp.feature:9-14` "count is 43".
  - Installed stack confirmed in `uv.lock`: httpx 0.28.1 (`:380`), httpcore 1.0.9 (`:325`), anyio 4.13.0
    (`:20`), respx 0.23.1 (`:923`) — matches recon; no new dep.
  - Test harness: `test_tools.py` respx happy-path `:240-277`, helpers `_make_server`/`_tool_fn` `:17-25`,
    `from tests.conftest import ADMIN, _ctx` `:14`; conftest `_ctx`/`ADMIN` present.
- **Python-version thread RESOLVED:** deployed image `python:3.13-slim` (`Dockerfile:1`), `pyproject:4`
  requires `>=3.12`, local venv 3.12. 3.13 has modern `is_global` mapped semantics; Step 1 explicit deny-list
  defense-in-depth covers pre-3.12.4, and Step 2 asserts mapped/NAT64/CGNAT regardless of interpreter.
- httpx/httpcore coupling thread → targeted to Steps 3+4 (held-instance identity assertion + rebind
  fail-closed test that CI runs).

## Open Threads

- [ ] Accepted C-14 residual: content exfil to arbitrary PUBLIC hosts via caller URLs (allowlist deferred; credential-leak vector closed by cross-origin strip). Target: recorded; file follow-up feature only if an operator wants positive gating.
- [x] httpx/httpcore internal coupling (self._pool + connect_tcp) — identity fail-closed assert + rebind CI test. Targeted to spec Steps 3 (assertion) + 4 (rebind/identity test).
- [x] Reconcile Python 3.12 (recon/venv) vs 3.13 (CLAUDE.md) — deployed image is 3.13 (`Dockerfile:1`); explicit deny-list DiD + interpreter-independent unit cases cover the drift (spec Steps 1+2).

## Session 2026-09-28 — sdd-review impl-spec (advisory)

- Result: 1 failure, 3 warnings/notes (advisory — did not block). No Floor breach. Criteria PASS WITH
  WARNINGS; every cited symbol/path/version confirmed against the tree; C-08/C-15/P-06 complete.
- **Warnings addressed before execution** (operator standing rule):
  - [x] Step 4 (test) omitted `--cov-fail-under` → added the service-wide `pytest --cov=app --cov-fail-under=40`
    gate to its Verification (matching Steps 2/6).
  - [x] Step 5 NOTE: `urllib.parse` (urlparse/urljoin) + `resolve_scope` imports not enumerated → added to Step 5 Instruction 1.
  - [~] Step 3 fail-closed identity assertion reads httpx-private `self._pool._network_backend` — intentional,
    commented, and tracked as design Open Risk #2 (re-verify on any httpx/httpcore bump). No change (accepted approach).
- Overlap: WARN-only — soft `app/tools.py` import-block rebase vs 217 (implementation-ready; disjoint
  functions). `agent.extract.*` keys unique repo-wide. 214 already merged (trunk). No migration/proto/config
  FAIL; no merge-order entry required.
- Nothing carried into execution as `[ ] unaddressed`.

## Session 2026-09-28 — sdd-execute (sequential)

- Re-spec gate: merged main-dev (already up to date — 207 branched post-214); validated all 7 steps'
  evidence, zero drift, no re-spec. Tooling: agent .venv present (httpx 0.28.1/httpcore 1.0.9/anyio/respx
  import OK, pytest 9.0.3). No DB started.
- Executing under operator standing "all the way to code + PRs" authorization; all 7 steps are agent-surface
  (checkpoints at step cap only).

### Step 1 — Pure egress validator app/egress.py [done]
- Created app/egress.py: EgressBlocked (opaque, no address echoed), assert_allowed_scheme (http/https),
  assert_public_ip (ipv4-mapped unwrap → primary `not is_global` gate → DiD is_loopback/link_local/
  unspecified/reserved/private/multicast + literal metadata; fail-closed parse).
- Files modified: `app/egress.py` (new)
- TDD: paired with Step 2. Deviations: none.

### Step 2 — Validator unit tests [done]
- Created tests/test_egress.py: 15 deny IPs (incl. ::ffff:169.254.169.254, ::ffff:127.0.0.1, NAT64
  64:ff9b::7f00:1, CGNAT 100.64.0.1), 3 allow IPs, malformed, scheme allow/deny, FR-6 no-leak. 30 passed.
- Files modified: `tests/test_egress.py` (new)
- TDD: RED = ImportError with egress.py moved aside (captured); GREEN = 30 passed; full suite 461 passed, 79.80% cov.
- Deviations: none.

### Step 3 — DNS-rebind-safe pinning transport app/egress.py [done]
- Appended to app/egress.py: `PinnedValidatingBackend(httpcore.AsyncNetworkBackend)` — resolves off the
  event loop via `anyio.to_thread.run_sync(getaddrinfo)`, validates EVERY resolved A/AAAA with
  `assert_public_ip` (reject-if-any on mixed answers), then connects to the pinned validated IP literal via
  a held `self._auto = httpcore.AnyIOBackend()`; `connect_unix_socket` raises EgressBlocked.
  `PinningTransport(httpx.AsyncHTTPTransport)` swaps `self._pool._network_backend` onto the pin + fail-closed
  identity assertion. `build_pinned_client(connect_timeout, read_timeout)` → AsyncClient with
  follow_redirects=False (Step 5 owns the bounded redirect loop).
- Files modified: `app/egress.py`
- TDD: red-green paired with Step 4.
- Deviations: **DEV-1** — held inner backend is `httpcore.AnyIOBackend`, not `AutoBackend` (`AutoBackend`
  is not a public httpcore export; `AnyIOBackend` is what it selects under asyncio). **DEV-2** — pin
  installed by swapping `self._pool._network_backend` on httpx's already-built pool rather than rebuilding
  the pool (realizes the spec's stated "only swap in network_backend" goal, preserves ssl/http2/limits).
  Both recorded in impl-spec Deviation Log.

### Step 4 — Transport pinning + rebind + identity-assert tests [done]
- Extended tests/test_egress.py with 5 async tests (asyncio_mode=auto; `@pytest.mark.asyncio` per spec):
  rebind block (public name → internal A record → EgressBlocked, inner `_auto.connect_tcp` never called),
  reject-if-any mixed public+private, pinned-IP connect (asserts inner called with host=<validated IP
  literal>, not hostname), construction-time pin identity assertion (+ fresh unpinned pool discriminates),
  resolver-off-loop (anyio.to_thread.run_sync spy asserted invoked). Monkeypatch resolver/`_auto` directly —
  respx bypasses custom transports (reserved for Step 6 happy path).
- Files modified: `tests/test_egress.py`
- TDD: RED = ImportError on PinnedValidatingBackend with egress.py stashed to HEAD (captured); GREEN =
  35 passed (30 validators + 5 transport); full suite `--cov=app --cov-fail-under=40` → 466 passed,
  egress.py 92%, total 79.87%.
- Deviations: none beyond the Step-3 DEV-1/DEV-2 that shaped the `_auto` patch seam (tests match spec seam).
