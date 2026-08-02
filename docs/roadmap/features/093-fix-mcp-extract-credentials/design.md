# Design: fix-mcp-extract-credentials

**Created**: 2026-08-02
**Rounds**: 2 (full) — proposer/adversary each round, mediated
**Grounded in**: recon.md

## Chosen Approach — **option (c): env-scope the legitimate reads; make extract credentials loudly unsupported**

The extract-tool credential capability **never worked** (the `source.<slug>.credentials` key is seeded
in no migration) and **cannot** work under config governance (secrets are `is_secret` references that
`GetConfig` redacts — a plaintext credential would be *disclosed* unredacted by the `get_config` tool,
which redacts only on the `is_secret` flag, `tools.py:757-759`). So rather than entrench a plaintext
antipattern (C-05 / config invariant #6), the extract tools **surface** the gap (AC-2), and the real
env-scope fix ships for the legitimate callers.

### 1. `get_config_value` — env-scoped, typed projection, non-swallowing (`client.py:678-695`)
`async def get_config_value(key: str, *, namespace: str, environment: str, trading_mode: str = "all") -> str | None`.
Build `GetConfigRequest(namespace, <_config_scope(environment, trading_mode)>)` and send
`metadata=_metadata()` — the pattern `get_config`/`list_config_keys` already use (`:860,888`).
- **Value projection (adversary R2 O1 — the hidden bug):** return the **active oneof stringified**,
  mirroring `get_config` (`client.py:872-876` `cv.WhichOneof("value")` → `str(getattr(cv, which))`) —
  **not** `v.string_val or None`. `signal.alert_threshold` is seeded `value_type='float'`
  (`config migrations/004:8,11`), so the old `string_val`-only read returned `None` for it *regardless*
  of scope; the env-fix alone would not have fixed it. (Also fixes the `bool` OAuth key, O4.)
- **Error shape (AC-2):** a transport `grpc.aio.AioRpcError` is logged and **re-raised**; a
  genuinely-absent key (`values.get(key) is None`) returns `None`. `namespace`+`environment` are
  **required** keyword args (anti-regression against the implicit-`agent`/implicit-dev bug).

### 2. Extract tools — remove the credential read; raise when creds are required (`tools.py:143-145,184-186`)
Delete the `get_config_value(f"source.{slug}.credentials")` read. When `has_credentials=True`, **raise
`RuntimeError`** (adversary R2 O3 — not `ValueError`, which the codebase reserves for caller-fixable
input; no `_grpc_error_message` wrapper — it isn't an `AioRpcError`): *"secure per-source credential
resolution is not supported yet (the credential store is not wired); tracked as a follow-up (AC-3)."*
`has_credentials=False` is unchanged (the unauthenticated fetch is correct — `password` stays `None`;
`_extract_from_bytes`/`_fetch_url` already default it, and the encrypted-PDF-without-creds case still
raises its own `ValueError` at `:895`). Rewrite the two CREDENTIAL CAVEAT docstrings (`:131-136,171-175`).

### 3. `signal.alert_threshold` (`tools.py:234`) — env-scoped, best-effort
Namespace stays `agent` (C-05-compliant, seeded both envs). Pass the agent's real `environment`. Wrap
the read `except Exception → log warning + use _ALERT_THRESHOLD_DEFAULT (0.6)` (adversary R2 O2 — broad
`Exception`, matching the existing auto-alert guard at `tools.py:255`, because this read sits **after**
the signal is already persisted (`:222`) and must never fail `ingest_signal` — a re-raised transport
*or* a lazy-import error would otherwise fail an already-ingested signal → double-ingest-on-retry risk).

### 4. OAuth keys (`oauth_server.py:70,85`) — env-scoped, best-effort
Namespace `agent`; pass the real `environment`; wrap `except Exception → log + safe default`
(registration enabled=true; allowlist="") — they sit outside `register()`'s narrow `try` and must not
500 OAuth registration. The O1 stringify fixes the `bool` `registration_enabled` read too (O4).

### 5. Shared env/mode normalization (`app/scopes.py`)
Lift the env/mode normalizer out of the nested `_resolve_scope` (`tools.py:729`, currently a closure
inside `register_tools`) into `app/scopes.py` (verified: no circular import — `scopes.py` imports
nothing from `tools`/`client`); `_resolve_scope` delegates, and `oauth_server.py` uses it (it can't
reach a closure-local function).

### 6. Atomicity (F-05)
The signature change (required kwargs) + **all** remaining callers + **all** mocks move in one step —
`tools.py:234`, `oauth_server.py:70,85`, and the hand-written `test_oauth.py:160-163` `async def _cfg(key)`
stub (widen to `_cfg(key, *, namespace, environment, trading_mode="all")`, adversary R2). The extract
reads are *removed*, not re-signatured. (`test_tools.py:196,222` are arg-agnostic `AsyncMock`.)

## Per-AC coverage
- **AC-1** (env-scoped reads): required `environment` kwarg + typed projection.
- **AC-2** (surface, don't swallow): transport error re-raised in `get_config_value`; the extract tools
  **raise** instead of a silent unauthenticated fetch; best-effort callers log + default (a surfaced
  *warning*, not a swallowed `None`).
- **AC-3** (radical): **deferred** — `credentials_ref` is opaque free-text with no resolution
  convention; a real resolver (ingest `ResolveSourceCredential` gated by `x-mcp-secret`, or server-side
  extraction) is a separate feature, not a bounded interim fix.
- **AC-4** (per-env seeding doc): **reinterpreted** — there is no governance-clean plaintext credential
  to seed, so `add-data-source.md` documents the *unsupported* state + the follow-up rather than
  teaching a plaintext antipattern.

## Rejected Alternatives
- **Option (a) — env-fix + keep the plaintext credential config read + document seeding it** — breaches
  C-05 / config invariant #6; the `get_config` tool would disclose the plaintext credential unredacted;
  AC-4 would teach operators to store passwords as plaintext config.
- **Option (b) — `secret.*`-prefixed `is_secret` credential reference** — governance-correct in name,
  but `GetConfig` returns the *redacted* reference, so the password never materializes; collapses into
  the radical.
- **Radical now (AC-3)** — inventing a credential-resolution convention (ref format, store, resolver,
  net-new ingest `x-mcp-secret` gate) is a separate, larger, underspecified feature.
- **Re-type `signal.alert_threshold` to `string` via a migration** (to dodge O1) — leaves
  `get_config_value` a string-only footgun for the next typed caller and the OAuth `bool` key broken;
  the typed-projection fix is the durable one.
- **Keep the narrow `AioRpcError` catch on the best-effort callers** — a non-transport error would then
  fail a post-commit read; broad `except Exception` is the correct posture there (mirrors `:255`).

## Open Risks
- **AC-3/AC-4 reinterpretation (design-gate resolution).** Secure per-source extract credentials are
  deferred; a source with `has_credentials=True` now *raises* rather than silently failing. Recorded;
  reopen if the user wants the credential resolver built now (a much larger feature). Target: spec docs.
- **O1 is a projection contract, not just a scope fix** — the RED `test_client.py` case must use a
  **`float_val`** `ConfigValue` fixture and assert the *stringified value* (`"0.7"`), not just the
  request shape (ledger RC-1: the antidote is a return-shape test over the builder/projection, else
  this repeats the drift). Target: Step test.
- **Best-effort catches use broad `except Exception`** — intentional (post-commit / outside-try reads);
  a warning is logged so it isn't silent. Target: alert/oauth test steps.

## Constitution Rules Touched
- **C-05 / F-07 / config invariant #6** — resolved by *removing* the plaintext credential read (no
  hardcoded/plaintext secret; no harmful doc).
- **C-08 / P-06** — every code step paired RED-first, incl. the O1 typed-projection test and the
  best-effort catch tests.
- **C-13** — the `has_credentials:True` source fixture goes in `tests/conftest.py`.
- **C-10** — same-PR docs: two extract docstrings, `mcp-tools.md`, agent `CLAUDE.md` § Config Keys
  Consumed (add `signal.alert_threshold`; the credential key is removed), findings F-1 resolved,
  `add-data-source.md` (unsupported state + follow-up).
- **F-05** — atomic signature+caller+mock change (no intermediate `TypeError`).
- **F-04 / C-01** — grep-verified: `source.<slug>.credentials` seeded in zero migrations; exactly 5
  `get_config_value` callers.
- **C-11 / P-03** — the option-(c) reframe and the AC-3/AC-4 reinterpretation surfaced explicitly.
- No proto / migration change.
