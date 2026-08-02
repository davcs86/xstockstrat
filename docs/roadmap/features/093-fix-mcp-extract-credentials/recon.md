# Recon: fix-mcp-extract-credentials

**Created**: 2026-08-02
**From**: product-spec.md
**Affected services**: xstockstrat-agent, xstockstrat-ingest, xstockstrat-config

---

## Objective

The extract tools gate on `has_credentials` (from ingest's `credentials_ref`) but resolve the secret
from an unrelated store — config key `source.<slug>.credentials` via `client.get_config_value`, which
hardcodes `namespace="agent"`, sends **no environment** (config defaults to **dev**), and **swallows
every error to `None`** (F-1, RC-5). A production agent thus reads a dev-scoped key and silently
degrades to an unauthenticated fetch. Fix so credential reads are environment-scoped and failures are
surfaced, not swallowed.

## Codebase Map

- **`xstockstrat-agent`** (Python MCP)
  - `app/client.py`: **`get_config_value(key)`** `:678-695` — `GetConfig(GetConfigRequest(namespace="agent"))`
    at `:689` (namespace hardcoded, **no** `environment`/`trading_mode`/`metadata`), `except Exception:
    return None` `:694-695`. Contrast comment naming all three flaws `:837-839`.
  - `_config_scope(environment, trading_mode)` (feature 073, the interim pattern to mirror) `:842-857`;
    reference callers doing it right (`get_config` `:860-869`, `list_config_keys` `:888-898`).
  - `_metadata()` (`x-mcp-secret`) `:24-27`.
  - `app/tools.py`: extract-tool credential lookups — `extract_email_content` `:143-145`,
    `extract_website_content` `:184-186` (`get_config_value(f"source.{slug}.credentials")`); a `None`
    password degrades silently (`_extract_from_bytes`/`_fetch_url` `:152/157/194`; PDF branch
    `:891-895`). `_resolve_scope` (env from `APPLICATION_ENV`/`TRADING_MODE`) `:729-734`. Docstrings
    already warn of the caveat `:131-136,171-175`.
  - **Other `get_config_value` callers** (inherit the env-blind read): `signal.alert_threshold`
    `tools.py:234` (const `:37-38`, default 0.6); OAuth `oauth.registration_enabled` /
    `oauth.allowed_redirect_uris` `oauth_server.py:70,85` — these two are **genuinely** `agent.*`
    namespace, so the hardcoded namespace is correct for them; only the missing env + swallow affect them.
  - Tests: `tests/test_tools.py` — `_SOURCES` all `has_credentials:False` `:27-49` (no credential-branch
    test exists); the only `get_config_value` mocks are the alert path `:196,222` + OAuth. **No
    `get_config_value`/`GetConfig` test in `tests/test_client.py`** (RED-first home).
  - Finding: `docs/context-constitution-findings.md:37` (F-1) + `:17` (latent) + `:11` (doc-lies).
- **`xstockstrat-ingest`** (Python, gRPC 50055)
  - `credentials_ref` is a **nullable free-text `TEXT`** column (`migrations/002_add_signal_sources_registry.up.sql:5,12`)
    — an **opaque, unvalidated pointer that nothing resolves anywhere**. Test data mixes
    `secret.aw.token` (config-key) and `vault://x` (vault) styles — no format enforced.
  - `ManageSignalSource` stores it verbatim (`servicer.py:941`), `ListSignalSources` **redacts** it
    (returns only `has_credentials` `:901,973`). No resolve/dereference code exists.
  - Proto: `SignalSource` deliberately omits `credentials_ref` (`ingest.proto:134`); it's write-only on
    the request (`:171`). **No `ResolveSourceCredential` RPC** (8 RPCs, last `ManageSignalSource` `:23`).
  - **No `x-mcp-secret` enforcement anywhere in ingest**; only `_has_admin_scope` (0x04) `:145-159`.
    `ConfigWatcher.get_str` `watcher.py:60-66` holds only the `ingest` namespace.
- **`xstockstrat-config`**: scope semantics — `GetConfigRequest{namespace, environment, trading_mode}`;
  `resolveEnv(undefined) → dev` (the root cause of the wrong scope). No change needed if the agent
  sends the right scope.

## Patterns to REUSE

- **Env-scoped config read** → mirror `_config_scope` (`client.py:842-857`) + `_resolve_scope`
  (`tools.py:729-734`), exactly as `get_config`/`list_config_keys` already do. Parameterize
  `get_config_value(key, namespace, environment, trading_mode)` and send `metadata=_metadata()`.
- **Client-level request-builder test** → mirror the descriptor/builder assertion style
  (`tests/test_backtest_view.py`) — assert the built `GetConfigRequest` carries the right
  namespace + environment (net-new in `test_client.py`).
- **Error surfacing** → distinguish a transport `AioRpcError` (log/raise) from a legitimate
  "key absent" (still `None`) — mirror `set_config`'s fail-closed `except AioRpcError` idiom
  (`tools.py`).

## Dependencies

- Proto/RPC: **interim → none.** (Radical would add `ResolveSourceCredential` to `ingest.proto` after
  `:23` — additive; `SignalSource` next field 12.)
- Migration: none. Config keys: standardize the credential key + document its namespace/scope.
- Inter-service edges: unchanged (interim). Radical would add agent→ingest `ResolveSourceCredential`.
- New env vars/ports: none.

## Risks / Not-found

- **The design fork (interim vs radical) is decided by one recon fact:** `credentials_ref` has **no
  defined resolution convention** — it is opaque free-text that nothing in the platform resolves, and
  test data mixes `secret.*` and `vault://` styles. So the "radical" ingest-`ResolveSourceCredential`
  path is **not a deferred caller of a known change** — it requires *inventing* a credential-resolution
  architecture (what a ref means, which store/namespace/env, a resolver, net-new `x-mcp-secret`
  enforcement in ingest). That is a separate, larger, underspecified feature, disproportionate to a
  SEV-2 bug. The interim fix fully meets AC-1/AC-2/AC-4; AC-3 (radical) is explicitly conditional ("if
  chosen"). The debate must rule and, if interim, record the deferral rationale.
- **`signal.alert_threshold` shares the bug** — its read is also env-blind + swallowed (so the
  threshold is effectively always the 0.6 default today). The interim fix should correct this caller
  too (fix-every-affected-caller), deciding its namespace (`signal` vs `agent`).
- **Namespace decision**: `source.<slug>.credentials` and `signal.alert_threshold` are read against the
  hardcoded `agent` namespace today; the OAuth keys genuinely belong to `agent`. The interim fix must
  set the right namespace per caller (a bare `get_config_value(key)` can't assume `agent`).
- **RC-1 drift trap** (`fails.md` 2026-08-02): a client request-builder with no descriptor/scope test
  silently regressed — add a `test_client.py` assertion on the built `GetConfigRequest` scope.
- **074 zero-assertion trap** does not apply (agent is pytest), but the credential-branch of the
  extract tools has **zero** existing test coverage — a `has_credentials:True` fixture is net-new.

## Recommended Scope (advisory — the debate confirms)

Interim, minimal-but-complete for AC-1/AC-2/AC-4:
1. **agent client** — `get_config_value(key, *, namespace, environment, trading_mode)` mirroring
   `_config_scope`; send `metadata=_metadata()`; stop swallowing — surface a transport error, keep
   `None` only for a genuinely-absent key. Paired `test_client.py` scope-assertion test.
2. **agent tools** — extract tools resolve the credential at the agent's real environment (via
   `_resolve_scope`) under the standardized namespace/key; a failed resolution is surfaced/logged, not
   a silent unauthenticated fallback. Fix the `signal.alert_threshold` caller the same way. Paired
   tests (a `has_credentials:True` credential-branch test).
3. **docs** — `docs/runbooks/add-data-source.md` per-environment credential seeding; agent CLAUDE.md
   config-keys + the credential key; agent findings F-1 resolved; `mcp-tools.md` extract-tool credential
   caveat updated. Record AC-3/radical as explicitly deferred (with the `credentials_ref`-is-opaque
   rationale) — a future feature if a credential-resolution convention is defined.
