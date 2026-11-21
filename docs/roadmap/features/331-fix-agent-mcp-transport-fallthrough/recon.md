# Recon: fix-agent-mcp-transport-fallthrough

**Created**: 2026-11-20
**From**: product-spec.md
**Tree**: main-dev@fb52065c ≡ origin/main-dev (no `feature/fix-agent-mcp-transport-fallthrough` branch existed yet; discovery digests were UNSTAMPED, every citation below was re-grepped on this tree)
**Affected services**: xstockstrat-agent

---

## Objective

Make the agent's transport selection fail closed (SEV-3 bug, Track C). Per the operator decision of
2026-11-10: an unset `MCP_TRANSPORT` starts Streamable HTTP on :9000, only an explicit `stdio` starts
stdio, and any other value exits non-zero with an error naming `MCP_TRANSPORT` and the value. Today
both unset and mistyped values silently start stdio, so a deployed agent serves nothing on :9000 with
only a warning.

## Codebase Map

- **`xstockstrat-agent`** (Python)
  - Entry point: `main()` — `services/xstockstrat-agent/app/main.py:281`; dispatch at `:286`
    `asyncio.run(_run_http() if resolve_transport() == "http" else _run_stdio())` — anything other
    than `"http"` runs stdio, so a bad value must raise/exit inside `resolve_transport()` (evaluated
    before either runner coroutine is created).
  - Handler/servicer: `resolve_transport()` — `services/xstockstrat-agent/app/main.py:52-65`
    - `:54` `raw = os.environ.get("MCP_TRANSPORT", "stdio")` (the stdio default)
    - `:55-60` `sse` → deprecation warning, returns `"http"` (out of scope, keep)
    - `:61-64` unrecognized → `log.warning("MCP_TRANSPORT=%r is not recognized; falling back to stdio", raw)`, then `:65` returns the raw value
    - `:62-63` comment justifying the "warning before the stdio fall-through" — stale after the fix
  - Last migration: none — no schema or data involved
  - Config-read pattern: n/a — `MCP_TRANSPORT` is a boot env var read with `os.environ.get` (`main.py:54`), never a `WatchConfig` key
  - Other key symbols:
    - module docstring — `main.py:4-7`, `:5` says `stdio  (default)`
    - `resolve_http_port()` — `main.py:68` (default 9000)
    - `_run_stdio()` — `main.py:92`
    - `_run_http()` — `main.py:255`; starts the catalog gRPC server before uvicorn (`:261-265`), so missing `MTLS_*` stops the process before :9000 listens
    - `init_telemetry()` call — `main.py:285` (non-fatal, runs before transport resolution)
    - mTLS fail-closed raise — `services/xstockstrat-agent/app/mtls.py:25-26` (`RuntimeError`, "must all be set (fail-closed)"); documented at `app/catalog_service.py:37`
  - Process supervision: `services/xstockstrat-agent/supervisord.conf:6` `command=python -m app.main`, `:8` `autorestart=true`; `Dockerfile:21` `ENTRYPOINT ["/docker-entrypoint.sh"]`, `:22` `CMD ["supervisord", "-c", "/app/supervisord.conf"]`. The entrypoint is `scripts/docker-entrypoint.sh` (copied at `Dockerfile:16`): it only runs the `WAIT_FOR` probe and `exec "$@"` — it does not read `MCP_TRANSPORT`.
  - Tests: `services/xstockstrat-agent/tests/test_transport_config.py`
    - `:32-47` `TestMainDispatch.test_main_selects_runner_from_resolved_transport` — parametrize at `:34` includes `("banana", "stdio")` (pins the bug)
    - `:64-69` `test_unset_defaults_to_stdio` (opposite of AC-2; uses `monkeypatch.delenv`)
    - `:71-78` `test_unrecognized_value_falls_through_to_stdio_but_warns` — "Behavior is unchanged (AC-4)" (opposite of AC-1)
    - `:92-95` `test_neither_set_defaults_to_9000` (already covers the port half of AC-2)
    - `:17-19` docstring: unset cases must `delenv`
  - Test fixture: `services/xstockstrat-agent/tests/conftest.py:126` autouse `monkeypatch.setenv("MCP_TRANSPORT", "stdio")` — every other agent test runs with an explicit `stdio`, so the new default does not touch them.
  - Deploy env (all already `http`; no deploy change needed): `docker-compose.yml:573`, `deploy/homelab/compose.yml:320`, `.do/app.yaml:384-385`, `.do/app.dev.yaml:386-387`. Local stdio client config is explicit: `services/xstockstrat-agent/claude_mcp_config.json:11` `"MCP_TRANSPORT": "stdio"`.
  - Liveness: `docker-compose.yml:585` TCP probe `echo > /dev/tcp/localhost/9000`; no agent `health_check` in `.do/app*.yaml` (out of scope by operator decision).

## Patterns to REUSE

- Fail-closed startup error → reuse the shape of the mTLS raise at `services/xstockstrat-agent/app/mtls.py:25-26`: a plain raise with a message naming the env var. The new error must name both `MCP_TRANSPORT` and the offending value (sdd-review warning; AC-1).
- Dispatch-level regression tests → reuse `TestMainDispatch` (`tests/test_transport_config.py:29-47`): monkeypatch `_run_http`, `_run_stdio` and `asyncio.run`, then assert which runner was recorded. Ledger insight `docs/roadmap/ledger/insights.md:353-361`: test `main()` dispatch, not only the return value of `resolve_transport()`. AC-1's "does not start the stdio transport" is `recorded == []` plus the raised exit.
- Unset-variable cases → reuse the `monkeypatch.delenv("MCP_TRANSPORT", raising=False)` idiom (`tests/test_transport_config.py:66`); `setenv` would silently assert the conftest value.
- Import style in the test file → keep `import app.main as main_mod` with attributes read inside test bodies (`tests/test_transport_config.py:12-15`), so each case fails on its own.
- No new helper, constant or config key is needed; the recognized set `("stdio", "http")` already exists at `main.py:61`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @FR-1 @feature-214` "The xstockstrat-agent MCP advertises no db_ tool" (`services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature:9-10`) — its Given assumes the agent serves Streamable HTTP on :9000. Unset and explicit `http` must still serve it.
- **PRESERVE** `@AC-4 @FR-4 @feature-210` "mTLS is enforced identically in every environment; verification cannot be disabled" (`docs/sdd/business-rules/platform.feature:234-235`) — a service without its `MTLS_*` material fails closed. This now also applies to an unset `MCP_TRANSPORT`, since unset resolves to http and http boots the catalog gRPC server.
- **PRESERVE** `@AC-2 @FR-3 @regression @feature-171` "Telemetry init remains non-blocking after the trading_mode attribute is removed" (`docs/sdd/business-rules/platform.feature:142-143`) — the new non-zero exit must come only from transport resolution, never from OTel init (`main.py:285` stays non-fatal).
- **CHANGE (no promoted scenario exists)** feature 079 AC-4 — "unrecognized or unset `MCP_TRANSPORT` falls back to stdio with a warning". Deliberately reversed by this feature. No `@AC-*` scenario for it exists in any durable suite: `docs/roadmap/features/079-remove-mcp-sse-transport/` holds only `context.md`, `feature.md` and `status.md` (archived 2026-08-06, specs pruned, no `acceptance.feature` in git history), and a grep of `docs/sdd/business-rules/*.feature` and `services/*/acceptance/` for `MCP_TRANSPORT`, `feature-079` and "falls back to stdio" matches nothing. The only surviving pins are the code comment (`main.py:62-63`) and the test docstring (`tests/test_transport_config.py:74-75`). Operator sign-off for the reversal is already recorded in `context.md` (Session 2026-11-10, /sdd-review operator decisions); carry it into design.md as a sign-off-only CHANGE with no suite edit.
- Scenario-recon read depth was partial: `platform.feature` lines 1-795 in full, the remaining ~1,940 lines (file is 2,737 lines) by targeted grep; 39 of the 41 agent suites by grep only. The one other "transport" hit in `platform.feature` (`:216`) is the inter-service mTLS comment, not transport selection.

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none (`MCP_TRANSPORT` is a boot env var)
- Inter-service edges: none
- New env vars / ports: none — `MCP_TRANSPORT` already set to `http` in `docker-compose.yml:573`, `deploy/homelab/compose.yml:320`, `.do/app.yaml:384`, `.do/app.dev.yaml:386`
- Docs stating the old behavior (same PR):
  - `docs/runbooks/mcp-tools.md:20` — `MCP_TRANSPORT=stdio` (default)
  - `services/xstockstrat-agent/CLAUDE.md:4` — header cites "defects (`MCP_TRANSPORT` stdio default)"
  - `services/xstockstrat-agent/docs/context-constitution-findings.md:30` (latent-bug row) and `:82` (report link row)
  - `services/xstockstrat-agent/app/main.py:5` module docstring
  - Not needing change (digest corrected on re-grep): `services/xstockstrat-agent/CLAUDE.md:143` already reads `MCP_TRANSPORT=http`; `services/xstockstrat-agent/docs/context-constitution.md` has no `MCP_TRANSPORT` line.

## Risks / Not-found

- **Exit mechanism is a design fork.** Options: raise (`RuntimeError`/`ValueError`, traceback + exit 1, matches `mtls.py:25`) or `SystemExit` with a message. AC-1 only requires non-zero exit and an error naming the value; design must pick one and say how the unit test observes it.
- **supervisord crash loop, container stays up.** `supervisord.conf:8` `autorestart=true` restarts `app-main` after each non-zero exit, and supervisord (the container's main process, `Dockerfile:22`) keeps running. So "the process exits non-zero" holds for `python -m app.main`, not for the container: the result is a loud restart loop in logs with nothing on :9000. The compose TCP probe (`docker-compose.yml:585`) marks it unhealthy; on DO there is no agent `health_check` (out of scope). Design should state whether this is the accepted meaning of AC-1's "exits non-zero" or whether supervisord behavior needs a decision. Not verified: how DO App Platform treats a component whose HTTP port never opens.
- **Empty-string value is unspecified.** `MCP_TRANSPORT=""` today returns `""` and runs stdio. The ACs cover unset and `"htp"` only. Design must decide: treat empty as unset (→ http) or as unrecognized (→ exit). Likewise no AC asks for case or whitespace normalization; the minimum fix does none.
- **Unset now needs mTLS material.** A bare local `python -m app.main` with no env used to start stdio; it will now take the http path and fail at `mtls.py:25` unless `MTLS_*` is set. This is consistent with `@AC-4 @feature-210`, but the docs must say local stdio use requires an explicit `MCP_TRANSPORT=stdio` (the shipped `claude_mcp_config.json:11` already does).
- **AC-2 "on port 9000" in a unit harness.** No test starts a real listener; the observable is the http runner being selected for an unset variable, with the port default already pinned at `tests/test_transport_config.py:92-95`. Design should confirm that split satisfies AC-2, plus the dev smoke test from the product spec.
- **Product-spec line drift.** The spec cites `main.py:51/:53/:63`, `docker-compose.yml:581`, `.do/app.yaml:379`, `.do/app.dev.yaml:381`; current lines are `main.py:52/:54/:61-64`, `docker-compose.yml:585`, `.do/app.yaml:384`, `.do/app.dev.yaml:386`. `/sdd-spec` must cite the re-grepped lines.
- **C-16 supersede target not found** (see Existing Business Rules): nothing to mark superseded in any suite; record as sign-off-only.
- **Overlap**: sdd-review flagged the agent as shared with features 314/319/322/328, and this batch also contains `fix-agent-bearer-secret-orphan` and `fix-mcp-deadline-budget`. None is known to touch `resolve_transport()`; whether any touches `app/main.py` or `tests/test_transport_config.py` was not checked.
- **Report sidecar** `docs/reports/2026-10-19-agent-mcp-transport-stdio-fallthrough-defect.status` reads `triaged`; closing it is a launch-time step, not part of this fix.
- Applicable ledger traps:
  - `docs/roadmap/ledger/insights.md:353-361` — a `resolve_transport()` return-value test alone does not prove which server starts; assert dispatch through `main()`.
  - `docs/roadmap/ledger/fails.md:432` — `xstockstrat-agent` has been absent from the CI lint matrix; run `ruff` locally on touched files and do not fix unrelated violations.
  - `docs/roadmap/ledger/fails.md:138` (feature 079) — a grep-based acceptance gate proved unsatisfiable; keep this feature's checks behavioral (pytest), not grep gates.

## Recommended Scope

Advisory; one small PR, quick-mode design.

1. **test (red)** — `services/xstockstrat-agent/tests/test_transport_config.py`: drop `("banana", "stdio")` from the dispatch parametrize; replace `test_unset_defaults_to_stdio` and `test_unrecognized_value_falls_through_to_stdio_but_warns` with AC-2 (unset → `"http"`, and `main()` records the http runner) and AC-1 (unrecognized → exit/raise naming `MCP_TRANSPORT` and the value, `main()` records no runner); keep the `http`/`stdio`/`sse` cases for AC-3.
2. **service (green)** — `services/xstockstrat-agent/app/main.py`: default `"http"` at `:54`; replace the warning + fall-through at `:61-64` with the fail-closed exit; update the module docstring (`:5`) and drop the stale comment (`:62-63`). Verify with `uv sync --extra dev` then `uv run pytest --cov=app --cov-fail-under=40` in the service directory.
3. **docs** — `docs/runbooks/mcp-tools.md:20`, `services/xstockstrat-agent/CLAUDE.md:4`, `services/xstockstrat-agent/docs/context-constitution-findings.md:30,82`.
4. **verify** — dev smoke test: agent starts and serves :9000 with `MCP_TRANSPORT=http` (unchanged deploy env).
