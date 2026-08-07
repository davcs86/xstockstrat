# Recon: fix-mcp-target-user-authz

**Created**: 2026-08-07
**From**: product-spec.md
**Affected services**: xstockstrat-agent

---

## Objective

`emit_alert` and `manage_formula` accept caller-supplied user-identity parameters
(`target_user_id`, `formula_author_user_id`, and — newly found during recon — `author`) that are
never checked against the OAuth-authenticated caller. Replace all three with a value derived from
the caller's verified claims, mirroring the claims-derivation pattern feature 092 already
established for `x-access-scope`.

## Codebase Map

- **`xstockstrat-agent`** (Python)
  - OAuth edge: `_authorized` — `app/main.py:146-175` — validates the bearer JWT and publishes
    claims onto `scope["state"][MCP_CLAIMS_SCOPE_KEY]`.
  - Claims validation: `validate_bearer_claims(token)` — `app/auth.py:50-86` — returns
    `{"user_id": claims.user_id, "email": ..., "roles": [...], "aud": ...}` on success, `None` on
    failure. `user_id` is a `str`, already the exact verified-caller value needed.
  - Claims key: `MCP_CLAIMS_SCOPE_KEY = "mcp_claims"` — `app/scopes.py:20`.
  - Existing claims-read helpers — `app/tools.py`:
    - `_claims_from_context(ctx)` (`:59-74`) — reads the claims dict off `ctx`, returns `None` if
      absent.
    - `_caller_access_scope(ctx, tool)` (`:77-93`) — turns `claims["roles"]` into a derived
      `x-access-scope` bitmask; **raises `RuntimeError`** if `_claims_from_context` returns `None`
      (no claims / non-Streamable-HTTP transport).
  - Established caller-derived-scope pattern (feature 092), representative call site
    `manage_strategy` — `app/tools.py:552-561`:
    ```python
    # feature 092: forward the caller's REAL derived scope (was a hardcoded admin 7); the
    # analysis ManageStrategy backend enforces the ADMIN bit, so a non-admin is rejected there.
    access_scope = _caller_access_scope(ctx, "manage_strategy")
    ```
    mirrored at `manage_signal_source` (`:733`), `set_strategy_live` (`:761`),
    `trigger_backfill`/`cancel_backfill` (`:794`/`:846`), `set_config` (`:1015`); each of these
    tool functions **declares `ctx: Context`** as a parameter so the MCP SDK injects it.
  - `_metadata()` — `app/client.py:29-30` — always returns `[]`; per-call metadata (e.g.
    `x-access-scope`) is appended by the caller, not baked in.
  - Admin-scoped client write pattern, representative — `client.py:448-453`:
    ```python
    meta = [*_metadata(), ("x-access-scope", str(access_scope))]
    ```
  - Test claims fixtures — `tests/conftest.py:12-14` (`ADMIN`/`TRADER`/`VIEWER`, each with a
    `user_id`), and `_ctx(claims, *, with_request=True)` (`:17-27`) — `with_request=False`
    exercises the "no claims" branch.
  - Admin-gated tool test mock pattern — `tests/test_tools.py:633-641`: `ctx=_ctx(ADMIN)` passed
    to the tool call, asserted via `m.call_args.kwargs`.

## Target-parameter inventory (what changes)

1. **`emit_alert`'s `target_user_id`** — tool `app/tools.py:298-333` (no `ctx` param today);
   client `client.py:189-224` builds `EmitAlertRequest(target_user_id=target_user_id, ...)`
   (`:212`), sent with plain `metadata=_metadata()` (`:223`, no access-scope — matches the
   documented "EmitAlert intentionally ungated" posture, `services/xstockstrat-agent/CLAUDE.md` §
   Management-tool authorization). `ingest_signal`'s internal auto-alert (`app/tools.py:284-291`)
   already hardcodes `target_user_id=""` (a system decision, not caller input) — out of scope.
   Proto: `packages/proto/notify/v1/notify.proto:34` (`Alert.target_user_id`, "empty = broadcast"),
   `:56` (`EmitAlertRequest.target_user_id`, field 6).

2. **`manage_formula`'s `formula_author_user_id`** — tool `app/tools.py:566-659` (no `ctx` param
   today); placed into the outgoing dict unconditionally as `"user_id"` (`:629`), consumed by
   `client.manage_formula`'s `update`/`delete` branches only (`client.py:603-619`, `:621-627`) as
   `UpdateFormulaRequest.user_id` / `DeleteFormulaRequest.user_id`
   (`packages/proto/indicators/v1/indicators.proto:197`/`:217`, doc comment: "must match
   formula.author; returns PERMISSION_DENIED otherwise" — the indicators backend already rejects a
   mismatch against the real stored author).

3. **`manage_formula`'s `author`** (found during recon, not named in product-spec — see Risks) —
   same tool, used only by the `register` branch (`client.py:586-598`,
   `RegisterFormulaRequest.author`, field 6). Proto doc comment:
   `packages/proto/indicators/v1/indicators.proto:169`: **"set by BFF from JWT claims; stored
   immutably"** — i.e. the proto contract already assumes this value comes from auth, not
   caller-supplied free text, which is exactly this defect's shape for the register path too.

## Patterns to REUSE

- Claims-derivation plumbing → reuse `_claims_from_context`/`_caller_access_scope`
  (`app/tools.py:59-93`) and the `ctx: Context` parameter convention already used by the four
  admin-gated tools + `set_config` — do not invent a second claims-reading path.
- Metadata-building convention → reuse `_metadata()` + tuple-append shape (`client.py:29-30`,
  `:448-453`) if any outbound header needs to change (see Risks — `emit_alert`/`manage_formula`
  currently send **no** access-scope or user-id metadata at all; this feature's job is the request
  *body* field, not new outbound metadata, unless the design decides otherwise).
- Test mocking → reuse `tests/conftest.py` `_ctx`/`ADMIN`/`TRADER`/`VIEWER` fixtures
  (`:12-27`) and the `ctx=_ctx(...)` call pattern (`tests/test_tools.py:633-641`) for new
  `emit_alert`/`manage_formula` tests.

## Dependencies

- Proto/RPC: no proto changes — `EmitAlertRequest.target_user_id` (field 6),
  `RegisterFormulaRequest.author` (field 6), `UpdateFormulaRequest.user_id` /
  `DeleteFormulaRequest.user_id` (field 2 each) all already exist and already accept a string; only
  the agent's *source* for populating them changes, from a tool parameter to derived claims.
- Migration: none.
- Config keys: none.
- Inter-service edges: unchanged (`xstockstrat-agent` → `xstockstrat-notify` `EmitAlert`,
  `xstockstrat-agent` → `xstockstrat-indicators` `Register/Update/DeleteFormula`).
- New env vars / ports: none.

## Risks / Not-found

- **Scope question**: product-spec named only `target_user_id` and `formula_author_user_id`; recon
  found a third, same-shape parameter (`manage_formula`'s `author`, register-only) whose own proto
  doc comment says it should come from JWT claims. Per Constitution P-03 (no silent deviation),
  this is surfaced here for the grilling round to decide in-scope or explicitly deferred — not
  silently absorbed or silently dropped.
- **Capability-loss question** (already flagged in product-spec's "Design Question"): removing
  `target_user_id` removes `emit_alert`'s ability to broadcast/address another user through the
  MCP tool. `_caller_access_scope` raises `RuntimeError` when claims are absent (non-Streamable-HTTP
  transport) — if `emit_alert`/`manage_formula` start requiring claims via the same helper, calling
  them outside the OAuth-gated Streamable HTTP transport (if any such caller exists) would newly
  fail. No non-HTTP caller of these two *tools* (as opposed to the RPCs) was found in recon.
- **`fails.md` 2026-08-05 (live-strategy-alert-engine, "header")**: near-miss forwarding a blanket
  admin scope from an unauthenticated-for-admin entry point — verify the upstream entry point
  (`_authorized`/`validate_bearer_claims`) actually authenticates before trusting `claims["user_id"]`
  as the identity forwarded downstream. Already true here (`_authorized` requires a valid bearer
  JWT), but worth an explicit note in design.md since this is precisely the failure mode it warns
  against.
- **`insights.md` 2026-08-06 (broker-state-reconciliation, "design")**: this platform's authz
  headers carry one trust shape — the edge originates them once after authenticating a real human;
  internal services only forward. The agent *is* that edge for MCP calls, so originating
  `x-user-id`-equivalent identity here (in the request body, since neither RPC currently reads an
  `x-user-id` header) is consistent with the established trust model, not a new primitive.
- **Out of scope, confirmed no overlap**: `notify.EmitAlert`'s RPC-level gating (feature 092
  deliberately left it ungated as an internal-service-caller contract — not being revisited here).
- **Not found**: any mention of `target_user_id`, `formula_author_user_id`, `author`, `emit_alert`,
  or `manage_formula` anywhere under `plugins/strat-lab/` — no skill update needed for this fix.
- **Not found**: an existing test exercising `_caller_access_scope`'s `RuntimeError` (no-claims)
  branch for these two tools specifically (none exists today since neither tool calls it yet) — new
  tests will need to add this case.

## Recommended Scope

One step, single service (`xstockstrat-agent`):
1. Add `ctx: Context` to `emit_alert` and `manage_formula`; remove `target_user_id`,
   `formula_author_user_id` (and, pending the grilling decision, `author`) as caller-facing
   parameters; derive the identity from `_claims_from_context(ctx)["user_id"]` (raising the same
   `RuntimeError`-via-`_caller_access_scope`-equivalent path on missing claims); update
   `client.py` call sites accordingly; update tests (`tests/test_tools.py`,
   `tests/conftest.py` if a new helper is needed); update `docs/runbooks/mcp-tools.md` rows for
   both tools' parameter/error tables.
