# Implementation Spec: fix-mcp-extract-credentials

**Status**: `pending`
**Created**: 2026-08-02
**Feature**: `docs/roadmap/features/093-fix-mcp-extract-credentials/feature.md`
**Total Steps**: 3
**Feature Branch**: `feature/fix-mcp-extract-credentials`

---

## Execution Summary

The approved design (option (c)) is an **agent-only** change — no proto, no migration, no new config
key. Step 1 is a single **atomic** service step because Constitution **F-05** forbids an intermediate
`TypeError`: `client.get_config_value`'s signature changes to required `namespace`/`environment`
kwargs, so **every** caller and the one hand-written test stub must move in the same commit. Step 1
also lifts the env/mode normalizer into `app/scopes.py` (so `oauth_server.py`, which can't reach a
closure inside `register_tools`, can use it) and rewrites the two extract-tool docstrings (same file,
same behavior change — C-10). Step 2 is the paired RED-first test step (**C-08**/**P-06**), whose
decisive case is the typed-projection contract (a `float_val` fixture must stringify to `"0.7"`, not
`None` — the hidden O1 bug). Step 3 is the same-PR documentation (**C-10**): mcp-tools.md, the agent
`CLAUDE.md` config-keys table, the resolved F-1 finding, and the reinterpreted AC-4 note in
`add-data-source.md`.

## Step Dependencies

- Step 2 [test] covers Step 1 [service] — both carry `red-green required`; Step 2's assertions fail
  against the pre-Step-1 tree (positional `get_config_value(key)` still exists, `string_val`-only
  projection still returns `None` for the float key, extract tools still read a config credential).
- Step 3 [docs] should land after Step 1 so the documented behavior (extract raises when
  `has_credentials=True`; `agent.signal.alert_threshold` is consumed) matches the shipped code. No
  code depends on Step 3.
- Step 1 must include the `tests/test_oauth.py:160-161` `_cfg(key)` stub widening as its
  green-making minimum (F-05): the stub is called through the new required-kwargs signature, so it
  breaks the moment the signature changes. This is the only *existing* test the atomic change reddens;
  Step 2 adds the *new* assertions on top (ledger insight 072-execute: the green-making minimum
  travels with the change that broke it, the new coverage lands in the paired test step).

---

### Step 1 — service: env-scope, typed-projection, non-swallowing `get_config_value` + lift the scope normalizer + make extract credentials loudly unsupported

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify (`get_config_value` `:678-695`)
- `services/xstockstrat-agent/app/scopes.py` — modify (add the lifted env/mode normalizer)
- `services/xstockstrat-agent/app/tools.py` — modify (`_resolve_scope` `:729-734` delegates; extract
  tools `:143-145,184-186` + docstrings `:131-136,171-175`; alert caller `:234`)
- `services/xstockstrat-agent/app/oauth_server.py` — modify (both callers `:70,85`)
- `services/xstockstrat-agent/tests/test_oauth.py` — modify (widen the `_cfg` stub `:160-161`; F-05
  green-making minimum only — the *new* assertions live in Step 2)

**Reviewers**: xstockstrat-agent (service owner) — MCP tool contract stability (name, parameters,
return shape) and `docs/runbooks/mcp-tools.md` parity, no secret values in tool output; Security —
no secrets resolved from non-`secret.*` config, secret keys use the `secret.*` prefix (this step
*removes* a plaintext-config credential read, C-05/F-07)

**Codebase Evidence**:
- `get_config_value` today (the bug): `grep -n "def get_config_value" app/client.py` → `:678`;
  body `:684-695` — `GetConfig(GetConfigRequest(namespace="agent"))` `:689` (namespace hardcoded, **no**
  `environment`, **no** `metadata=`), `v.string_val or None` `:693` (string-only projection),
  `except Exception: return None` `:694-695` (swallows transport errors).
- The correct patterns to mirror (same file): `_config_scope(environment, trading_mode)` `:842-857`
  (translates strings → `common_pb2` enums); `get_config` `:860-878` sends
  `GetConfigRequest(namespace=namespace, environment=env, trading_mode=mode)` + `metadata=_metadata()`
  `:867-870` and projects the **active oneof** — `which = cv.WhichOneof("value")` `:873`,
  `getattr(cv, which) if which else None` `:875`; `_metadata()` `:24`.
- `_resolve_scope` is a **closure inside `register_tools`** (`app/tools.py:729-734`): env from
  `environment or os.environ.get("APPLICATION_ENV", "development")` normalized to `"production"`/`"dev"`,
  mode from `trading_mode or os.environ.get("TRADING_MODE", "paper")` normalized to
  `paper`/`live`/`all`. Used at `:750,777,838` (the `get_config`/`list_config_keys`/`set_config` tools).
- `app/scopes.py` exists (`:1-42`), imports only `list`/bit constants — **no** import of `tools`/`client`
  (verified: `grep -n "import" app/scopes.py` shows only stdlib/local bit logic), so lifting the
  normalizer here creates no cycle. `oauth_server.py` already imports `os` `:21` and `from app import
  client` `:26`.
- Extract-tool credential reads: `app/tools.py:145` `password = await
  client.get_config_value(f"source.{source_slug}.credentials")` (inside `if src.get("has_credentials")`
  `:143`) and `:186` (same, inside `:184`). CREDENTIAL CAVEAT docstrings `:131-136` and `:171-175`.
  `has_credentials=False` path leaves `password=None`; `_extract_from_bytes` `:885` /`_fetch_url` `:905`
  both default `password=None`, and the encrypted-PDF-without-creds `ValueError` is raised at
  `app/tools.py:895`.
- Alert-threshold caller: `app/tools.py:234` `threshold_str = await
  client.get_config_value(_ALERT_THRESHOLD_CONFIG_KEY)`; const `_ALERT_THRESHOLD_CONFIG_KEY =
  "signal.alert_threshold"` `:38`, `_ALERT_THRESHOLD_DEFAULT = 0.6` `:37`. This read sits **after** the
  signal is already persisted (`client.ingest_signal(...)` `:222`); the existing auto-alert guard uses
  a broad `except Exception` `:255`.
- OAuth callers: `app/oauth_server.py:70` `reg_enabled = await
  client.get_config_value("oauth.registration_enabled")` and `:85` `allowed_raw = await
  client.get_config_value("oauth.allowed_redirect_uris")`, both inside `async def register(request)`
  `:60`. These keys are genuinely `agent.*` (agent `CLAUDE.md` § Config Keys Consumed lists
  `agent.oauth.registration_enabled` / `agent.oauth.allowed_redirect_uris`).
- Existing test stub that breaks under the new signature: `tests/test_oauth.py:160-161`
  `async def _cfg(key): return "false" if key == "oauth.registration_enabled" else None`. The other
  two `get_config_value` mocks are arg-agnostic `AsyncMock` (`test_oauth.py:136,153`;
  `test_tools.py:196,222`) and need no change.

**TDD**: `red-green required`

**Instructions**:
1. **`app/scopes.py`** — add a module-level `resolve_scope(environment: str, trading_mode: str) ->
   tuple[str, str]` containing the *exact* body currently in `tools.py:730-734` (env from
   `os.environ.get("APPLICATION_ENV", "development")` → `"production"`/`"dev"`; mode from
   `os.environ.get("TRADING_MODE", "paper")` → `paper`/`live`/`all`). Import `os` at the top of
   `scopes.py`. Keep the existing feature-073 rationale comment (`tools.py:725-727`) with it.
2. **`app/tools.py`** — replace the `_resolve_scope` closure body (`:729-734`) so it delegates:
   `return scopes.resolve_scope(environment, trading_mode)` (add `from app import scopes` to the module
   imports if absent). Its three existing call sites (`:750,777,838`) are unchanged.
3. **`app/client.py` `get_config_value`** — change the signature to
   `async def get_config_value(key: str, *, namespace: str, environment: str, trading_mode: str = "all") -> str | None:`
   (`namespace` and `environment` are **required keyword** args — the anti-regression against the
   implicit-`agent`/implicit-dev bug). Body:
   - `env, mode = _config_scope(environment, trading_mode)` (reuse `:842`).
   - `snapshot = await stub.GetConfig(config_pb2.GetConfigRequest(namespace=namespace,
     environment=env, trading_mode=mode), metadata=_metadata())`.
   - Project the **active oneof**, mirroring `get_config` `:873-875`: `cv = snapshot.values.get(key)`;
     `if cv is None: return None`; `which = cv.WhichOneof("value")`; `return str(getattr(cv, which))
     if which else None`. (This is the O1 fix — `signal.alert_threshold` is `value_type='float'`, so
     the old `string_val`-only read returned `None` regardless of scope.)
   - **Error shape (AC-2):** do **not** wrap the whole body in `except Exception: return None`. Let a
     transport `grpc.aio.AioRpcError` propagate — optionally `log`-and-`raise` it (do not swallow). A
     genuinely-absent key returns `None` via the `cv is None` branch. Update the docstring to state:
     env-scoped read; `None` only for an absent key; transport errors are raised, not swallowed.
4. **`app/tools.py` extract tools** — in **both** `extract_email_content` (`:142-145`) and
   `extract_website_content` (`:183-186`), delete the `password = await
   client.get_config_value(...)` read and the `password: str | None = None` seed. When
   `src.get("has_credentials")` is truthy, **`raise RuntimeError(...)`** with a message such as
   *"secure per-source credential resolution is not supported yet (the credential store is not
   wired); tracked as a follow-up (AC-3)."* (RuntimeError, not `ValueError` — the codebase reserves
   `ValueError` for caller-fixable input, per the design O3 ruling; no `_grpc_error_message` wrapper —
   this is not an `AioRpcError`.) The `has_credentials=False` path is unchanged: `password` stays
   `None` and the existing calls `_extract_from_bytes(raw, password=None)` `:152` /
   `_fetch_url(url, password=None, ...)` `:157,194` are unaffected. Rewrite the two CREDENTIAL CAVEAT
   docstrings (`:131-136`, `:171-175`) to state that a source requiring credentials
   (`has_credentials=True`) currently **raises** — secure resolution is a deferred follow-up — rather
   than the stale "reads a dev-scoped key and swallows to None" caveat.
5. **`app/tools.py` alert caller** (`:234`) — call
   `client.get_config_value(_ALERT_THRESHOLD_CONFIG_KEY, namespace="agent",
   environment=env, trading_mode=mode)` where `env, mode = _resolve_scope("", "")` (the agent's own
   deployment scope). Wrap the read in `try/except Exception` that logs a warning and falls back to
   `_ALERT_THRESHOLD_DEFAULT` — a **broad** `except` because this read is **post-commit** (the signal is
   already persisted at `:222`) and must never fail `ingest_signal` (a re-raised transport error or a
   lazy-import error would otherwise risk double-ingest-on-retry). This mirrors the existing broad guard
   at `:255`. Keep the existing `float(...)` / `(ValueError, TypeError)` parse guard for a malformed value.
6. **`app/oauth_server.py`** (`:70,85`) — for both reads, compute `env, mode =
   scopes.resolve_scope("", "")` (add `from app import scopes`), then call
   `client.get_config_value("oauth.registration_enabled", namespace="agent", environment=env,
   trading_mode=mode)` and likewise for `"oauth.allowed_redirect_uris"`. Wrap **each** read in
   `try/except Exception` that logs and applies the current safe default (registration **enabled** =
   treat as `None`/unset; allowlist **empty**), because these reads sit outside `register()`'s narrow
   per-branch `try` and must not 500 OAuth registration. The O1 stringify also fixes the `bool`
   `registration_enabled` projection.
7. **`tests/test_oauth.py:160-161`** — widen the hand-written stub to
   `async def _cfg(key, *, namespace, environment, trading_mode="all"):` (keyword-only to match the new
   call). No other test-file edits in this step (the new assertions are Step 2).

**Verification**:
- Signature/caller consistency (no stray positional call survives):
  `grep -n "get_config_value(" services/xstockstrat-agent/app services/xstockstrat-agent/tests -r`
  — every call passes `namespace=` and `environment=`; the two `source.{...}.credentials` reads are
  **gone** (`grep -rn "source\..*\.credentials" services/xstockstrat-agent/app/tools.py` → no match).
- Projection is oneof-based, not `string_val`-only:
  `grep -n "WhichOneof" services/xstockstrat-agent/app/client.py` → a hit inside `get_config_value`.
- No blanket swallow remains in `get_config_value`:
  `grep -n "except Exception: return None" services/xstockstrat-agent/app/client.py` → **no** match in
  the `get_config_value` body.
- Full suite green after the atomic change (existing tests, including the widened `_cfg` stub):
  `cd services/xstockstrat-agent && uv sync --extra dev && uv run pytest -q` — 0 failures.
- Lint/format: `cd services/xstockstrat-agent && ruff check . && ruff format --check .`

---

### Step 2 — test: RED-first coverage for the env-scoped projection contract, the unsupported-credential raise, and the best-effort callers

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client.py` — modify (net-new `get_config_value` cases)
- `services/xstockstrat-agent/tests/test_tools.py` — modify (extract credential-branch + alert scope)
- `services/xstockstrat-agent/tests/test_oauth.py` — modify (env-scoped best-effort assertions)
- `services/xstockstrat-agent/tests/conftest.py` — modify (add a `has_credentials=True` source fixture)

**Reviewers**: xstockstrat-agent (service owner) — MCP tool contract stability and no secret values in
tool output

**Codebase Evidence**:
- `test_client.py` has **no** `get_config_value`/`GetConfig` test today (`grep -n "get_config_value\|GetConfig"
  tests/test_client.py` → no match); it is the RED-first home. The builder/return-shape test style to
  mirror is `tests/test_backtest_view.py` (descriptor/return-shape assertions) — ledger RC-1 antidote.
- Extract credential branch has **zero** coverage: `_SOURCES` in `test_tools.py:27-49` are all
  `has_credentials: False` (`:33,40,47`); the extract tests (`:143-183` region) never exercise the
  `has_credentials=True` branch. A `has_credentials: True` source is net-new (C-13 → conftest.py; the
  two extract tools are two consumers, so it is centralized, not inline).
- Auto-alert test exists but does not assert scope: `test_ingest_signal_auto_alert_above_threshold`
  `test_tools.py:214-232` mocks `get_config_value` as an arg-agnostic `AsyncMock(return_value="0.6")`
  `:218,222`.
- OAuth DCR tests: `test_register_returns_client_id` `:134`, `test_register_disabled_returns_403`
  `:159` (the `_cfg` stub widened in Step 1).

**TDD**: `red-green required`

**Instructions**:
1. **`tests/conftest.py`** — add a shared fixture returning a source dict with
   `"has_credentials": True` (plus `slug`, `display_name`, `source_type`, `config_json` with a `url` for
   the website case, `extractor_tool`) — the C-13 canonical Python home. Both extract tests consume it.
2. **`tests/test_client.py`** — add async cases for `get_config_value`, patching the `config_pb2_grpc`
   stub / channel (mirror the existing `grpc.aio.insecure_channel` patching used elsewhere in the suite):
   - **The O1 projection contract (the decisive case, ledger RC-1):** a `ConfigValue` with a
     **`float_val`** set (e.g. `0.7`) must return the **stringified value `"0.7"`**, *not* `None` — a
     return-shape assertion over the projection, not just the request shape.
   - **Scope in the built request:** assert the outbound `GetConfigRequest` carries the passed
     `namespace` and an `environment` mapped through `_config_scope` (e.g. `environment="production"`
     → `common_pb2.ENVIRONMENT_PRODUCTION`), and that `metadata=_metadata()` is sent.
   - **Absent key → `None`:** a key missing from `snapshot.values` returns `None`.
   - **Transport error is surfaced, not swallowed:** a `grpc.aio.AioRpcError` from `GetConfig`
     propagates out of `get_config_value` (assert it raises), proving the old `except Exception: return
     None` is gone.
3. **`tests/test_tools.py`** — add:
   - `extract_email_content` and `extract_website_content` each **raise `RuntimeError`** when the source
     has `has_credentials=True` (using the conftest fixture) — `pytest.raises(RuntimeError)`.
   - The `has_credentials=False` happy paths still succeed with no credential read (already covered;
     assert no regression).
   - An alert-scope assertion: `get_config_value` for the threshold is called with
     `namespace="agent"` and a non-empty `environment` (extend the existing auto-alert test or add one),
     and a raised transport error from that read does **not** fail `ingest_signal` (best-effort — the
     signal result is still returned; a warning is logged).
4. **`tests/test_oauth.py`** — assert the DCR reads pass `namespace="agent"` + an `environment`, and
   that a raised error from `get_config_value` yields the safe default (registration still enabled;
   empty allowlist) rather than a 500.

**Verification**:
- Coverage gate (threshold 40, per the agent CI matrix):
  `cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40` — passes.
- Lint/format: `cd services/xstockstrat-agent && ruff check . && ruff format --check .`
- RED proof (P-06): the new `test_client.py` float-projection case and the extract-`RuntimeError` cases
  **fail** when run against the pre-Step-1 tree (`/sdd-execute` captures the failing run before Step 1
  and the passing run after).
- C-13: `grep -n "has_credentials.*True" services/xstockstrat-agent/tests/*.py` — the `True` source
  literal is declared once (in `conftest.py`), consumed by both extract tests; no second inline copy.
  (The pre-existing `has_credentials: True` literal at `test_tools.py:679` is a `manage_signal_source`
  **return** dict — a different shape/consumer — and stays inline.)

---

### Step 3 — docs: same-PR documentation of the unsupported-credential state and the newly-consumed config key

**Status**: `pending`
**Service**: `docs/runbooks/`, `services/xstockstrat-agent/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify (extract-tool credential behavior + error table)
- `services/xstockstrat-agent/CLAUDE.md` — modify (§ Config Keys Consumed)
- `services/xstockstrat-agent/docs/context-constitution-findings.md` — modify (resolve F-1)
- `docs/runbooks/add-data-source.md` — modify (AC-4 reinterpreted: unsupported-credential note)

**Reviewers**: none (docs)

**Codebase Evidence**:
- `docs/runbooks/mcp-tools.md` extract sections: `### extract_email_content` `:133`, its Errors table
  `:153-159` (currently lists `ValueError: PDF is password-protected but no credentials_ref is
  configured` `:159`); `### extract_website_content` `:163`. The extractor-tool mapping table
  `:117-120` and the FR-12 `credentials_ref`-never-exposed note `:123,564` are adjacent context.
- Agent `CLAUDE.md` § Config Keys Consumed lists only the two `agent.oauth.*` keys and states
  "resolved via one-shot `GetConfig` → `client.get_config_value("<bare-key>")`" — it does **not** list
  `agent.signal.alert_threshold`, which `tools.py:38,234` consumes.
- F-1 finding rows: `services/xstockstrat-agent/docs/context-constitution-findings.md:17` (latent) and
  `:37` (F-1, Track C) both cite `app/client.py:689` / `app/tools.py` extract tools + alert threshold.
- `docs/runbooks/add-data-source.md` — signal-source registration (Part 2) documents source config but
  has no per-source extraction-credential section (`grep -n "credentials_ref\|credential"
  add-data-source.md` → only the general "credentials live in xstockstrat-config" line `:53`).

**TDD**: `N/A (docs)`

**Instructions**:
1. **`docs/runbooks/mcp-tools.md`** — in both extract-tool sections, document that a source with
   `has_credentials=True` currently **raises** (secure per-source credential resolution is a deferred
   follow-up — AC-3), replacing any implication that credentials resolve from config. Update the
   `extract_email_content` Errors table (`:153-159`) to add/adjust the row for the
   `has_credentials=True` → `RuntimeError` case, and reconcile the stale `no credentials_ref is
   configured` wording with the code's actual encrypted-PDF message. Add the equivalent error row to
   the `extract_website_content` section.
2. **`services/xstockstrat-agent/CLAUDE.md`** § Config Keys Consumed — add a row for
   `agent.signal.alert_threshold` (type `float`, default `0.6`, "auto-alert conviction threshold in
   `ingest_signal`"). Do **not** add any `source.<slug>.credentials` key — it is removed and was never
   a valid governance-clean key.
3. **`services/xstockstrat-agent/docs/context-constitution-findings.md`** — mark F-1 resolved: note
   that `get_config_value` is now env/namespace-scoped with a typed-oneof projection and does not
   swallow transport errors, and that the extract tools no longer read a plaintext-config credential
   (they raise when one is required); the secure resolver (AC-3) is deferred to a follow-up feature.
4. **`docs/runbooks/add-data-source.md`** — add a short note under signal-source registration (near
   the `credentials_ref` context) that per-source extraction credentials are **not yet supported**: a
   source registered with `credentials_ref`/`has_credentials=True` will cause the extract tools to
   raise, because the platform's secret model stores secrets as `is_secret` references that `GetConfig`
   redacts (a plaintext config credential would violate C-05 and be disclosed unredacted). Point to the
   deferred follow-up (AC-3) rather than teaching operators to seed a plaintext key.

**Verification**:
- `grep -n "signal.alert_threshold" services/xstockstrat-agent/CLAUDE.md` → present.
- `grep -n "RuntimeError\|not yet supported\|deferred\|has_credentials" docs/runbooks/mcp-tools.md` →
  the new unsupported-credential behavior is documented in both extract sections.
- `grep -n "credentials_ref\|not yet supported\|unsupported" docs/runbooks/add-data-source.md` → the
  reinterpreted AC-4 note is present.
- `grep -n "F-1" services/xstockstrat-agent/docs/context-constitution-findings.md` → F-1 marked
  resolved.
- If the `context-forge` / `context-scrubber` plugin is available, run `/context-scrubber scan` scoped
  to the touched docs and fix grounded findings (root `CLAUDE.md` § Teardown); otherwise note its
  absence in the PR body.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
