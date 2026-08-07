# Design: fix-mcp-target-user-authz

**Created**: 2026-08-07
**Rounds**: 2 (quick; termination: approved)
**Approved by**: user @ 2026-08-07
**Grounded in**: recon.md

---

## Chosen Approach

Consumer surface (C-14): both changes land entirely on the Agent MCP tool surface —
`xstockstrat-agent`'s `emit_alert` and `manage_formula` tools, the only way either capability is
reached (no `xstockstrat-ui` segment calls either). See product-spec.md's `## Consumer Surface(s)`.

**1. Shared claims primitive.** Add `_require_claims(ctx: Context, tool: str) -> dict` in
`app/tools.py`, the single materialize-and-validate step: reads claims via
`_claims_from_context(ctx)` (`recon.md` → `app/tools.py:59-74`) and raises `RuntimeError` (the
existing message text from `_caller_access_scope`, `app/tools.py:87-92`) if absent. Refactor
`_caller_access_scope(ctx, tool)` (`app/tools.py:77-93`) to call it instead of duplicating the
claims-read + raise. Add a sibling `_caller_user_id(ctx, tool) -> str`, a thin wrapper over the same
`_require_claims` that additionally raises `RuntimeError` if `claims.get("user_id")` is falsy —
this closes the accidental-broadcast footgun: notify's `EmitAlertRequest.target_user_id=""` means
broadcast (`packages/proto/notify/v1/notify.proto:34`), so silently returning `""` for a
malformed/empty-subject token would make a caller who explicitly chose not to broadcast broadcast
anyway. Two thin wrappers over one shared helper, not a merged `_caller_identity(ctx) ->
tuple[user_id, scope]` — no caller needs both values in one call today (`manage_formula` forwards
no access-scope at all; `emit_alert` is documented "intentionally ungated",
`services/xstockstrat-agent/CLAUDE.md` § Management-tool authorization), and both reads are
synchronous against the same already-materialized claims dict with no await between them
(`app/tools.py:68-74`), so there is no mutation-between-calls risk to design around.

**2. `emit_alert`** (`app/tools.py:298-333`; client passthrough `client.py:189-224`, unchanged).
Add `ctx: Context` as the first parameter (mirrors `manage_strategy`, `app/tools.py:443`). Replace
`target_user_id: str = ""` with `broadcast: bool` — **required, no default** (matches the tool's
existing required params `severity`/`category`/`title`/`body`). Body: `target_user_id = "" if
broadcast else _caller_user_id(ctx, "emit_alert")`, passed into the existing
`client.emit_alert(target_user_id=..., ...)` call unchanged. `ingest_signal`'s internal auto-alert
(`app/tools.py:284-291`) is a direct `client.emit_alert(...)` call, not a call through the
`emit_alert` tool — untouched, keeps its hardcoded `target_user_id=""` system-decided broadcast.

**3. `manage_formula`** (`app/tools.py:566-659`; client passthrough `client.py:558-628`,
unchanged). Add `ctx: Context` as the first parameter. Remove `author` and `formula_author_user_id`
as caller-facing parameters entirely. Body computes `user_id = _caller_user_id(ctx,
"manage_formula")` once and uses it for both `formula["user_id"]` (consumed by update/delete,
`client.py:603-627`) and `formula["author"]` (consumed by register, `client.py:586-598`) — verified
semantically correct, not just plausible: the indicators backend's own ownership check is `row["author"]
!= request.user_id` (`services/xstockstrat-indicators/app/handlers/servicer.py:317`), i.e. the
backend itself already treats `author` and `user_id` as the same identity. Folding `author` into
this fix (beyond the two parameters the originating task named) closes a live, evidenced hole:
`services/xstockstrat-indicators/app/handlers/servicer.py:215-216` accepts `request.author` verbatim
when non-empty on register, so a caller can today register a formula with `author="system"`,
impersonating the protected `SYSTEM_AUTHOR` sentinel (`services/xstockstrat-indicators/app/formulas/__init__.py:7`,
a C-10(c) governance convention).

**No `client.py` or proto changes.** Both `EmitAlertRequest.target_user_id` and
`RegisterFormulaRequest.author`/`Update`/`DeleteFormulaRequest.user_id` already exist on the wire
and already accept plain strings — this feature only changes what value `app/tools.py` computes
before calling the unchanged client methods.

**Tests** (C-08, P-06 red-before-green): update every breaking call site in
`services/xstockstrat-agent/tests/test_tools.py` — the `target_user_id=""` assertion (~line 318),
every `manage_formula(...)` call passing `formula_author_user_id=`/`author=` with no `ctx=`
(~lines 693,696,699,711,1156,1178,1181,1194,1197,1208,1211,1220,1221), and add: (a) a direct unit
test of `_require_claims`/`_caller_user_id` raising on `_ctx(None, with_request=False)` (via
`tests/conftest.py:17-27`) — this is the shared surface both `_caller_access_scope` and the two new
call sites now depend on, so it must be tested directly, not just transitively through one tool; (b)
a happy-path claims-derivation test for each tool; (c) an `emit_alert` broadcast-vs-targeted case.
`/sdd-spec` must enumerate the full call-site list explicitly, not approximate it.

**Docs**: `docs/runbooks/mcp-tools.md` — full rewrite of both tools' parameter and error-code
tables (old rows no longer apply, not an incremental edit). Confirmed during recon: no
`plugins/strat-lab/` reference to either tool's removed parameters — no skill update needed.

## Rejected Alternatives

- **Keep `emit_alert`'s target-user parameter and validate it server-side against the caller's own
  id instead of removing it** — rejected: still leaves a caller-suppliable identity parameter that
  must be checked rather than derived, the same shape `docs/roadmap/ledger/insights.md` (2026-08-06,
  unify-admin-auth-gates) already warns against ("never trust a blob... always re-derive identity
  from a fresh, validated credential").
- **Gate `broadcast=True` behind the caller's derived ADMIN scope** — rejected for this round: out
  of scope per product-spec (`EmitAlert`'s RPC-level authorization model is explicitly out of
  scope, and feature 092 already ruled against admin-gating this RPC for its non-MCP internal
  callers, `docs/roadmap/ledger/insights.md` 2026-08-02). Worth a follow-up if a reviewer wants
  least-privilege on the broadcast path specifically.
- **Hard-flip `emit_alert`'s default from broadcast-on to self-only (`broadcast: bool = False`)** —
  rejected in round 2: closes the same vulnerability as the chosen approach, but fails **silently**
  — a caller who omits `broadcast` expecting the tool's current broadcast default gets a narrower,
  wrong-but-unremarked delivery instead of an error. `broadcast` as a **required** parameter (no
  default) closes the identical hole and fails loud instead.
- **Defer the `author` parameter to a follow-up bug, keeping this fix scoped to only the two
  product-spec-named parameters** — rejected: leaves a live, evidenced `author="system"`
  sentinel-impersonation hole open in the same tool, for no real savings (the fix is the same
  `_caller_user_id` call, already being made for `user_id`).
- **Merge `_caller_user_id`/`_caller_access_scope` into one `_caller_identity(ctx) -> tuple[str,
  int]`** — rejected: no caller in this codebase needs both values from a single call; a tuple
  return optimizes for a coupling that doesn't exist, and two thin single-purpose wrappers over one
  shared `_require_claims` avoid the duplication without over-generalizing.
- **Backfill `RuntimeError`-branch test coverage for the four pre-existing admin-gated tools
  (`manage_strategy`, `manage_signal_source`, `set_strategy_live`,
  `trigger_backfill`/`cancel_backfill`)** — rejected: those tools' behavior is unchanged by this
  fix (root CLAUDE.md operating rule 3, "touch only what the task requires"); the new shared
  `_require_claims` primitive is instead tested directly, which transitively covers all six eventual
  callers' raise path without touching the other five tools' own test files.

## Open Risks

- [ ] Requiring OAuth claims (via `_caller_user_id`) for `emit_alert`/`manage_formula` going
      forward is a new hard requirement — recon found no non-Streamable-HTTP caller of these two
      *tools* (as opposed to the underlying RPCs), but this is an absence-of-evidence finding, not a
      positive one. If a caller outside the OAuth-gated Streamable HTTP transport exists, it will now
      get a `RuntimeError` instead of silently succeeding. To be watched at `/sdd-execute` and in the
      PR's test-plan smoke check — to be addressed at implementation-spec Step covering
      `emit_alert`/`manage_formula`.
- [ ] `broadcast: bool` becoming a required parameter (mandatory schema change) breaks any external
      MCP client caller currently invoking `emit_alert` without `target_user_id`/`broadcast` at
      all — accepted as the correct fail-loud tradeoff (see Rejected Alternatives), but the actual
      blast radius on real callers (beyond this repo's own tests and `ingest_signal`'s internal
      call, which bypasses the tool) was not exhaustively enumerable from recon. To be addressed at
      implementation-spec Step covering `emit_alert`.

## Constitution Rules Touched

- `C-01` (zero-assumption / evidence-cited) — honored: every claim above cites `recon.md`
  `path:line`; the `author`↔`user_id` semantic-equivalence claim was independently re-verified
  against `services/xstockstrat-indicators/app/handlers/servicer.py:317` in round 2 rather than
  assumed from the field names.
- `C-03` (propagate platform headers, `x-user-id`/`x-access-scope`/`x-trace-id`) — honored in
  spirit: the agent is the OAuth edge for MCP calls (per `insights.md` 2026-08-06,
  broker-state-reconciliation entry — this platform's authz headers are originated once at the edge
  after authenticating a real human, then only forwarded internally); this feature originates the
  caller identity at that edge into the request *body* fields both RPCs already define, since
  neither RPC currently reads an `x-user-id` header.
- `C-08` (test-step pairing) / `P-06` (red-before-green) — honored by: the implementation spec must
  enumerate every breaking `test_tools.py` call site plus new tests for the raise-on-missing/empty
  identity path, proven red before the fix and green after.
- `C-10` (integration completeness across shared surfaces) — honored: `_require_claims` is a new
  shared surface consumed by `_caller_access_scope` (refactored) and the two new call sites; it
  gets its own direct test rather than relying on transitive coverage through one consumer, without
  over-reaching into backfilling the four unrelated tools' pre-existing gap (root CLAUDE.md rule 3).
- `C-11` (no feature implementation without SDD grounding) — honored: this bug fix was routed
  through `/sdd-triage` → this `/sdd-design quick` pass per bug-triage's Track C, not implemented
  directly.
- `C-14` (name the consumer surface) — honored: `product-spec.md` now carries a `##
  Consumer Surface(s)` section naming both MCP tools explicitly (patched during this design round).
- `F-04` / `P-03` (never invent; escalate ambiguity) — honored: the `author` parameter's inclusion
  was surfaced explicitly in `recon.md` and confirmed via a design round rather than silently
  absorbed or silently dropped; no `path:line` in this design was invented.
- No Floor (`F-*`) breach identified in either debate round.
