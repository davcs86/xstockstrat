# Design: fix-mcp-writepath-authz

**Created**: 2026-08-02
**Rounds**: 2 (full) — proposer/adversary each round, mediated
**Grounded in**: recon.md

## Chosen Approach

Ship the F-11 fix in four ordered steps — **backends gated before the agent flips headers** — all
RED-first, all docs same-PR.

### 1. ingest — gate `TriggerBackfill`
Insert the verbatim `CancelBackfill` gate immediately after the `self._db is None` check
(`servicer.py:170-172`), before job creation:
`if not self._has_admin_scope(context): await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required"); return`.
Reuses `_has_admin_scope` (`servicer.py:146-159`, `access_scope & 0x04`). Migrate the four
`TestTriggerBackfill` cases (`test_ingest_servicer.py:257-316`, bare `MagicMock()`) onto an
admin-scoped context; centralize `test_cancel_backfill.py`'s `_ctx(access_scope)` (`:34-45`) into
`tests/conftest.py` (C-13 — second consumer) and import it in both suites.

### 2. agent — flip the four hardcoded-admin tools to the `set_config` template
For `manage_strategy`, `manage_signal_source`, `set_strategy_live`, `trigger_backfill` (tools +
client wrappers), mirror the proven feature-073 `set_config` plumbing (`tools.py:829-870`,
`client.py:916-960`): add `ctx: Context` (first param), derive
`access_scope = roles_to_access_scope(_claims_from_context(ctx).roles)` with the None-claims →
`RuntimeError` guard, add an `access_scope: int` client param, and send
`[*_metadata(), ("x-access-scope", str(access_scope))]` in place of `_admin_metadata()`.
- `manage_formula` is **out** — it uses plain `_metadata()` (indicators ownership-based auth), not a
  hardcoded-admin write.
- With all four flipped, `_admin_metadata()` (`client.py:30-32`) is orphaned in `app/` → **delete it**.
  Adversary-caught: it still has live *test* refs — rewrite `test_other_management_tools_still_use_the_hardcoded_admin_tuple`
  (`test_config_tools.py:262-264`) to assert the **new** invariant (all four forward the caller's
  derived scope; none hardcode `7`); update the `scopes.py:10` docstring and the
  `test_streamable_http_auth.py:99` comment; flip the per-tool `"7"` assertions in `test_client.py`
  (`:102/254-256/295/328`).

### 3. notify — `EmitAlert` explicit internal-service-caller contract (NO gate)
No code gate on `emitAlert` (`notifyServiceImpl.ts:30`). EmitAlert is a private-network gRPC-only RPC
whose trust boundary is the network + the agent's OAuth 2.1 edge; every current caller is
unauthenticated/internal (analysis loops send no metadata; the agent sends only `x-mcp-secret`), so
an admin gate breaks them all and `x-mcp-secret` enforcement **inverts** the trust boundary (only the
external agent sends the secret). **Adversary-ruled: option (a) is the correct SEV-2 answer.**
- **Binding condition (074 trap):** the contract test must *actually execute*. Switch notify's
  `package.json` `test`/`test:coverage` to config's proven compile-first form
  (`tsc && node --test dist/__tests__/*.test.js`) — verified safe: notify `tsconfig.json`
  `include: ["src/**/*"]` emits `dist/__tests__/`. Remove the silent `try/catch` import skip
  (`test.ts:23-31`) and per-case `if (!X) return;`; add a hard "import succeeded" assertion. Add an
  EmitAlert contract test (no-metadata `call` → succeeds: DB write + fan-out) and **demonstrate a
  deliberate red** (temporarily stub an admin gate → the no-metadata test fails → revert) to prove it
  would catch a regression.

### 4. docs (same PR, C-10)
AGENT-3/AGENT-4 re-forge (`context-constitution.md:17-18`); agent findings F-11 resolved
(`context-constitution-findings.md:46`); agent CLAUDE.md § Management-tool authorization (drop
hardcoded-admin language; correct the `manage_formula` grouping); ingest CLAUDE.md (`TriggerBackfill`
now admin-gated); notify CLAUDE.md (EmitAlert internal-caller contract + compile-first harness);
`docs/runbooks/mcp-tools.md` (per-tool authz); `plugins/strat-lab/` — **verify** whether the skill
describes authz for manage_strategy/set_strategy_live/trigger_backfill and update only if so (root
CLAUDE.md same-PR mandate); `product-spec.md` behavior-change call-out.

## Per-AC RED-first test matrix (exact backend bit per tool)
- **AC1 (ingest):** no-metadata → `PERMISSION_DENIED`; `_ctx("4")` (0x04) → `QUEUED`.
- **AC2 (notify):** import-succeeded hard assertion + no-metadata `emitAlert` succeeds; deliberate-red
  via a stub gate. **Runs in the compiled suite** — the binding condition.
- **AC3 (agent flip):** admin (scope 15, has 0x04) accepted; trader (11) / viewer (1, no 0x04)
  → `PERMISSION_DENIED`. Every backend checks **0x04** (verified): analysis `ManageStrategy`
  (`servicer.py:1543-1546`), analysis `SetStrategyLive` (`:1697-1701`, confirmed NOT TRADING 0x08),
  ingest `ManageSignalSource` (`:912-918`), ingest `TriggerBackfill` (new gate).
- **ctx-injection guard (per tool):** mirror `test_config_tools.py:252-259` — `ctx` is SDK-wired and
  absent from the public `inputSchema`; None-claims → `RuntimeError`.

## Rejected Alternatives
- **EmitAlert admin gate (c)** — breaks every internal caller (analysis loops send no metadata →
  alerting silently dies); EmitAlert has no admin semantics.
- **EmitAlert `x-mcp-secret` enforcement (b / "fourth option")** — inverts the trust boundary (only
  the external agent sends the secret; internal Go/Python callers don't) and would make notify the
  first service to enforce `MCP_AGENT_SECRET`; cross-service, cross-language creep for no real gain.
- **Leave `_admin_metadata()` dead** — invites a future hardcoded-scope regression; deletion + the
  rewritten invariant test is the clean close.
- **Speculative `emit_alert` scope forwarding** — buys nothing (notify doesn't read it); violates the
  minimum-change norm.
- **Flip `manage_formula`** — different (ownership) auth model; not a hardcoded-admin write.

## Open Risks
- **Access change (intended, product-spec call-out).** Post-flip, non-admin OAuth operators
  (trader=11, viewer=1) lose `manage_strategy`/`manage_signal_source`/`set_strategy_live`/
  `trigger_backfill` — the backends require ADMIN 0x04. This is the F-11 fix (the hardcoded `7`
  carried 0x04 for everyone), not a regression to avoid; recorded so it isn't a surprise.
- **notify compile-first (mitigated).** `tsconfig include: ["src/**/*"]` emits tests → verified; the
  "import succeeded" hard assertion + deliberate-red are the backstop against a silent-green.
- **ctx SDK wiring** assumed identical to `set_config` (shared tool_manager) — proven per tool by the
  paired ctx-injection guard.

## Constitution Rules Touched
- **F-11 / F-04** — no invented symbols; the "orphaned `_admin_metadata()`" absence claim was
  grep-corrected (live test refs updated, not ignored).
- **C-08 / P-06** — every service step paired with a RED-first test; AC2's binding condition is a
  genuinely-executing compiled test with a demonstrated red (074 trap defeated).
- **C-13** — `_ctx` centralized into ingest `conftest.py` on its second consumer.
- **C-10** — same-PR docs across AGENT-3/4, findings, three service CLAUDE.md, `mcp-tools.md`,
  `strat-lab` (verify), product-spec.
- **C-11 / P-03** — the access-change and the EmitAlert decision surfaced explicitly, not guessed.
- **C-03** — the flipped tools forward `x-access-scope` (not `x-user-id`/`x-trace-id`, matching
  `set_config`); no new propagation surface.
- No proto/migration/config change (F-01/F-06/F-07 N/A).
