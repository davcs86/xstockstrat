# Recon: agent-postgres-mcp

**Generated**: 2026-09-02  
**Mode**: quick (1 mandated round)  
**Services discovered**: `xstockstrat-agent`, `xstockstrat-ui` (copilot.ts surface)

---

## 1. Codebase Map

### Entry Point & Process Model

| Symbol | Path | Line |
|---|---|---|
| `ENTRYPOINT` | `services/xstockstrat-agent/Dockerfile` | 20 |
| `CMD` | `services/xstockstrat-agent/Dockerfile` | 21 |
| `docker-entrypoint.sh` source | `scripts/docker-entrypoint.sh` | — |
| `uvicorn.Config(host="0.0.0.0", port=port)` | `services/xstockstrat-agent/app/main.py` | 264 |
| `MCPServer("xstockstrat-agent")` | `services/xstockstrat-agent/app/main.py` | 69 |
| `register_tools(server)` | `services/xstockstrat-agent/app/main.py` | 70 |
| Claims published to scope | `services/xstockstrat-agent/app/main.py` | 174 |

**Current**: `ENTRYPOINT ["/docker-entrypoint.sh"]` + `CMD ["python", "-m", "app.main"]`. The entrypoint script does `exec "$@"`, so it will exec whatever CMD is — supervisord when CMD is changed. **WAIT_FOR dep-probe fires before the exec**, meaning supervisord inherits the post-probe environment. No process-model deviation needed.

### Tool Registration & Admin Gate

| Symbol | Path | Line |
|---|---|---|
| Module docstring ("Thirty-three tools") | `services/xstockstrat-agent/app/tools.py` | 1–38 |
| `_caller_access_scope(ctx, tool)` | `services/xstockstrat-agent/app/tools.py` | 107–116 |
| `claims = scope.get("state")...get(MCP_CLAIMS_SCOPE_KEY)` | `services/xstockstrat-agent/app/tools.py` | 84–85 |
| `roles_to_access_scope` | `services/xstockstrat-agent/app/scopes.py` | (whole file) |
| Admin bit `0x04` | `services/xstockstrat-agent/app/scopes.py` | — |
| `MCP_CLAIMS_SCOPE_KEY` | `services/xstockstrat-agent/app/scopes.py` | — |

**Admin gate pattern (used by `trigger_backfill`, `manage_signal_source`)**: `_caller_access_scope(ctx, tool)` reads `MCP_CLAIMS_SCOPE_KEY` from the ASGI scope state, calls `roles_to_access_scope` to derive the bitmask, and checks `& 0x04`. Non-admin → raises `PERMISSION_DENIED` before any backend call is made.

### MCP Client — CRITICAL GAP

| Item | Finding |
|---|---|
| `mcp.client`, `ClientSession`, `SSEClient`, `sse_client` | **NOT FOUND** — no MCP client code in `app/` |
| `streamablehttp_client` | **NOT FOUND** |
| `httpx` / `aiohttp` calls to `localhost:8000` | **NOT FOUND** |
| `mcp_client` in codebase | Found only as a signal-source type constant — unrelated |

**The entire MCP client implementation (agent connecting to postgres-mcp SSE on localhost:8000) is greenfield.** No existing pattern to reuse. The `mcp` SDK v2 (`mcp>=2.0.0,<3`) has SSE client capability (`mcp.client.sse.sse_client`) — this is the first use of it in this codebase.

### Tool Inventory Surfaces (all 6)

| Surface | Path | Current value |
|---|---|---|
| `app/tools.py` docstring | `services/xstockstrat-agent/app/tools.py:1` | "Thirty-three tools" |
| CLAUDE.md tool count | `services/xstockstrat-agent/CLAUDE.md:43` | "thirty-three tools" + 33-row table |
| `mcp-tools.md` header count | `docs/runbooks/mcp-tools.md:3` | "Complete reference for the thirty-three tools" |
| `mcp-tools.md` per-tool entries | `docs/runbooks/mcp-tools.md` | 33 entries present |
| `test_tools_endpoint.py` exact-name set | `services/xstockstrat-agent/tests/test_tools_endpoint.py:23–57` | 33-name set literal |
| `copilot.ts` constant | `services/xstockstrat-ui/src/lib/copilot.ts:14` | `COPILOT_MCP_TOOL_COUNT = 32` — **PRE-EXISTING STALE** |

**Pre-existing drift**: `copilot.ts` is already wrong by 1 (32 vs actual 33). This feature must bring it to 42 (33 + 9), absorbing the fix.

### Dependencies

| Dependency | Path | Present? |
|---|---|---|
| `mcp>=2.0.0,<3` | `services/xstockstrat-agent/pyproject.toml` | ✓ |
| `supervisor` (PyPI) | `services/xstockstrat-agent/pyproject.toml` | ✗ — **NOT PRESENT** |
| `postgres-mcp` (PyPI) | `services/xstockstrat-agent/pyproject.toml` | ✗ — **NOT PRESENT** |
| `supervisord.conf` | `services/xstockstrat-agent/` | ✗ — **NOT PRESENT** |

### Environment Variables

| Variable | docker-compose.yml | .do/app.yaml | .do/app.dev.yaml |
|---|---|---|---|
| `POSTGRES_MCP_DATABASE_URI` | **NOT PRESENT** | **NOT PRESENT** | **NOT PRESENT** |
| `POSTGRES_MCP_PORT` | **NOT PRESENT** | **NOT PRESENT** | **NOT PRESENT** |

### Tests

All test files under `services/xstockstrat-agent/tests/`:
```
__init__.py, test_auth.py, test_config_tools.py, test_backtest_view.py,
test_formula_builders.py, conftest.py, test_signal_source_builder.py,
test_signal_source_reliability_weight.py, test_transport_config.py,
test_streamable_http_auth.py, test_header_propagation.py,
test_signal_source_projection.py, test_oauth.py, test_offline_client.py,
test_ingest_signal_watchlist.py, test_strategy_builders.py,
test_watchlist_tools.py, test_watchlist_client.py, test_account_tools.py,
test_client.py, test_broker_account_client.py, test_tools.py, test_tools_endpoint.py
```

**`test_tools_endpoint.py:23–57`** contains the exact-name set assertion — the 33-name set literal. This is the runtime guard for FR-7 (surface 5 of 6). Adding `db_*` names here is mandatory and CI-enforced.

---

## 2. Not Found

- `services/xstockstrat-agent/supervisord.conf` — does not exist (greenfield)
- `POSTGRES_MCP_DATABASE_URI` in any docker-compose, .do/app.yaml, or .do/app.dev.yaml
- `POSTGRES_MCP_PORT` in any config file
- Any MCP client code in `services/xstockstrat-agent/app/` (sse_client, ClientSession, streamablehttp_client)
- `postgres-mcp` in `pyproject.toml`
- `supervisor` in `pyproject.toml`
- `docker-entrypoint.sh` in `services/xstockstrat-agent/` (it lives at `scripts/docker-entrypoint.sh`, copied in Dockerfile:16)

---

## 3. Patterns to REUSE

| Pattern | Source | How to apply |
|---|---|---|
| **Admin gate via `_caller_access_scope`** | `services/xstockstrat-agent/app/tools.py:107–116` + `app/scopes.py` | Each `db_*` tool handler calls `_caller_access_scope(ctx, tool)` before any postgres-mcp forwarding. Non-admin → `PERMISSION_DENIED`. This is the exact same pattern as `trigger_backfill` and `manage_signal_source`. |
| **`test_backtest_view.py` descriptor-parity pattern** | `services/xstockstrat-agent/tests/test_backtest_view.py` | Use the same "read tools/list, assert names" pattern for CI-enforcement of surface 5 (`test_tools_endpoint.py`). |
| **`_metadata()` tuple builder** | `services/xstockstrat-agent/app/client.py` | For any gRPC-style metadata propagation pattern. Not directly applicable (postgres-mcp is MCP, not gRPC) but shows how the agent structures forwarded calls. |
| **`uv add`/`uv lock` discipline** | `services/xstockstrat-agent/pyproject.toml` + root CLAUDE.md | `uv add supervisor postgres-mcp`, then `uv lock` — both in the same PR. Enforced by `python-lint` → `uv lock --check`. |
| **Dockerfile layering** | `services/xstockstrat-agent/Dockerfile` | `COPY pyproject.toml uv.lock ./` then `RUN uv sync --frozen --no-dev` — add `supervisor` and `postgres-mcp` as runtime deps so `--no-dev` still installs them. |

---

## 4. Existing Business Rules (Scenario-Recon: C-16)

Rules from existing durable business-rule suites the feature must not violate:

| ID | Scenario | Classification | Reason |
|---|---|---|---|
| `@AC-9 @feature-147` | OAuth txn HMAC-signing with `JWT_SECRET` must be intact | **PRESERVE** | supervisord restructuring must not alter the agent's startup sequence that initializes JWT signing; the ASGI app still starts the same way |
| `@AC-8 @feature-147` | `MCP_AGENT_SECRET` must not appear in any env surface | **PRESERVE** | feature 147 removed this variable; adding new env vars (POSTGRES_MCP_DATABASE_URI) must not revive the removed secret pattern |
| `@AC-8 @feature-156` | Real caller's `x-access-scope` is forwarded; no hardcoded admin override | **PRESERVE** | New `db_*` tool handlers must derive scope from `_caller_access_scope(ctx, tool)`, never hardcode `x-access-scope=7` (the old pattern feature 092 removed) |

No EXTEND or CHANGE classifications — this feature adds a new admin-only surface; it does not modify any existing tool contracts.

---

## 5. Risks & Traps

| Risk | Evidence | Mitigation |
|---|---|---|
| **Greenfield MCP client** | No existing sse_client usage in codebase | Use `mcp.client.sse.sse_client` from the already-pinned `mcp>=2.0.0,<3` SDK; document the async lifecycle in `design.md` |
| **Supervisord startup ordering** | `docker-entrypoint.sh` runs `WAIT_FOR` dep-probe then `exec "$@"` | supervisord must start AFTER the dep-probe exits; because entrypoint does `exec supervisord`, the probe still fires first — verify in Dockerfile walk-through |
| **copilot.ts pre-existing stale** | `COPILOT_MCP_TOOL_COUNT = 32` (should be 33) | Feature PR must fix to 42 (33+9), absorbing the existing 1-count drift |
| **uv.lock out-of-sync** | `python-lint` CI gate: `uv lock --check` | Run `uv lock` after `uv add supervisor postgres-mcp` — commit together |
| **MCP surface drift (ledger 2026-08-02)** | 6 surfaces, all must update atomically | Confirmed: exactly 6 surfaces; all enumerated above |
| **Dockerfile entrypoint replacement (ledger 2026-08-05)** | Nginx/agent trap | `WAIT_FOR` fires before `exec supervisord` — safe; verify in step |
| **POSTGRES_MCP_DATABASE_URI credential deviation (C-10/PLAT-4)** | context.md 2026-09-02T00:01Z | crystaldba/postgres-mcp reads URI at process startup from env — not via RPC. Deviation is legitimate; impl-spec must document it. |
| **db_analyze_db_health return shape** | context.md 2026-09-02T00:01Z | Returns plain text (labeled sections), not JSON. @AC-5 already corrected. |
| **Connection pool budget** | root CLAUDE.md (direct-backend total = 8) | postgres-mcp adds 1 direct slot → total becomes 9. Update CLAUDE.md budget table in same PR. |
