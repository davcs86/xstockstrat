# Recon: fix-mcp-writepath-authz

**Created**: 2026-08-02
**From**: product-spec.md
**Affected services**: xstockstrat-ingest, xstockstrat-notify, xstockstrat-agent

---

## Objective

Write-path authorization is asymmetric (F-11): ingest gates `CancelBackfill`/`ManageSignalSource`
on the admin bit but **not `TriggerBackfill`** (the quota-spending op); notify's `EmitAlert` is fully
ungated; and the agent forwards a **hardcoded** admin `x-access-scope=7` on its write tools that
nothing verifies as the real caller's role (except `set_config`, feature 073). Gate `TriggerBackfill`
server-side, make a deliberate `EmitAlert` gating decision, and extend the 073 caller-derived-scope
pattern to the remaining hardcoded-admin tools — **backends gated first, agent flipped second**.

## Codebase Map

- **`xstockstrat-ingest`** (Python, gRPC 50055)
  - `app/handlers/servicer.py`: `_has_admin_scope(context)` (`access_scope & 0x04`) `:145-159`;
    `_propagation_meta` `:161-167`; **`TriggerBackfill` UNGATED** `:169-203` (only `self._db is None`
    guard `:170-172`; queues + spawns runner unconditionally); `CancelBackfill` gated `:578-589`
    (`if not self._has_admin_scope(context): abort(PERMISSION_DENIED, "admin scope required")`);
    `ManageSignalSource` gated `:912-918`
  - Tests: `tests/test_cancel_backfill.py:34-45` (`_ctx(access_scope)` builder, `_ctx("4")`=admin;
    gate assertion `:69-75`); `tests/test_ingest_servicer.py:257-316` (`TestTriggerBackfill` — uses
    **bare `MagicMock()`**, no metadata → **will break** under the gate); ManageSignalSource gate
    test `:867-907`
- **`xstockstrat-notify`** (Node.js/TS, gRPC 50059)
  - `src/grpc/notifyServiceImpl.ts`: `emitAlert(call, callback)` `:30` reads only `call.request`
    `:31` (no metadata/scope/secret); DB write `:36-58`; synchronous fan-out `:77-86`. RPCs:
    `emitAlert`/`streamAlerts`/`acknowledgeAlert`/`listAlerts` — **none reads metadata**
  - **No authz helper, no `x-mcp-secret` handling anywhere in notify**; `src/middleware/propagation.ts`
    is the dead HTTP-era store (never imported by the gRPC path); numeric `code: 13` error style `:95`
  - Tests: `src/__tests__/notifyServiceImpl.test.ts` run against **source `.ts`** (`package.json:12`
    `node --experimental-strip-types --test src/__tests__/*.test.ts`), lazy-import skip guard
    (`if (!NotifyServiceImpl) return;`) — 074-style zero-assertion risk; emitAlert tests build
    `call = { request: {...} }` with no `metadata` `:120-158`
- **`xstockstrat-agent`** (Python MCP)
  - `app/client.py`: `_admin_metadata()` (hardcoded `("x-access-scope","7")`) `:30-32`; used by
    **exactly four** tools — `manage_strategy` (`:343`), `manage_signal_source` (`:520`),
    `set_strategy_live` (`:662`), `trigger_backfill` (`:767`). `manage_formula` uses plain
    `_metadata()` (`:445/459/467`, ownership-based — **NOT** a hardcoded-admin write). `set_config`
    takes `access_scope: int` and sends `[*_metadata(), ("x-access-scope", str(access_scope))]` `:960`
  - `app/tools.py`: `set_config` is the only tool with `ctx: Context` `:786-787`; claims via
    `_claims_from_context(ctx)` `:43-58,829-836`; `roles_to_access_scope(claims.get("roles"))` `:858`.
    The four hardcoded tools **lack `ctx`**: `manage_strategy` `:391-402`, `manage_signal_source`
    `:578-587`, `set_strategy_live` `:620-624`, `trigger_backfill` `:642-650`
  - `app/scopes.py`: `roles_to_access_scope` (viewer→1, trader→11, admin→15; `&0x04`=ADMIN) `:26-41`;
    `MCP_CLAIMS_SCOPE_KEY` `:18`
  - `docs/context-constitution.md`: **AGENT-3** `:17` (hardcoded `_admin_metadata()` on write RPCs;
    set_config exception; **evidence line refs are stale**), **AGENT-4** `:18` (073 amendment scoped
    to set_config only) — both must be re-forged when the pattern generalizes
  - Tests: `tests/test_config_tools.py:184-227` (`TestSetConfigForwardsRealScope` template — admin→15,
    trader→11; `_ctx(claims)` `:37`); `tests/test_client.py` per-tool classes assert the hardcoded
    `"7"` today (`manage_strategy` `:102`, `set_strategy_live` `:295`, `trigger_backfill` `:328`;
    `manage_signal_source` asserts no scope `:254-256`) — **these flip**

## Patterns to REUSE

- **Ingest TriggerBackfill gate** → copy the two-line `CancelBackfill` gate verbatim
  (`servicer.py:587-589`), placed after the `self._db is None` check; reuses `_has_admin_scope`.
- **Agent caller-derived scope** → mirror `set_config` end-to-end (`tools.py:786-872` +
  `client.py:916-960`): add `ctx: Context` to each of the four tools, derive
  `roles_to_access_scope(_claims_from_context(ctx).roles)`, add an `access_scope: int` client param,
  send `[*_metadata(), ("x-access-scope", str(access_scope))]`.
- **Per-tool scope-forwarding test** → mirror `TestSetConfigForwardsRealScope` (admin→15, non-admin
  rejected) in `test_config_tools.py`; flip the `test_client.py` per-tool `"7"` assertions.
- **Node admin gate (if notify gates)** → `services/xstockstrat-config/src/grpc/authz.ts`
  (`ADMIN_SCOPE=0x04`, `hasAdminAccessScope`, `ADMIN_SCOPE_ERROR`) is the reference; notify uses
  numeric `code:13`, so match local style or import `status`.
- **Ingest test context** → `test_cancel_backfill.py`'s `_ctx(access_scope)` + `ctx.abort=AsyncMock(...)`.

## Dependencies

- Proto/RPC: none (scope already travels in metadata).
- Migration: none. Config keys: none.
- Inter-service edges: unchanged (agent→ingest `TriggerBackfill`, agent/analysis/ingest/trading→notify
  `EmitAlert`).
- New env vars/ports: none.

## Risks / Not-found

- **EmitAlert gating is a genuine design fork (SEV-2 decision).** Every current caller is
  unauthenticated/non-admin: agent sends only `x-mcp-secret` (no scope), analysis `live_loop`/
  `fundsignal_loop` send **no metadata**, ingest sends `propagation_meta`, Go trading/marketdata/
  portfolio forward propagated headers. An **admin-bit gate would break every caller**. Enforcing
  `x-mcp-secret` would require analysis+ingest+trading (2 languages) to start sending it — cross-service
  scope creep. The realistic minimal decision is an **explicit internal-service-caller contract**
  (EmitAlert is a private-network gRPC-only RPC; the trust boundary is the network + the agent's own
  OAuth edge, not a per-call role check) documented + tested. The design debate must rule; surface to
  the user if contested.
- **Load-bearing sequencing** (product-spec): gate ingest `TriggerBackfill` **before** flipping the
  agent to caller-derived scope, or a legitimate admin is denied / a gate-less backend trusts an
  unverified header. For `manage_strategy`/`set_strategy_live`/`manage_signal_source` the backends
  already gate, so the flip is immediately meaningful; for `trigger_backfill` the flip is a **no-op
  until this feature's ingest gate lands** (same PR — order the steps).
- **Premise correction**: `manage_formula` is ownership-based (indicators author-check; admin is only
  an override), not a hardcoded-admin write — leave it out of the flip (AGENT/CLAUDE.md text that
  groups it with the forwarders is wrong and should be corrected).
- **074 zero-assertion trap** applies to **both** Node-ish suites here: ingest uses pytest (fine) but
  **notify runs `--experimental-strip-types` against source `.ts` with a lazy-import skip guard** — a
  parameter-property class may not strip, silently skipping. A notify gating/contract test must prove
  it executes (non-zero assertions), or it is not coverage.
- **Existing tests break by design**: ingest `TestTriggerBackfill` (bare `MagicMock`) and the agent
  `test_client.py` `"7"` assertions must be updated in the same steps (fix-every-affected-surface).
- Stale AGENT-3 evidence line refs (`client.py:32,298,466,608,713`) — the real sites are 343/520/662/767.

## Recommended Scope

Advisory step order (backends first):
1. **ingest service** — add `_has_admin_scope` gate to `TriggerBackfill`; **test** (RED: currently
   proceeds; admin still `QUEUED`; fix the bare-`MagicMock` tests).
2. **notify service** — implement the debated `EmitAlert` decision (explicit service-caller contract,
   or a gate); **test** proving it (non-zero assertions in the strip-types suite).
3. **agent** — add `ctx` + caller-derived `access_scope` to the four hardcoded tools
   (`manage_strategy`, `manage_signal_source`, `set_strategy_live`, `trigger_backfill`) and their
   client wrappers; **test** per-tool scope forwarding (mirror `TestSetConfigForwardsRealScope`); flip
   the `test_client.py` `"7"` assertions.
4. **docs** — re-forge AGENT-3/AGENT-4; update agent CLAUDE.md § Management-tool authorization
   (correct the `manage_formula` grouping); ingest + notify CLAUDE.md authz notes;
   `docs/runbooks/mcp-tools.md` where scope/gating is described. (C-10 same-PR docs.)
