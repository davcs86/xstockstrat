# Recon: remove-mcp-sse-transport

**Created**: 2026-07-29
**From**: product-spec.md
**Affected services**: `xstockstrat-agent` (primary); `xstockstrat-ingest`, `xstockstrat-analysis`
(one stale comment phrase each — already pinned at `path:line` by the product spec, no discovery run)

---

## Objective

Delete the legacy HTTP+SSE MCP transport (`GET /sse` + `POST /messages`) from `xstockstrat-agent`,
leaving Streamable HTTP at `/` as the only remote transport and `stdio` untouched for local use. The
motivating defect is an authorization hole: `POST /messages` returns *before* the `_authorized` gate,
so every tool call over SSE is unauthenticated at the transport layer — the reason feature 073 had to
restrict `set_config` to Streamable HTTP. Rename the env vars and factories that name the dead
transport, with compatibility fallbacks so no environment breaks mid-deploy.

---

## Codebase Map

**All transport dispatch lives in one function.** `build_sse_app()` — `app/main.py:51-203` — and the
SSE-specific surface inside it is **five lines**: the import `:59`, the construction `:76`, the
`/messages` branch `:163-165`, and the `/sse` branch `:171-176`.

| Symbol / branch | `app/main.py` | Fate |
|---|---|---|
| Module docstring (names `sse`, `MCP_SSE_PORT`) | `:1-12` | rewrite |
| `MCP_TRANSPORT` constant | `:26` | rewrite (alias) |
| `MCP_SSE_PORT` constant | `:27` | rename → `MCP_HTTP_PORT` + fallback |
| `create_server()`, `_run_stdio()` | `:36-39`, `:42-48` | survive untouched |
| `build_sse_app()` def + docstring | `:51-56` | rename → `build_http_app` |
| `from mcp.server.sse import SseServerTransport` | `:59` | **dies** |
| `sse = SseServerTransport("/messages")` | `:76` | **dies** |
| `list_tools_metadata` | `:78-97` | survives |
| `StreamableHTTPSessionManager(...)` (+ comment `:99-103`) | `:104` | survives; comment rewrite |
| `_authorized(scope)` (+ SSE rationale comment `:126-128`) | `:106-133` | **survives**; comment rewrite |
| `_send_unauthorized(scope, receive, send)` | `:135-147` | survives — **the 404 template** |
| `handle_mcp(...)` + docstring | `:149-178` | survives, reshaped |
| `path == "/messages"` branch | `:163-165` | **dies** → 404 |
| `path == "/sse"` branch | `:171-176` | **dies** → 404 |
| `await session_manager.handle_request(...)` | `:178` | survives |
| `lifespan`; `routes` incl. `Mount("/", app=handle_mcp)` `:201` | `:180-184`, `:186-203` | survive unchanged |
| `_run_sse()` (log `:210`, port `:211`) | `:206-213` | rename → `_run_http` |
| `__main__`, `if MCP_TRANSPORT == "sse":` | `:216-227` (dispatch `:224-227`) | rewrite for the alias |

**Tests** — both suites build the app through a module-local `_app()` helper doing a deferred import,
and drive it with Starlette `TestClient` **as a context manager** (required — `lifespan` must run for
`session_manager`):

- `tests/test_oauth.py` — `_app()` `:16-19`; `TestClient` `:11`; section header `:45`.
  `test_sse_unauthenticated_401_with_www_authenticate` `:48-52` → **rewrite as a 404 case**.
  `test_sse_accepts_valid_credential_reaching_transport` `:55-78` → **delete**: it patches
  `mcp.server.sse.SseServerTransport.connect_sse` (`:73`), a target that ceases to exist.
  The two `test_streamable_root_*` cases `:84-118` survive. All other cases need only the `_app()`
  rename (`:25,34,124,142,149,162,179,204,221,239`).
- `tests/test_tools_endpoint.py` — `_app()` `:11-14`; tests `:17,44,58` all survive; `/sse` appears
  only in docstrings `:3,59`.
- `tests/conftest.py` — `_setup_gen_path()` `:10-28`; **autouse** `set_env` fixture `:31-47`, which
  sets `MCP_TRANSPORT=stdio` at `:37` and at `:40-47` documents the module-level-constant workaround.
- `tests/test_config_tools.py:159-175` — `test_refuses_without_verified_claims_ie_on_sse`; behavior
  survives, name + docstring `:161` go stale.

**CI** (`.github/workflows/ci.yml`): changes filter `:55`; `python-lint` `:279`, matrix `:290`, steps
`ruff check .` `:307`, `ruff format --check .` `:310`, `uv lock --check` `:317`; `python-test` `:326`,
matrix `:343-345` (`coverage_threshold: 40`, `cov_source: app`), run `:369-372`
`uv run --no-sync pytest --cov=app … --cov-fail-under=40`.

---

## Patterns to REUSE

- **The 404 branch** → copy `_send_unauthorized` (`app/main.py:135-147`) exactly: build a Starlette
  `Response(...)` and `await response(scope, receive, send)`. `Response` is already imported at
  `:62`. This is the **only** raw-ASGI response precedent in the file — `list_tools_metadata`
  returns a `JSONResponse` but from a normal `Route` endpoint, not raw ASGI.
- **Module-level-constant testing** → `tests/conftest.py:40-47` already documents the workaround
  (`monkeypatch.setattr(<module>, <CONST>, …)` rather than `setenv`). Any new env-resolution test
  must follow it or remove the need for it (see Risk 1).
- **Docs surface enumeration for an agent change** → `docs/roadmap/ledger/insights.md` 2026-07-20
  (feature 066): an MCP agent change has ~five discovery surfaces, and the one most often missed is
  the *task-oriented operational runbook*. Here that is `docs/runbooks/mcp-tools.md` (both § Transport
  Modes **and** § Authentication) plus `claude_mcp_config.json`.
- **Red-before-green in the shipping suite** → `fails.md` 2026-07-29 (074): confirm the new cases
  actually execute and go red first. Directly applicable — this feature's headline assertions are
  "these routes now 404", which pass trivially against a wrongly-built app.

---

## Dependencies

- **Proto/RPC: none.** No `packages/proto/agent/` exists; the agent has no proto contract.
- **Migrations: none.** No `services/xstockstrat-agent/migrations/` — the agent owns no schema.
- **Config keys: none.** The agent reads config one-shot via `client.get_config_value`, not a
  `WatchConfig` stream; no key is affected. `MCP_TRANSPORT` is an env var, not a config key.
- **Env vars — one genuinely NEW:** `MCP_HTTP_PORT` is **absent** from `docker-compose.yml`,
  `.do/app.yaml` and `.do/app.dev.yaml` (grep found it only in this feature's own spec). It must be
  **added**, not merely renamed. Current: `docker-compose.yml:520-521`, `.do/app.yaml:275-278`,
  `.do/app.dev.yaml:275-278`.
- **Unchanged despite touching the port:** `Dockerfile:18` `EXPOSE 9000`, `:21` CMD;
  `docker-compose.yml:525-526` `"9000:9000"`; healthcheck `:529` TCP 9000 — the port *value* stays
  9000, only the var *name* changes.
- **Dependency manifest: no change.** `sse-starlette` (`uv.lock:990`) and `httpx-sse` (`:385`) are
  transitive deps of the `mcp` package, not direct — nothing to remove from `pyproject.toml`.

---

## Risks / Not-found

1. **Every `os.environ` read in `app/` is module-level, at import time** — `main.py:26,27,29,33`,
   plus `oauth_metadata.py:16`, `oauth_server.py:30-32`, `auth.py:17-19`, `client.py:15-21`,
   `telemetry.py:19,30-33`. The only exceptions are `tools.py:653,655`. **Consequence:
   `monkeypatch.setenv` alone cannot exercise the `sse`→`http` alias or the
   `MCP_HTTP_PORT`→`MCP_SSE_PORT` fallback** — the constants are already bound. AC-4 and AC-9 both
   depend on testing exactly those. Either the test reloads the module (`importlib.reload`, heavy —
   re-imports FastMCP and re-registers every tool) or the resolution is extracted into a callable the
   test can drive directly. **This is the one real design decision in the feature** and it is the
   grilling round's job.
2. **The headline assertions pass trivially against a broken app.** "`GET /sse` returns 404" is also
   what a misconfigured or half-built app returns. Per `fails.md` 2026-07-29, the paired test must
   show red first and must positively assert the *body* (the replacement-URL text), not just the
   status code — otherwise it proves nothing about the branch existing.
3. **`_authorized` survives, and so does its SSE rationale comment** (`main.py:126-128`). A diff that
   deletes routes walks straight past it — the product spec added it to FR-3 for this reason.
4. **`test_sse_accepts_valid_credential_reaching_transport` cannot be rewritten, only deleted** — its
   whole mechanism is patching a class that will no longer be imported.
5. **Deleting a test reduces the coverage numerator** against a `--cov-fail-under=40` gate. Two SSE
   cases go away and one 404 case arrives; the net is almost certainly fine (the deleted code goes
   too), but it is a real gate and should be verified by running the suite, not reasoned about.
6. **`context-constitution-findings.md:18` cites `app/main.py:25`, off by one** — the actual
   `MCP_TRANSPORT` read is `:26`. Pre-existing drift, corrected while that line is being rewritten.
7. **Not found:** any existing 404 branch in `app/main.py` to copy verbatim (only the 401 precedent);
   any `/sse` string in `xstockstrat-ui` source; any module in `app/` importing `app.main` (so
   dropping `mcp.server.sse` has **zero** blast radius outside `main.py` + tests); any
   `cov-fail-under` in `pyproject.toml` (the threshold is passed on the CI command line only).
8. **Not a risk, confirmed:** `app/oauth_metadata.py:20` mentions `/sse` in a **docstring only**.
   Both payloads (`:21-26`, `:30-41`) carry `AGENT_PUBLIC_URL` and the `/oauth/*` endpoints — no
   `/sse` anywhere. So the RFC 8414/9728 discovery contract is **unchanged**; this is a docstring
   edit, not a client-visible break.

---

## Recommended Scope

1. **`service`** — `app/main.py`: delete the SSE import/construction/branches, add the FR-1a 404
   branch before `_authorized`, resolve the env-var alias + port fallback (per the design decision in
   Risk 1), rename `build_sse_app`/`_run_sse`, rewrite the module docstring and the three surviving
   SSE comments (`:99-103`, `:126-128`, `handle_mcp`'s docstring).
2. **`test`** — `tests/test_oauth.py` (rewrite one case as 404, delete one, rename `_app`),
   `tests/test_tools_endpoint.py` (rename + docstrings), new cases for the transport alias and the
   port fallback, `tests/test_config_tools.py` (docstrings only — assertions untouched, per AC-6).
3. **`service`** — the remaining agent code surfaces: `app/tools.py:21,47-51,731,748`,
   `app/scopes.py:17`, `app/auth.py:2`, `app/oauth_metadata.py:20`.
4. **`service`** — `claude_mcp_config.json`: replace both `/sse` blocks with one Streamable HTTP
   block at the bare `<AGENT_PUBLIC_URL>` (client-visible — FR-6).
5. **`config`** — `docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml`: `MCP_TRANSPORT: http`,
   add `MCP_HTTP_PORT`.
6. **`docs`** — the FR-4 list, re-verified by re-running FR-4's grep (AC-5 is the gate); plus the two
   comment-only edits in ingest/analysis `servicer.py`.
