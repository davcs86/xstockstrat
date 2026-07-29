# Implementation Spec: remove-mcp-sse-transport

**Status**: `complete`
**Created**: 2026-07-29
**Feature**: `docs/roadmap/features/079-remove-mcp-sse-transport/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/remove-mcp-sse-transport`

---

## Execution Summary

Two red-green cycles land the code, in the order `design.md` §5 fixed. **Cycle A** (Steps 1–2)
converts `MCP_TRANSPORT` / `MCP_SSE_PORT` from import-time module constants into call-time resolvers
and extracts `main()` out of `if __name__ == "__main__":` — without this, neither AC-4 nor AC-9 is
testable at all (recon Risk 1, `app/main.py:26-27,216-227`). **Cycle B** (Steps 3–4) deletes the SSE
transport, installs the FR-1a 404 branch ahead of the auth gate, renames `build_sse_app`/`_run_sse`,
and rewrites every stale in-code SSE rationale. Steps 5–7 close the remaining behavior-adjacent
surfaces (the operator client config, the three deployment specs, the two comment-only servicer
edits). Step 8 is the documentation sweep and the AC-5 two-tier grep reconciliation that gates FR-4.

Cycle A must precede Cycle B because Step 3 rewires `_run_sse`→`_run_http` around the port resolver
Step 1 introduces; doing them together would put two unrelated reds in one commit.

## Step Dependencies

- **Step 2 [test] covers Step 1 [service]** (C-08). Per `tdd-gate.md`, Step 2's `main()`-dispatch case
  is authored and run **before** Step 1's implementation, and it fails behaviorally against today's
  tree (the dispatch lives in an unreachable `__main__` block — `app/main.py:224-227`).
- **Step 3 requires Step 1**: Step 3 renames `_run_sse`→`_run_http`, whose body Step 1 has already
  rewired to `resolve_http_port()`. Renaming first would collide with Step 1's edit to the same lines.
- **Step 4 [test] covers Step 3 [service]** (C-08). Step 4's `test_sse_path_404_names_replacement_url`
  is authored and run **first**, against the current `build_sse_app`, where it fails `401 != 404` — a
  genuine behavioral red, not an import error (`tdd-gate.md:22-25`).
- **Step 3 carries the minimum test adaptation its own change breaks** (ledger `insights.md`
  2026-07-27, feature 072): the `_app()` factory rename in both test modules, the deletion of
  `test_sse_accepts_valid_credential_reaching_transport`, and the 401→404 rewrite. Everything else in
  the test modules is Step 4. This keeps every commit green (**F-05**) without merging the pair.
- **Step 5 [service] adds no executable logic** — `claude_mcp_config.json` is an operator-facing JSON
  document that no module reads (confirmed: the only in-repo references are
  `docs/runbooks/mcp-tools.md:3` and SDD artifacts). Its C-08 pairing is satisfied by Step 4's full
  agent-suite run; no separate `test` step is added because there is nothing executable to cover.
- **Step 6 requires Step 1**: `MCP_HTTP_PORT` must be honored by the code before a deployment file
  ships it. The FR-2 fallback means the reverse order would still work, but AC-8's whole point is that
  the code leads and the YAML follows.
- **Step 7 [service] is comment-only in two services.** Per `tdd-gate.md:41-44` it declares a
  characterization green ("red N/A — no behavior change"); its own `**Verification**` runs both
  services' full suites at the CI coverage threshold plus lint, which is what C-08's pairing exists to
  guarantee. No separate `test` step is added.
- **Step 8 requires Steps 1–7**: AC-5's tier-1 grep can only reach zero once every code and config
  surface has landed, and tier-2's survivor enumeration is only meaningful against the final tree.

---

### Step 1 — service: replace the import-time transport/port constants with call-time resolvers and extract `main()`

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/main.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — `MCP_TRANSPORT` handling, transport dispatch
correctness

**Codebase Evidence**:
- `app/main.py:26` → `MCP_TRANSPORT = os.environ.get("MCP_TRANSPORT", "stdio")` — bound at import
- `app/main.py:27` → `MCP_SSE_PORT = int(os.environ.get("MCP_SSE_PORT", "9000"))` — bound at import,
  and `int()` on `""` raises `ValueError` at import time today
- `app/main.py:206-213` → `async def _run_sse()`; `:210` logs `"…(transport=sse, port=%d)", MCP_SSE_PORT`;
  `:211` `uvicorn.Config(starlette_app, host="0.0.0.0", port=MCP_SSE_PORT, loop="asyncio")`
- `app/main.py:216-227` → the `if __name__ == "__main__":` block: `import asyncio` `:217`,
  `from app.telemetry import init_telemetry` `:219`, `init_telemetry()` `:222`, and the dispatch
  `if MCP_TRANSPORT == "sse": asyncio.run(_run_sse()) else: asyncio.run(_run_stdio())` `:224-227`
- No cross-module consumer of either constant: `git ls-files | xargs grep -n "MCP_TRANSPORT\|MCP_SSE_PORT"`
  returns only env-var *names* (deployment files, docs, `tests/conftest.py:37`) — never an imported
  symbol. The only cross-module imports of `app.main` are `build_sse_app` at
  `tests/test_oauth.py:17` and `tests/test_tools_endpoint.py:12`.
- `services/xstockstrat-agent/Dockerfile:21` → `CMD ["python", "-m", "app.main"]` — the `__main__`
  entry must keep working after the extraction
- `tests/conftest.py:31-47` → **autouse** `set_env` fixture; `:37` sets `MCP_TRANSPORT=stdio`, and
  `:40-47` documents the module-level-constant workaround this step is removing the need for

**TDD**: `red-green required` — paired with Step 2. Author Step 2's `main()`-dispatch case first and
capture its red **before** editing `app/main.py`.

**Instructions**:

1. Move `import asyncio` from inside the `__main__` block (`app/main.py:217`) to the module-level
   import group alongside `import logging` / `import os` (`:14-15`), so `main()` can call
   `asyncio.run` and a test can reach it as `app.main.asyncio`.
2. Delete the two module constants at `app/main.py:26-27`. Leave `UI_BASE_URL` (`:29`) and
   `AGENT_PUBLIC_URL` (`:33`) exactly as they are — they are unrelated to this feature and
   `AGENT_PUBLIC_URL` is read by `_send_unauthorized` at `:143`.
3. Add the two resolvers immediately after the remaining constants, verbatim from `design.md` §1:

   ```python
   def resolve_transport() -> str:
       """Canonical MCP_TRANSPORT. `sse` is a deprecated alias for `http` (FR-2)."""
       raw = os.environ.get("MCP_TRANSPORT", "stdio")
       if raw == "sse":
           log.warning("MCP_TRANSPORT=sse is deprecated and now selects the Streamable HTTP "
                       "transport; set MCP_TRANSPORT=http")
           return "http"
       if raw not in ("stdio", "http"):
           log.warning("MCP_TRANSPORT=%r is not recognized; falling back to stdio", raw)
       return raw


   def resolve_http_port() -> int:
       """Port for the HTTP server. MCP_SSE_PORT is the deprecated fallback (FR-2)."""
       deprecated = os.environ.get("MCP_SSE_PORT")     # deprecated alias, feature 079
       return int(os.environ.get("MCP_HTTP_PORT") or deprecated or "9000")
   ```

   The `or`-chain deliberately changes empty-string behavior: `MCP_SSE_PORT=""` currently raises
   `ValueError` at import; it now yields `9000`. This is declared in `design.md` §1 and pinned by a
   Step 2 case — do not "fix" it back.
   The unrecognized-value branch **warns only**; it must not change the fallthrough-to-stdio
   behavior AC-4 mandates.
4. Rewire `_run_sse`'s body (`app/main.py:210-211`) to call `resolve_http_port()` once and use that
   local for both the log line and `uvicorn.Config(..., port=…)`. **Do not rename `_run_sse` or
   `build_sse_app` in this step** — that rename is Step 3, and splitting it keeps this commit to the
   env-resolution change.
5. Replace the `if __name__ == "__main__":` block (`app/main.py:216-227`) with the extracted `main()`,
   verbatim from `design.md` §2:

   ```python
   def main() -> None:
       from app.telemetry import init_telemetry
       init_telemetry()            # non-fatal: no-ops unless OTEL_ENABLED=true
       asyncio.run(_run_http() if resolve_transport() == "http" else _run_stdio())


   if __name__ == "__main__":
       main()
   ```

   In **this** step the runner is still named `_run_sse`, so write `_run_sse()` there; Step 3 renames
   it together with its definition. Keep `init_telemetry` as a function-local import — it preserves
   the existing non-fatal-telemetry ordering at `:219-222` and keeps module import light.

**Verification**:

```bash
cd services/xstockstrat-agent && uv sync --extra dev \
  && uv run pytest --cov=app --cov-report=term-missing --cov-fail-under=40 \
  && ruff check . && ruff format --check . \
  && grep -n "resolve_transport\|resolve_http_port\|^def main" app/main.py \
  && ! grep -nE '^MCP_TRANSPORT = |^MCP_SSE_PORT = ' app/main.py
```

Expect: suite green at ≥40%, ruff clean, both resolvers plus `def main()` present, and neither
module constant remaining. Step 2's `main()`-dispatch case must have been captured red before this
run.

---

### Step 2 — test: transport-alias and port-fallback resolution, plus the `main()` dispatch

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_transport_config.py` — create

**Reviewers**: `xstockstrat-agent` (service owner) — `MCP_TRANSPORT` handling; Security — AC-4 is the
assertion that a deprecated env value still starts the *authenticated* transport

**Codebase Evidence**:
- **Not found** — `services/xstockstrat-agent/tests/` contains `conftest.py`, `test_auth.py`,
  `test_backtest_view.py`, `test_client.py`, `test_config_tools.py`, `test_oauth.py`, `test_tools.py`,
  `test_tools_endpoint.py`. There is no existing transport/env-resolution test module; this file is
  created from scratch.
- `tests/conftest.py:31-32` → `@pytest.fixture(autouse=True)` / `def set_env(monkeypatch):`, and
  `:37` → `monkeypatch.setenv("MCP_TRANSPORT", "stdio")`. **This is why every "unset" case must use
  `monkeypatch.delenv(..., raising=False)`** — a `setenv`-written unset case would silently assert
  `stdio → stdio` and pass for the wrong reason (`design.md` §5, adversary objection 5).
- `services/xstockstrat-agent/pyproject.toml` → `[tool.pytest.ini_options]` `asyncio_mode = "auto"`,
  `testpaths = ["tests"]`
- `app/main.py:24` → `log = logging.getLogger(__name__)` — the logger the deprecation warnings go to,
  so `caplog` observes them under the `app.main` logger name

**TDD**: `red-green required` — this is the red half of Step 1's cycle. Authored and run **before**
Step 1's implementation.

**Instructions**:

1. Create `tests/test_transport_config.py`. **Import the module, not the symbols**
   (`import app.main as main_mod`) and reference `main_mod.resolve_transport` / `main_mod.main`
   *inside* test bodies. This is load-bearing: a module-level `from app.main import resolve_transport`
   would break collection of the whole file with an `ImportError`, which `tdd-gate.md:22-25` rejects
   as a valid red. Referencing the attribute inside a body makes each case fail individually, for the
   right reason — the behavior is missing.
2. Write the **`main()` dispatch case first** and capture its red before anything else
   (`design.md` §5, Cycle A):
   - `monkeypatch.setenv("MCP_TRANSPORT", "sse")`
   - neutralize telemetry: `monkeypatch.setattr("app.telemetry.init_telemetry", lambda: None)`
   - replace both runners with plain markers:
     `monkeypatch.setattr(main_mod, "_run_http", lambda: "http")` and
     `monkeypatch.setattr(main_mod, "_run_stdio", lambda: "stdio")`
     (in the pre-Step-3 tree the HTTP runner is still `_run_sse` — patch whichever name exists at the
     moment the red is captured, and settle on `_run_http` once Step 3 lands)
   - capture the dispatch: `monkeypatch.setattr(main_mod.asyncio, "run", recorded.append)`
   - call `main_mod.main()` and assert the recorded value is the HTTP marker.
   Against today's tree this fails because the string→server dispatch lives in
   `app/main.py:224-227`, inside a `__main__` block pytest never executes.
3. Add the eight resolver cases from `design.md` §5, all driving `main_mod.resolve_transport()` /
   `main_mod.resolve_http_port()` directly:

   | Env | Expected | Extra assertion |
   |---|---|---|
   | `MCP_TRANSPORT=http` | `"http"` | **zero** `WARNING` records in `caplog` |
   | `MCP_TRANSPORT=sse` | `"http"` | one `WARNING` naming the deprecation |
   | `MCP_TRANSPORT` **deleted** (`delenv`) | `"stdio"` | — |
   | `MCP_TRANSPORT=banana` | `"banana"` | one `WARNING` (unrecognized value) |
   | `MCP_HTTP_PORT=9111` | `9111` | — |
   | `MCP_SSE_PORT=9222` only (`MCP_HTTP_PORT` deleted) | `9222` | — |
   | both deleted | `9000` | — |
   | `MCP_HTTP_PORT=""` + `MCP_SSE_PORT=9222` | `9222` | pins the deliberate empty-string change |

   Use `caplog.at_level(logging.WARNING, logger="app.main")` for the warning assertions; assert on
   the record count and on a distinguishing substring, not on the full message text.
4. Do **not** add an `importlib.reload(app.main)` helper — explicitly rejected in `design.md`
   § Rejected Alternatives (it re-registers all seventeen tools per test and rebinds the `app.client`
   constants `tests/conftest.py:44-47` monkeypatches, silently defeating the autouse fixture).

**Verification**:

```bash
cd services/xstockstrat-agent \
  && uv run pytest tests/test_transport_config.py -v \
  && uv run pytest --cov=app --cov-report=term-missing --cov-fail-under=40 \
  && ruff check . && ruff format --check .
```

Expect: all nine cases pass, full suite green at ≥40%, ruff clean. The red capture for the
`main()`-dispatch case (taken before Step 1) goes in the PR body and `context.md` per
`tdd-gate.md:30-34`.

---

### Step 3 — service: delete the SSE transport, add the FR-1a 404 branch, rename the factories, rewrite the stale rationale

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/main.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/scopes.py` — modify
- `services/xstockstrat-agent/app/auth.py` — modify
- `services/xstockstrat-agent/app/oauth_metadata.py` — modify
- `services/xstockstrat-agent/tests/test_oauth.py` — modify (**minimum adaptation only** — see
  Instructions step 9; the rest is Step 4)
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify (**`_app()` rename only**)

**Reviewers**: `xstockstrat-agent` (service owner) — transport removal, MCP client compatibility;
Security — this step closes the unauthenticated tool-call channel and moves a 404 in front of the
auth gate

**Codebase Evidence**:
- `app/main.py:59` → `from mcp.server.sse import SseServerTransport` (inside `build_sse_app`)
- `app/main.py:76` → `sse = SseServerTransport("/messages")`
- `app/main.py:161` → `path = (scope.get("path") or "/").rstrip("/") or "/"`
- `app/main.py:163-165` → `if path == "/messages": await sse.handle_post_message(...); return` —
  **already the first statement after normalization and already before the gate**, so the 404 branch
  replaces it in place with no restructuring
- `app/main.py:167-169` → `if not await _authorized(scope): await _send_unauthorized(...); return`
- `app/main.py:171-176` → `if path == "/sse": async with sse.connect_sse(...) …; return`
- `app/main.py:135-147` → `_send_unauthorized`, the **only** raw-ASGI response precedent in the file:
  builds a `Response(...)` and `await response(scope, receive, send)`; interpolates `AGENT_PUBLIC_URL`
  at `:143`
- `app/main.py:62` → `from starlette.responses import JSONResponse, Response` — `Response` already
  imported inside the factory
- `app/main.py:201` → `Mount("/", app=handle_mcp)` — the root catch-all that makes the explicit 404
  branch necessary (FR-1a) and makes prefix matching unacceptable
- Stale rationale comments that **survive** the route deletion and must be rewritten:
  `app/main.py:1-12` (module docstring, names `sse` and `MCP_SSE_PORT` at `:6`, "SSE transport
  requires…" at `:8`); `:99-103` (the `StreamableHTTPSessionManager` comment, `:103` "The legacy /sse
  + /messages paths are kept for Claude Desktop"); **`:125-128`** (inside `_authorized` — recon
  Risk 3, pinned by name in FR-3); `:150-159` (`handle_mcp`'s docstring, `:152,:153,:157,:158`)
- `app/main.py:51` → `def build_sse_app():` and `:52` its docstring; `:206` → `async def _run_sse()`;
  `:209` → `starlette_app = build_sse_app()`; and after Step 1 the `main()` body calls the runner
- `app/tools.py:47-51` → `_claims_from_context` docstring, "precisely the case on the legacy SSE
  transport, whose `POST /messages` returns before `_authorized` ever runs"
- `app/tools.py:731` → tool docstring, "Only available over the Streamable HTTP transport, because
  that is the only one whose"
- `app/tools.py:746-749` → the `RuntimeError` message; `:748` → `"tool call itself is authenticated.
  The legacy SSE transport does not "`
- `tests/test_config_tools.py:167` → `with pytest.raises(RuntimeError, match="Streamable HTTP"):` —
  **the rewritten error string must retain the literal substring `Streamable HTTP`**; AC-6 forbids
  changing that test body (`design.md` §5, correction 2)
- `app/scopes.py:17` → `#: passes `_authorized` -- i.e. Streamable HTTP, never the legacy SSE `POST /messages`.`
- `app/auth.py:2` → `SSE/Streamable-HTTP endpoint authentication for xstockstrat-agent.`
- `app/oauth_metadata.py:20` → `"""RFC 9728 — the protected resource (the agent /sse endpoint) and its auth server."""`
  — **docstring only**; both payloads (`:21-26`, `:30-41`) carry `AGENT_PUBLIC_URL` and the
  `/oauth/*` endpoints, so the RFC 8414/9728 contract does not change (recon Risk 8)
- `tests/test_oauth.py:16-19` → `_app()` doing `from app.main import build_sse_app` and returning
  `build_sse_app()`; `tests/test_tools_endpoint.py:11-14` → identical shape
- `tests/test_oauth.py:55-78` → `test_sse_accepts_valid_credential_reaching_transport`, which patches
  `mcp.server.sse.SseServerTransport.connect_sse` at `:73` — a target that ceases to exist, so this
  case can only be **deleted**, not rewritten (recon Risk 4)

**TDD**: `red-green required` — paired with Step 4. Author Step 4's
`test_sse_path_404_names_replacement_url` first, against the current `build_sse_app`, and capture the
`401 != 404` red **before** editing `app/main.py`.

**Instructions**:

1. Delete `app/main.py:59` (`from mcp.server.sse import SseServerTransport`) and `:76`
   (`sse = SseServerTransport("/messages")`).
2. Add the named path tuple at module level (outside the factory), per `design.md` §3:
   ```python
   # Legacy HTTP+SSE transport paths, removed by feature 079.
   REMOVED_TRANSPORT_PATHS = ("/sse", "/messages")
   ```
3. Add `_send_transport_removed` alongside `_send_unauthorized` (after `app/main.py:147`), copying
   that function's raw-ASGI shape verbatim:
   ```python
   async def _send_transport_removed(scope, receive, send) -> None:
       # 404 BEFORE the auth gate (FR-1a): a stale client gets an immediate, unambiguous
       # answer naming the URL to switch to, instead of a 401 that starts a pointless OAuth
       # flow. Leaks nothing -- AGENT_PUBLIC_URL is already served unauthenticated at the
       # 401 branch above and by the .well-known discovery routes.
       response = Response(
           f"This MCP transport was removed. Use the Streamable HTTP endpoint at {AGENT_PUBLIC_URL}",
           status_code=404,
           media_type="text/plain",
       )
       await response(scope, receive, send)
   ```
   Read `AGENT_PUBLIC_URL` as the module global from inside the function body — exactly as
   `_send_unauthorized` does at `:143` — so `monkeypatch.setattr(app.main, "AGENT_PUBLIC_URL", …)`
   reaches it. `media_type="text/plain"` is a deliberate departure from `_send_unauthorized` (which
   sets none): here the body is load-bearing, and a JSON body on the MCP path risks a client parsing
   it as a JSON-RPC envelope.
4. Replace the `/messages` branch at `app/main.py:163-165` **in place** with the exact-match 404:
   ```python
   if path in REMOVED_TRANSPORT_PATHS:
       await _send_transport_removed(scope, receive, send)
       return
   ```
   Keep it immediately after the `path = …rstrip("/")…` normalization at `:161` and immediately
   before the `_authorized` gate at `:167`. **Exact membership, every method — never `startswith`**:
   `Mount("/", app=handle_mcp)` (`:201`) is a root catch-all, so a prefix match would permanently
   reserve `/sse*` and `/messages*` from the Streamable HTTP fall-through at `:178`. The `.rstrip("/")`
   already folds `/messages/` and `//messages//` into the literal, and the legacy `?session_id=…`
   lives in `scope["query_string"]`, not `scope["path"]`.
5. Delete the `/sse` branch at `app/main.py:171-176` entirely. `await session_manager.handle_request(...)`
   at `:178` becomes the sole tail of `handle_mcp`.
6. Rename `build_sse_app` → `build_http_app` (`app/main.py:51`) and `_run_sse` → `_run_http`
   (`:206`), updating the call site at `:209` and the runner reference inside the `main()` Step 1
   added. **No compatibility aliases** (FR-2): these are private in-repo symbols whose only external
   callers are the two test `_app()` factories, updated in this same commit.
7. Rewrite the module docstring (`app/main.py:1-12`) so it describes the surviving transports only:
   `stdio` (default, local) and `http` (Streamable HTTP on `MCP_HTTP_PORT`, default 9000, with
   `MCP_SSE_PORT` named as the deprecated fallback and `MCP_TRANSPORT=sse` as the deprecated alias).
   Keep the OAuth 2.1 `aud`-bound-JWT / 401 sentence — it is still true of the surviving transport.
8. Rewrite the three surviving in-code SSE rationales so they describe a **removed** transport rather
   than an unsupported one:
   - `app/main.py:99-103` — drop `:103`'s "The legacy /sse + /messages paths are kept for Claude
     Desktop (feature 049)"; the Streamable HTTP explanation above it stays.
   - `app/main.py:125-128` — the "correct BY CONSTRUCTION rather than by sniffing" comment inside
     `_authorized`. **This survives the route deletion and is the single easiest line in the feature
     to miss** (recon Risk 3; pinned by name in FR-3 and by AC-5 tier 2). Reword to: the SSE transport
     was removed by feature 079, so every tool call now passes this function; the absence-of-claims
     check in `set_config` is retained as defence in depth. Keep the "checking for a Starlette Request
     or an Authorization header would NOT work" reasoning — it documents why the guard is shaped the
     way it is.
   - `app/main.py:150-159` — `handle_mcp`'s docstring: replace the three-bullet transport list with
     the surviving one (Streamable HTTP at every path except the two removed ones, which 404 before
     the auth gate), and drop the `:157-158` paragraph about advertising `/messages`, which no longer
     applies.
9. **Minimum test adaptation only** (the rest is Step 4) — everything here is required for this
   commit to be green (**F-05**):
   - `tests/test_oauth.py:16-19` and `tests/test_tools_endpoint.py:11-14` — point both `_app()`
     factories at `build_http_app`.
   - `tests/test_oauth.py:55-78` — **delete** `test_sse_accepts_valid_credential_reaching_transport`.
   - `tests/test_oauth.py:48-52` — rewrite `test_sse_unauthenticated_401_with_www_authenticate` as
     `test_sse_path_404_names_replacement_url` (this is Step 4's red case, authored first): assert
     `r.status_code == 404`, that `AGENT_PUBLIC_URL`'s value appears in `r.text`, and — the
     anti-trivial assertion — that `"www-authenticate" not in r.headers`. A 404 alone is also what a
     misconfigured app returns; a fall-through to `_authorized` would carry that header, so its
     absence is what proves the branch exists (recon Risk 2).
   Leave all other cases, docstrings and section headers in those two files to Step 4.
10. Prose-only agent edits, all one phrase each — "the legacy SSE transport" becomes "the SSE
    transport removed by feature 079", keeping each statement's logic intact:
    - `app/tools.py:47-51` — `_claims_from_context`'s docstring.
    - `app/tools.py:731` — the `set_config` tool docstring.
    - `app/tools.py:746-749` — the `RuntimeError` message. **The rewritten string MUST still contain
      the literal substring `Streamable HTTP`**, because `tests/test_config_tools.py:167` matches on
      it and AC-6 forbids changing that assertion.
    - `app/scopes.py:17` — the `MCP_CLAIMS_SCOPE_KEY` comment.
    - `app/auth.py:2` — module docstring, "SSE/Streamable-HTTP endpoint authentication" →
      "Streamable HTTP endpoint authentication".
    - `app/oauth_metadata.py:20` — "the agent /sse endpoint" → "the agent's MCP endpoint". Docstring
      only; do not touch either JSON payload (`:21-26`, `:30-41`).
11. No new outbound gRPC call is introduced by this step, so the header-propagation constraint
    (`step-constraints.md` §B) does not apply — `app/client.py`'s `_metadata()`/`_admin_metadata()`
    paths are untouched.

**Verification**:

```bash
cd services/xstockstrat-agent \
  && uv run pytest --cov=app --cov-report=term-missing --cov-fail-under=40 \
  && ruff check . && ruff format --check . \
  && ! grep -rnE 'build_sse_app|_run_sse|SseServerTransport|mcp\.server\.sse|handle_post_message' app tests \
  && grep -n "REMOVED_TRANSPORT_PATHS\|_send_transport_removed\|build_http_app\|_run_http" app/main.py \
  && grep -n "Streamable HTTP" app/tools.py
```

Expect: suite green at ≥40% (coverage is **measured here, not predicted** — two cases were deleted;
if the threshold trips, that is a deviation to handle in-step per `design.md` § Open Risks), ruff
clean, zero tier-1 symbol hits under `app/` and `tests/`, the new symbols present, and the
`Streamable HTTP` literal still in `app/tools.py`.

---

### Step 4 — test: 404-branch coverage and the transport-removal docstring sweep in the agent suite

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_oauth.py` — modify
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify
- `services/xstockstrat-agent/tests/test_config_tools.py` — modify (**docstrings only**)

**Reviewers**: `xstockstrat-agent` (service owner) — transport-removal coverage; Security — AC-1 and
AC-3 (no path reaches a tool without `_authorized`) are proven here

**Codebase Evidence**:
- `tests/test_oauth.py:11` → `from starlette.testclient import TestClient`; every case drives the app
  **as a context manager** (`with TestClient(_app()) as tc:`) — required, because `lifespan`
  (`app/main.py:180-184`) must run for `session_manager`
- `tests/test_oauth.py:45` → section header `# ── /sse auth boundary (AC-B0, AC-B4, AC-B7) ──`
- `tests/test_oauth.py:1-6` → module docstring, `:3` "/sse 401+WWW-Authenticate", `:4` "against
  build_sse_app()"
- `tests/test_oauth.py:84-89` → `test_streamable_root_unauthenticated_401_with_www_authenticate`
  (`POST /` → 401 + `resource_metadata=`) — the **control** that proves the app is not globally
  404ing; leave it untouched
- `tests/test_oauth.py:92-118` → `test_streamable_root_accepts_valid_credential_reaching_transport` —
  survives untouched; it patches
  `mcp.server.streamable_http_manager.StreamableHTTPSessionManager.handle_request`, which still exists
- `tests/test_tools_endpoint.py:3` → docstring "Unlike /sse and the Streamable HTTP root…";
  `:59` → `"""No Authorization header — unlike /sse, this never 401s."""`; the three cases at
  `:17,44,58` all survive
- `tests/test_config_tools.py:9` → "any check based on those would accept SSE";
  `:160` → `async def test_refuses_without_verified_claims_ie_on_sse(self):`;
  `:161` → `"""The SSE POST /messages never passes _authorized, so no claims are on the scope."""`;
  `:167` → `with pytest.raises(RuntimeError, match="Streamable HTTP"):`
- `app/main.py:33` → `AGENT_PUBLIC_URL = os.environ.get("AGENT_PUBLIC_URL", "http://localhost:9000")`
  — the default the 404 body interpolates under test

**TDD**: `red-green required` — this is the red half of Step 3's cycle.
`test_sse_path_404_names_replacement_url` is authored and run **first**, against the current
`build_sse_app`, where it fails `401 != 404`. That is a behavioral red, not an import error.

**Instructions**:

1. Update `tests/test_oauth.py:45`'s section header to name the removed-transport boundary rather
   than "/sse auth boundary", and update the module docstring (`:1-6`) to say the suite exercises
   discovery metadata, the removed-transport 404s, DCR, authorize validation and the token endpoint
   against `build_http_app()`.
2. Add the two new cases from `design.md` §5 next to the rewritten 404 case Step 3 landed:
   - `test_messages_path_404_even_with_credential` — `POST /messages` **with** an
     `Authorization: Bearer …` header and **no** claims mock → 404. This is what proves the branch
     precedes the auth gate (AC-1's "with or without an Authorization header"), and with AC-3 that
     no `tools/call` can reach a tool through the removed paths.
   - `test_messages_trailing_slash_and_query_404` — `POST /messages/?session_id=abc` → 404, pinning
     the `.rstrip("/")` normalization at `app/main.py:161` and the fact that the query string is not
     part of `scope["path"]`.
   Both must assert the replacement URL appears in the response body, not merely the status code.
3. Leave `test_streamable_root_unauthenticated_401_with_www_authenticate` (`:84-89`) exactly as it
   is — it is the control proving the app still 401s (not 404s) on the surviving transport.
4. `tests/test_tools_endpoint.py` — update the module docstring `:3` and the `:59` docstring so they
   contrast `/api/tools` with the surviving Streamable HTTP root instead of `/sse`. No assertion
   changes; the three cases at `:17,44,58` keep their current bodies.
5. `tests/test_config_tools.py` — **docstrings only** (AC-6). Update `:9` and `:161` to say the SSE
   transport was *removed* by feature 079 and the guard is retained as defence in depth. Rename the
   case at `:160` from `test_refuses_without_verified_claims_ie_on_sse` to
   `test_refuses_without_verified_claims` (the `_ie_on_sse` suffix names a transport that no longer
   exists). **Do not touch any assertion or test body** — in particular `:167`'s
   `match="Streamable HTTP"` must stay verbatim.
6. Do not add a live-socket smoke check anywhere. Explicitly rejected in `design.md` §2 and
   § Rejected Alternatives: it binds a real port, depends on kill timing, and CI runs pytest only
   (`.github/workflows/ci.yml:369-372`).

**Verification**:

```bash
cd services/xstockstrat-agent \
  && uv run pytest tests/test_oauth.py tests/test_tools_endpoint.py tests/test_config_tools.py -v \
  && uv run pytest --cov=app --cov-report=term-missing --cov-fail-under=40 \
  && ruff check . && ruff format --check .
```

Expect: the three 404 cases and the 401 control all pass; the feature-073 `set_config` cases pass
**unchanged in behavior** (AC-6); full suite green at ≥40%; ruff clean.

---

### Step 5 — service: replace both `/sse` blocks in the operator MCP client config

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/claude_mcp_config.json` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — MCP client compatibility; Security — removes the
`?api_key=` query-string credential block that OAuth 2.1 forbids

**Codebase Evidence**:
- `claude_mcp_config.json:20-23` → `"xstockstrat-sse-oauth"` with `"url": "<AGENT_PUBLIC_URL>/sse"`
- `claude_mcp_config.json:24-27` → `"xstockstrat-sse-apikey-deprecated"` with
  `"url": "<AGENT_PUBLIC_URL>/sse?api_key=<your-api-key>"`, already marked DEPRECATED in-file
- `claude_mcp_config.json:5-19` → the `"xstockstrat-stdio"` block (`"MCP_TRANSPORT": "stdio"` at `:11`)
  — **out of scope, leave byte-identical**
- No module reads this file: `git ls-files | xargs grep -ln "claude_mcp_config"` returns only
  `docs/runbooks/mcp-tools.md` and SDD feature artifacts
- `app/main.py:99-103` → the Claude.ai remote connector already speaks Streamable HTTP against the
  connector URL, which is `AGENT_PUBLIC_URL` itself — the bare URL this step writes

**TDD**: `N/A (operator-facing JSON client config — no executable logic; no module reads this file,
confirmed by grep. C-08 pairing is satisfied by Step 4's full agent-suite run; see § Step Dependencies)`

**Instructions**:

1. Delete both `xstockstrat-sse-oauth` (`:20-23`) and `xstockstrat-sse-apikey-deprecated` (`:24-27`).
2. Add a single remote block in their place, keyed `xstockstrat-http-oauth`, with
   `"url": "<AGENT_PUBLIC_URL>"` — the **bare** public URL, no path suffix (FR-6, AC-7).
3. Write its `_mode` string to describe Streamable HTTP remote MCP with OAuth 2.1: the client
   discovers the auth server via `/.well-known`, performs RFC 7591 DCR + PKCE login, and connects
   with an `aud`-bound JWT; no `api_key`. Do not carry over any `?api_key=` guidance — OAuth 2.1
   forbids credentials in query strings.
4. Leave the `xstockstrat-stdio` block, `_comment` (`:2`) and `_usage` (`:3`) unchanged.

**Verification**:

```bash
cd services/xstockstrat-agent \
  && python3 -c "import json;d=json.load(open('claude_mcp_config.json'));s=d['mcpServers'];print(sorted(s));assert not any('/sse' in str(v) for v in s.values());assert s['xstockstrat-http-oauth']['url']=='<AGENT_PUBLIC_URL>';assert 'xstockstrat-stdio' in s" \
  && ! grep -n "sse" claude_mcp_config.json
```

Expect: valid JSON, exactly two server blocks (`xstockstrat-stdio`, `xstockstrat-http-oauth`), no
`/sse` anywhere, and the remote `url` exactly `<AGENT_PUBLIC_URL>` (AC-7).

---

### Step 6 — config: move the three deployment specs to `MCP_TRANSPORT=http` / `MCP_HTTP_PORT`

**Status**: `done`
**Service**: `xstockstrat-agent` (deployment specs)
**Files**:
- `docker-compose.yml` — modify
- `.do/app.dev.yaml` — modify
- `.do/app.yaml` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — env-var naming and deployment parity

**Codebase Evidence**:
- `docker-compose.yml:520` → `      MCP_TRANSPORT: sse` and `:521` → `      MCP_SSE_PORT: "9000"`,
  in the `xstockstrat-agent` `environment:` block
- `.do/app.yaml:275-278` → `      - key: MCP_TRANSPORT` / `        value: sse` /
  `      - key: MCP_SSE_PORT` / `        value: "9000"`
- `.do/app.dev.yaml:275-278` → identical four lines
- `MCP_HTTP_PORT` is **absent from all three files** — this is an addition, not a pure rename
  (recon § Dependencies; `git ls-files | xargs grep -n MCP_HTTP_PORT` hits only this feature's own
  SDD artifacts)
- The port **value** does not change: `services/xstockstrat-agent/Dockerfile:18` `EXPOSE 9000`,
  `docker-compose.yml:525-526` `ports: - "9000:9000"`, `:527-529` the TCP-9000 healthcheck, and
  `.do/app.yaml` `http_port: 9000` all stay as they are
- `docker-compose.yml:519` → `WAIT_FOR: "xstockstrat-config:50060 xstockstrat-identity:50058"` —
  adjacent, unchanged

**TDD**: `N/A (config — deployment specs carry no executable logic; AC-8 is asserted by the FR-2
alias path in Step 2's tests, not by reading YAML)`

**Instructions**:

1. `docker-compose.yml:520-521` → `MCP_TRANSPORT: http` and `MCP_HTTP_PORT: "9000"` (replacing
   `MCP_SSE_PORT`). Keep the surrounding keys and indentation untouched.
2. `.do/app.yaml:275-278` → `value: sse` becomes `value: http`; `- key: MCP_SSE_PORT` becomes
   `- key: MCP_HTTP_PORT`, `value: "9000"` unchanged.
3. `.do/app.dev.yaml:275-278` → the same two edits. Both DO specs carry the identical value here —
   this is not a paper/live-scoped var, so dev and prod must stay in lockstep.
4. **Do not keep `MCP_SSE_PORT` alongside `MCP_HTTP_PORT`** in any of the three files. The fallback
   exists for the un-updated-environment case; shipping both in the very files it is meant to survive
   defeats the point (`design.md` § Rejected Alternatives).
5. Do not touch `EXPOSE`, the published port mapping, the healthcheck, or `http_port` — only the
   variable names and the transport value change.

**Verification**:

```bash
grep -n "MCP_TRANSPORT\|MCP_HTTP_PORT\|MCP_SSE_PORT" docker-compose.yml .do/app.yaml .do/app.dev.yaml
grep -n "9000" services/xstockstrat-agent/Dockerfile
```

Expect: each of the three files shows `MCP_TRANSPORT` = `http` and `MCP_HTTP_PORT` = `9000`, with
**no** `MCP_SSE_PORT` remaining; `Dockerfile:18` still `EXPOSE 9000`.

---

### Step 7 — service: correct the stale "SSE auth layer" phrase in the ingest and analysis servicers

**Status**: `done`
**Service**: `xstockstrat-ingest`, `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` (service owner) — signal-path role-check docstring accuracy;
`xstockstrat-analysis` (service owner) — strategy-path role-check docstring accuracy

**Codebase Evidence**:
- `services/xstockstrat-ingest/app/handlers/servicer.py:124` → `        MCP agent via its SSE auth layer) and do a role check at most — they do not`,
  inside `_has_admin_scope`'s docstring (`:120-125`)
- `services/xstockstrat-analysis/app/handlers/servicer.py:151` → the identical phrase, inside the same
  helper's docstring (`:147-152`), with "Shared by ManageStrategy and (feature 048) SetStrategyLive."
- Both are **docstring text only**; the executable body below each (`metadata = dict(context.invocation_metadata())`,
  the `int(metadata.get("x-access-scope", "0"))` parse and the `& 0x04` check) is untouched
- These are the only two non-agent service source files the FR-4 grep hits
- CI: both services are `python-lint` + `python-test` matrix entries
  (`.github/workflows/ci.yml:288-291`, `:337-342`), threshold **40**, so this step re-runs both suites

**TDD**: `red-green required` — declared as a **characterization green** per `tdd-gate.md:41-44`:
*red N/A — no behavior change; the existing suites are the characterization*. State this explicitly in
the PR body and `context.md`; do not skip the gate silently (**P-03**).

**Instructions**:

1. In both docstrings, replace "MCP agent via its SSE auth layer" with a phrase naming the surviving
   transport — e.g. "MCP agent via its OAuth 2.1 Streamable HTTP auth layer". Keep every other word of
   both docstrings intact, including analysis's "Shared by ManageStrategy and (feature 048)
   SetStrategyLive." sentence and ingest's "Mirrors the analysis servicer's gate (feature 049 Part A)."
2. Change nothing executable. This step exists because the phrase is a consumer-facing claim about a
   transport that no longer exists (C-10), not because any behavior moved.
3. This step is categorized `service`, not `docs`, because it modifies service source files whose
   lint and coverage jobs run — recategorizing it to detach C-08 would be category laundering
   (`design.md` §5).

**Verification**:

```bash
cd services/xstockstrat-ingest && uv run pytest --cov=app --cov-report=term-missing --cov-fail-under=40 \
  && ruff check . && ruff format --check .
cd ../xstockstrat-analysis && uv run pytest --cov=app --cov-report=term-missing --cov-fail-under=40 \
  && ruff check . && ruff format --check .
cd ../.. && ! grep -rn "SSE auth layer" services/
```

Expect: both suites green at ≥40% **unchanged** from before the edit, ruff clean in both, and zero
remaining "SSE auth layer" hits anywhere under `services/`.

---

### Step 8 — docs: sweep every remaining SSE surface and run the AC-5 two-tier reconciliation

**Status**: `done`
**Service**: `docs/`, root `CLAUDE.md`, `scripts/`
**Files**:
- `CLAUDE.md` — modify (root, Service Registry)
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-agent/docs/context-constitution.md` — modify
- `services/xstockstrat-agent/docs/context-constitution-findings.md` — modify
- `docs/runbooks/mcp-tools.md` — modify
- `docs/patterns/header-propagation.md` — modify
- `docs/launch-pdfs/product-features.md` — modify
- `scripts/setup-env.sh` — modify

**Reviewers**: none (per the `docs` row of the reviewer-registry governance matrix)

**Codebase Evidence** — every line below was confirmed by re-running FR-4's grep on 2026-07-29
(`git ls-files | grep -vE '^(packages/proto/gen/|docs/roadmap/features/)' | xargs grep -niE '\bSSE\b|/sse|/messages|build_sse_app|_run_sse|MCP_SSE_PORT|SseServerTransport'`):

- `CLAUDE.md:105` → `| xstockstrat-agent | Python | MCP server … | — | 9000 (SSE) |`
- `services/xstockstrat-agent/CLAUDE.md:11` → "(`MCP_TRANSPORT=sse`, port 9000). It serves **two MCP
  transports**…"; `:15` → "plus the **legacy HTTP+SSE** transport at `/sse` + `/messages` for Claude
  Desktop"; `:65` → "the legacy SSE `POST /messages` returns before `_authorized` runs"; `:77` → "for
  its MCP SSE endpoint"; **`:83` → "Routes (registered in `app/main.py` `build_sse_app`)" — made stale
  by this feature's own Step 3 rename**; `:94` → the `/sse` + `/messages` route-table row;
  `:97` → "Both MCP endpoints (root Streamable HTTP and `/sse`)"; `:118-119` → the env block's
  `MCP_TRANSPORT=sse` / `MCP_SSE_PORT=9000`
- `services/xstockstrat-agent/docs/context-constitution.md:4` → "(FastMCP server, HTTP :9000 SSE)";
  `:16` → AGENT-2's "the one top-level exception is `app/auth.py:13` (SSE path only)";
  `:30` → the Pointers row "OAuth 2.1 routes, **dual-transport** `handle_mcp`, `/agent` path-insertion
  quirk" — **added by inspection, not a grep hit** (it states the stale claim without using any grep
  term); do not remove it as unsupported
- `services/xstockstrat-agent/docs/context-constitution-findings.md:18` → the latent-bug row
  "`MCP_TRANSPORT` default is `"stdio"` … | `app/main.py:25`". This needs a **semantic rewrite, not a
  line renumber**: Step 1 deletes the constant that row points at, so the subject becomes
  `resolve_transport()`. The defect **persists** — narrowed by the new unrecognized-value warning, not
  closed (`design.md` §5, adversary objection 10; recon Risk 6 framed this as an off-by-one and was
  wrong)
- `docs/runbooks/mcp-tools.md:13` → the `sse` Transport-Modes row (`MCP_TRANSPORT=sse`,
  `MCP_SSE_PORT=9000`); `:15` → "**SSE endpoints.**"; `:21-22` → the `GET /sse` and `POST /messages`
  path-table rows; `:27` → "**Direct SSE (local):** `http://localhost:9000/sse`"; `:42` → the
  "### SSE — OAuth 2.1" heading; **`:48` → "an unauthenticated `GET /sse` returns `401`" — directly
  contradicted by FR-1a's 404**; `:61` → "presented as `Authorization: Bearer <jwt>` on `/sse`";
  `:683` → "Over the legacy SSE transport it returns an 'unsupported transport' error."
- `docs/patterns/header-propagation.md:13` → "the entry points are now the `xstockstrat-ui` BFF and
  the MCP agent SSE layer"; `:21` → "The **MCP agent** SSE layer authenticates the caller"
- `docs/launch-pdfs/product-features.md:177` → "`xstockstrat-agent` (port 9000, SSE transport)"
- `scripts/setup-env.sh:199` → `info "Leave empty to disable header enforcement (SSE API-key auth is still active)."`

**TDD**: `N/A (docs — no executable logic)`

**Instructions**:

1. Rewrite each line above to describe the surviving transports (`stdio` + Streamable HTTP at the
   agent root) and the new env names (`MCP_TRANSPORT=http` with `sse` as a deprecated alias;
   `MCP_HTTP_PORT` with `MCP_SSE_PORT` as a deprecated fallback). Specifically:
   - Root `CLAUDE.md:105` — `9000 (SSE)` → `9000 (HTTP)`.
   - Agent `CLAUDE.md` — § Role now describes one remote transport; `:83` cites `build_http_app`; the
     `:94` route-table row for `/sse` + `/messages` becomes a row stating both paths return 404 with a
     pointer to the replacement URL; `:97` names only the root Streamable HTTP endpoint; `:118-119`
     become `MCP_TRANSPORT=http` / `MCP_HTTP_PORT=9000`. § Management-tool authorization keeps the
     `set_config` guard but says the SSE transport was **removed** rather than unsupported (FR-3).
   - `docs/runbooks/mcp-tools.md` — § Transport Modes lists `stdio` and `http` (with `sse` noted as a
     deprecated alias that still starts the HTTP server and logs a warning); the endpoint table drops
     `GET /sse` / `POST /messages` and gains the root Streamable HTTP endpoint plus a row for the two
     removed paths returning **404**; `:27`'s "Direct SSE (local)" becomes the bare
     `http://localhost:9000`; `:42`'s heading and `:61`'s bearer-token sentence name the Streamable
     HTTP endpoint; **`:48`'s "unauthenticated `GET /sse` returns 401" is corrected** — the
     discovery-triggering 401 now comes from an unauthenticated request to the **root** endpoint, and
     `GET /sse` returns 404; `:683` says the transport was removed by feature 079 and the guard is
     retained as defence in depth.
   - `docs/patterns/header-propagation.md:13,21` — "the MCP agent SSE layer" → "the MCP agent's
     OAuth 2.1 Streamable HTTP auth layer".
   - `docs/launch-pdfs/product-features.md:177` — "(port 9000, SSE transport)" → "(port 9000,
     Streamable HTTP transport)".
   - `scripts/setup-env.sh:199` — drop the "(SSE API-key auth is still active)" parenthetical; it
     names a credential path OAuth 2.1 already replaced. Keep the line macOS/bash-3.2 compatible (it
     is a plain `info "…"` call — no syntax change needed).
   - `services/xstockstrat-agent/docs/context-constitution.md:4,16,30` — `:4` drops "SSE" from the
     header description; `:16` keeps AGENT-2 but re-describes `app/auth.py:13`'s top-level import as
     the HTTP-transport path; `:30` replaces "dual-transport `handle_mcp`" with the single-transport
     description.
   - `services/xstockstrat-agent/docs/context-constitution-findings.md:18` — semantic rewrite per the
     evidence above; the finding stays **open by design**.
2. Add the **operator release note** required by `design.md` § Open Risks and the product spec's
   Open Question finding 4, to `docs/runbooks/mcp-tools.md` § Transport Modes: a connector whose saved
   URL ends in `/sse` will 404 after deploy; the fix is to edit that connector's URL down to the bare
   `AGENT_PUBLIC_URL`, a one-line client change with no re-authorization needed. The same note goes in
   the PR body.
3. Run the **AC-5 tier-1** gate — a hard mechanical zero:

   ```bash
   git ls-files | grep -vE '^(packages/proto/gen/|docs/roadmap/features/)' \
     | xargs grep -nE 'build_sse_app|_run_sse|SseServerTransport|mcp\.server\.sse|handle_post_message'
   ```

   Must return **no rows**. The pre-change baseline is 14 rows (agent `CLAUDE.md:83`;
   `app/main.py:51,59,76,164,206,209,225`; `tests/test_oauth.py:4,17,19,73`;
   `tests/test_tools_endpoint.py:12,14`) — all of them are addressed by Steps 3 and 8. `CHANGELOG.md`
   carries no tier-1 hit (verified), so it needs no exclusion here.
4. Run the **AC-5 tier-2** gate — re-run FR-4's full grep and enumerate **every** surviving hit in the
   PR body with a one-line justification, at **line** granularity (never file granularity — that is
   exactly what would let `app/main.py:125-128` hide):

   ```bash
   git ls-files | grep -vE '^(packages/proto/gen/|docs/roadmap/features/)' \
     | xargs grep -niE '\bSSE\b|/sse|/messages|MCP_SSE_PORT'
   ```

   Expected legitimate survivors, each of which must appear in the PR body's justification list:
   - `app/main.py` — the `REMOVED_TRANSPORT_PATHS` tuple and the `_send_transport_removed` comment
     (FR-1a requires naming the removed paths), plus `resolve_transport`/`resolve_http_port`'s
     deprecated `sse` / `MCP_SSE_PORT` handling (FR-2 requires naming the old values).
   - `tests/test_oauth.py`, `tests/test_transport_config.py` — the cases that assert the 404 and the
     alias/fallback must name them.
   - **Deliberately NOT changed** (product spec FR-4): `CHANGELOG.md:337` (historical record);
     `docs/roadmap/phase5-deviations.md:38-45,106`, `docs/roadmap/CLAUDE.md:8` and
     `services/xstockstrat-notify/CLAUDE.md:28` (a *different* SSE — the trader alert stream to the
     browser); `services/xstockstrat-agent/uv.lock` (`sse-starlette` / `httpx-sse` are transitive deps
     of `mcp` itself); `docs/roadmap/features/**` (SDD artifacts, excluded above);
     `services/xstockstrat-ui/.next/**` (build output, untracked).
   - **Additional survivors found during this spec run, not in FR-4's enumeration**:
     `docs/roadmap/ledger/insights.md:356,359,373,381,384` — this feature's own two design-phase
     ledger entries. `docs/roadmap/ledger/` is **append-only by convention**
     (`docs/roadmap/ledger/CLAUDE.md`), so they are legitimate survivors and must be justified in the
     PR body rather than edited. Flag any hit outside this list as an AC-5 failure.
5. Run `/context-scrubber scan`, scoped to the changed context files (root `CLAUDE.md`, agent
   `CLAUDE.md`, `services/xstockstrat-agent/docs/context-constitution*.md`), per the root `CLAUDE.md`
   teardown rule, and fix the grounded findings it reports. If the context-forge plugin is not
   available in the session, say so in the PR body rather than skipping silently.

**Verification**:

```bash
# AC-5 tier 1 — must print nothing and exit non-zero on the grep
! git ls-files | grep -vE '^(packages/proto/gen/|docs/roadmap/features/)' \
  | xargs grep -nE 'build_sse_app|_run_sse|SseServerTransport|mcp\.server\.sse|handle_post_message'

# AC-5 tier 2 — enumerate survivors for the PR body
git ls-files | grep -vE '^(packages/proto/gen/|docs/roadmap/features/)' \
  | xargs grep -niE '\bSSE\b|/sse|/messages|MCP_SSE_PORT'

# spot-checks on the two corrected claims
grep -n "9000" CLAUDE.md | grep -i agent
grep -n "404" docs/runbooks/mcp-tools.md
```

Expect: tier 1 returns nothing; every tier-2 row maps to the justification list in Instruction 4;
root `CLAUDE.md`'s agent row no longer says SSE; `mcp-tools.md` documents the 404 and the operator
URL-trim note.

---

## Deviation Log

### D-1 — Steps 1 and 3 landed the `_run_sse` → `_run_http` rename together
- **Spec said**: Step 1 keeps the runner named `_run_sse`; Step 3 renames it.
- **What happened**: the feature ships as a single PR, so the intermediate state where the runner
  is still `_run_sse` has no reviewable artifact — it would only have caused the Step 2 dispatch
  test to be written against one name and rewritten against the other one commit later. The rename
  landed with Step 1. End state is byte-identical to the spec's.
- **Impact**: none on the delivered code. The red capture for Cycle A was taken before any edit and
  is unaffected.

### D-2 — Step 5's verification command was too strict and was corrected in place
- **Spec said**: `! grep -n "sse" claude_mcp_config.json` — no `sse` anywhere in the file.
- **What happened**: that gate fails on the **operator migration note** FR-4 requires, which must
  name `/sse` to tell an operator which saved connector URL to change. The same shape as the AC-5
  defect the design phase caught: a substring gate over vocabulary that legitimately survives.
  Replaced with the real invariant — no server block's **`url`** may contain `/sse` — asserted in
  the same Python check that validates the JSON, plus the stdio block being untouched.
- **Impact**: the delivered config is what the spec intended; only the check changed.

### D-3 — Two docstring reflows in Step 7 beyond the one-phrase edit
- **Spec said**: replace one phrase in each servicer docstring, change nothing else.
- **What happened**: "SSE auth layer" → "OAuth 2.1 Streamable HTTP auth layer" is longer and pushed
  both docstrings past ruff's 100-char limit, so the surrounding two lines were re-wrapped. No
  wording other than the named phrase changed.
- **Impact**: none. Both suites pass with unchanged counts (ingest 134, analysis 351), which is the
  characterization green Step 7 declared.
