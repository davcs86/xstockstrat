# Design: mcp-config-management

**Created**: 2026-07-29
**Rounds**: 1 (quick; termination: approved with open risks accepted)
**Approved by**: orchestrator @ 2026-07-29 — see "Approval note"
**Grounded in**: recon.md

---

## Approval note

Run non-interactively with an instruction to implement. The two decisions that genuinely needed the
user were put to them and answered: **secrets** (`set_config` rejects `is_secret` keys; credentials
use the `type: SECRET` env-var mechanism) and **transport** (Streamable HTTP only), the latter
re-affirmed after I corrected a false premise I had given them. The scope architecture was
separately confirmed by the user: `environment`/`trading_mode` are env-var deployment properties,
config values are partitioned per environment.

One adversarial round ran (the constitution's `quick` mode) and produced 14 objections; the
substantive ones are resolved below rather than deferred.

---

## Chosen Approach

### 1. Claims reach the tool through the ASGI scope — not a second validation

**Adopting the adversary's alternative A.** `_authorized(scope)` (`app/main.py:105-114`) already
holds the token and, after this change, the claims. It writes them into the ASGI scope:

```python
scope.setdefault("state", {})["mcp_claims"] = claims   # dict | None
```

`handle_mcp` passes that *same* `scope` dict to `session_manager.handle_request` (`main.py:159`),
and `streamable_http.py:380` builds its `Request` from it — so a tool reading
`ctx.request_context.request.scope.get("state", {}).get("mcp_claims")` gets the verified claims of
the very request it is serving.

This was chosen over "the tool re-validates the bearer token itself" for four reasons, each of which
was a live defect in that alternative:

- **The transport gate becomes correct by construction.** `/messages` returns at `main.py:144-146`
  **before** `_authorized` ever runs, so `mcp_claims` is *never* present on an SSE request. No
  path-sniffing, no header heuristics. This matters: the adversary showed the obvious check —
  "is there a Starlette `Request` with an acceptable `Authorization` header" — is **true on both
  transports** (`sse.py:203` and `streamable_http.py:380` both build one, and a spec-conformant
  client attaches the header to `POST /messages` too). That check would have silently *accepted*
  SSE, and AC-10 would have gone green only because the test omitted the header.
- **No second Identity round-trip.** Re-validating in the tool would call `ValidateToken` twice per
  write.
- **`validate_bearer_jwt` and `tests/test_auth.py` stay untouched.** The alternative's claim that
  they would is false — `tests/test_auth.py:25,28,40,43` patch `app.auth.grpc…` and
  `app.auth.identity_pb2_grpc.IdentityServiceStub`; delegating `validate_bearer_jwt` to
  `client.validate_token` would construct the stub in `app.client`, those patches would intercept
  nothing, and the tests would dial a real channel.
- **No 401→500 regression.** `app/auth.py:44-49` never raises; `client.validate_token`
  (`app/client.py:590-608`) does. Routing `_authorized` through the latter would turn an
  expired token into a 500 and bypass `_send_unauthorized` (`main.py:116-128`) — the response that
  carries the `WWW-Authenticate` pointer starting the OAuth flow.

`app/auth.py` gains `validate_bearer_claims(token) -> dict | None` **alongside** the existing
`validate_bearer_jwt`, keeping the same never-raises try/except. `_authorized` calls the new one and
stores the result. `validate_bearer_jwt` is left exactly as-is so its tests keep passing.

FR-B13 holds: the dict lives on one request's scope and dies with it. No store, `instance_count > 1`
unaffected.

### 2. Scope defaults to the agent's own deployment, never to the proto zero-value

Per the user's confirmation, `environment`/`trading_mode` are deployment properties. All three tools
resolve: **explicit parameter → the agent's `APPLICATION_ENV` / `TRADING_MODE` → those env vars'
own defaults**. They never fall through to the proto zero-value, because that would make a
production agent write a `dev` row when the caller omits the argument. Feature **078** is what makes
the resulting scope actually take effect server-side.

### 3. `set_config`'s order of operations

1. **Reject `secret.`-prefixed keys** — before any RPC. This is the only prong that works for a key
   that does not yet exist (`SetConfigRequest` has no `is_secret` field; the column defaults
   `FALSE`), so without it `set_config(key='secret.foo', value=<credential>)` would create an
   unflagged plaintext row.
2. **Require claims** from the ASGI scope; absent ⇒ refuse with the transport message.
3. **`ListKeys`** at the *same* scope as the pending write; reject if the target key's `isSecret` is
   true. **Fails closed** — if `ListKeys` errors, the write is refused, matching
   `hasAdminAccessScope`'s posture. `ListKeys` is used rather than `GetConfig` deliberately:
   `getConfig` serves the in-memory `snapshots` map refreshed only on `pg_notify`, so it can report
   a stale flag; `listKeys` queries the DB live.
4. **Derive the scope bitmask** from the claims' roles.
5. **Call `SetConfig`** with `[*_metadata(), ("x-access-scope", str(scope))]`.

### 4. Role→scope port

`app/scopes.py` with a module-private bitmap and one public `roles_to_access_scope(roles) -> int`,
mirroring `services/xstockstrat-ui/src/lib/auth.ts:65-76`. Only the function is exported —
exporting `READ/WRITE/ADMIN/TRADING` when nothing consumes them is speculative surface. A comment
ties the admin value `15` to `auth.ts:73` and notes `_admin_metadata()`'s legacy `"7"` so the two
"admin" numbers in one codebase are explained rather than looking like a bug.

### 5. `x-user-id` is NOT forwarded

FR-5 requires forwarding the derived `x-access-scope`. `author` is a required tool parameter and
`request.author` **wins** server-side (`configServiceImpl.ts:283`), so `x-user-id` would be provably
dead metadata. Omitting it keeps the AGENT-4 amendment as narrow as the feature actually needs.

### 6. `value_type` is an explicit `Literal`, and its limit is documented

`Literal["string","int","float","bool"]` so the enum lands in the `inputSchema` served by
`GET /api/tools`. `json` is not offered — `buildConfigValue` has no `'json'` case, so a `json` write
reads back as a string (Known Constraint 2). The docstring tells callers to pass JSON **as a
string**, which is byte-identical to what the server stores anyway, so
`analysis.signals.source_weights` stays writable.

The docstring must also state that **`value_type` is honored only when creating a new key**:
`setConfig`'s `ON CONFLICT … DO UPDATE SET` updates `value_data`/`updated_by`/`update_reason`/
`updated_at` but **not** `value_type`, so for an existing key the stored type wins.

### 7. Error mapping (AGENT-5)

Every tool wraps `except grpc.aio.AioRpcError` → `_grpc_error_message(...)` → `RuntimeError`.
`PERMISSION_DENIED` is already mapped (`app/tools.py:44-45`), which is what AC-7 depends on
rendering cleanly.

---

## Rejected Alternatives

- **Tool re-validates the bearer token itself** — rejected: the transport gate would false-accept on
  SSE, it costs a second Identity round-trip, and it breaks `tests/test_auth.py` and the 401 path
  (see §1).
- **Gate the transport by inspecting `ctx.request_context.request`'s type or headers** — rejected as
  *incorrect*, not merely inferior: both transports build a Starlette `Request`.
- **Invent a `contextvar` in `handle_mcp`** — rejected: the SDK already carries the request; a
  contextvar is a second mechanism for the same job.
- **Enforce `is_secret` server-side in `xstockstrat-config` instead of the pre-check** — genuinely
  better on correctness (no TOCTOU, one fewer RPC, protects `grpcurl` and `/config-ui` too), but it
  reopens a service the product spec closed and contradicts FR-7's "verify, don't reimplement".
  Recorded so it can be revisited deliberately.
- **`GetConfig` for prong (a)** — rejected: serves a cache refreshed only on `pg_notify`, so it can
  report a stale `is_secret`.
- **Infer `value_type` from the JSON value** — rejected for new keys (JSON cannot distinguish
  `1` from `1.0` the way the oneof does), though it is the nicer contract for existing keys where
  the parameter is ignored anyway.
- **Forward `x-user-id`** — rejected as dead metadata (§5).

---

## Open Risks

- [ ] **Prong (a) has a residual blind spot.** `ListKeys` filters by scope, so a key flagged
  `is_secret` only in a *different* scope than the write is invisible to it; prong (b) backstops
  only prefixed names. Narrowed by feature 078 (the scope now actually threads through) but not
  eliminated. State it in the tool description.
- [ ] **TOCTOU between the `ListKeys` check and the `SetConfig` write** — accepted. The flag can
  only change out-of-band, and the window is one RPC.
- [ ] **The claims→scope seam is new and undocumented.** `tools.py` will read a scope key owned by
  `main.py`. Needs its own invariant line in the agent's context-constitution, or it will look like
  incidental coupling.
- [ ] **`Mount("/")` scope identity is assumed.** `handle_mcp` mutates and forwards the same local
  `scope` dict, so this is provable in-function — but it is an assumption about Starlette that a
  test must pin, not prose.
- [ ] **No in-repo test drives a real MCP transport.** `tests/test_tools.py` calls tool functions
  directly, so a mocked ctx proves the tool's branch, not that the SDK delivers the request. The
  test step must at minimum assert `context_kwarg == 'ctx'` (proving `find_context_parameter` wired
  it) and record the residual gap — this is the exact shape of the three defects already found this
  session.

---

## Constitution Rules Touched

- **C-01** — every step cites `path:line` from recon or from execution.
- **C-03** — the agent forwards `x-access-scope` on this one call; `x-trace-id` remains unforwarded
  platform-wide by the agent, and `x-user-id` is deliberately omitted (§5). The AGENT-3/AGENT-4
  amendment must say exactly this.
- **C-04 (spirit)** — `value_type` is a closed set, declared as `Literal`.
- **C-08 / P-06** — each `service` step is paired with a `test` step; red-before-green required.
- **C-10** — FR-6's six surfaces **plus** the two prose surfaces the adversary caught: invariant
  **AGENT-3** (`docs/context-constitution.md:17`, which asserts admin scope is injected on *all*
  management RPCs) and the agent `CLAUDE.md` § management-tool-authorization paragraph. Updating
  only AGENT-4 would leave both half-true.
- **C-11** — story → review → design → spec → execute, in order.
- **F-04** — nothing invented; the SDK claims were verified against the installed package.
- **F-07** — no hardcoded config values.
- **F-11** — no Floor breach raised.
