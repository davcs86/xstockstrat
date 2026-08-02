# Design: fix-mcp-strategy-lifecycle

**Created**: 2026-08-02
**Rounds**: 2 (full)
**Grounded in**: recon.md

---

## Chosen Approach

Honest strategy lifecycle, mirroring feature 088's `ManageSignalSource` verb work.

### 1. Proto (additive) — `packages/proto/analysis/v1/analysis.proto`
- Add `STRATEGY_OPERATION_REACTIVATE = 4` to `StrategyOperation` (next free; additive). No
  `SetStrategyLiveResponse` change — the inert-config rejection uses `FAILED_PRECONDITION`.

### 2. analysis repo (`app/repositories/strategies.py`)
- Add `reactivate(strategy_id)` → `UPDATE analysis.strategies SET active = TRUE, updated_at = NOW()
  WHERE strategy_id = $1 RETURNING *`; returns None if the id is gone (mirror `deactivate`).

### 3. analysis servicer (`app/handlers/servicer.py`)
- **REGISTER existence check** (`ManageStrategy` `:1555-1563`): before `create`, `get_by_id(id)` — if
  it exists (active OR inactive), abort `ALREADY_EXISTS` ("strategy '<id>' already exists; use
  reactivate to bring back a deactivated one"). Cleaner than catching `UniqueViolationError` and needs
  no `asyncpg` import; a deactivated strategy still occupies the PK, so this correctly routes the caller
  to reactivate.
- **REACTIVATE op**: `repo.reactivate(id)` → `NOT_FOUND` if None; else return the row.
- **SetStrategyLive preconditions** (`:1697`): when `request.live_enabled` is **true**, fetch
  `get_by_id(id)` (NOT_FOUND if None), build the definition, and:
  - if `not row["active"]` → `FAILED_PRECONDITION` ("cannot enable live on an inactive strategy");
  - else compute symbols exactly as the live loop does (`_symbols_for` logic: `signal_params.symbols`)
    and if empty → `FAILED_PRECONDITION` ("strategy has no signal_params.symbols; live evaluation
    would never fire").
  When `live_enabled` is **false** (disable), skip all checks — disable is always allowed, even on an
  inert config. Then call `set_live_enabled` as today.
- The live-loop predicate (`live_enabled AND active`, `_symbols_for`) is **unchanged** — we fix the
  input so an enabled strategy always satisfies the firing contract (AC-4).

### 4. agent (`app/client.py`, `app/tools.py`)
- `manage_strategy` client op map (`:293-295`) gains `"reactivate": STRATEGY_OPERATION_REACTIVATE`;
  the unknown-op error message lists it.
- `manage_strategy` tool docstring adds `reactivate` and drops the "never reactivate" workaround note.
- `set_strategy_live` tool docstring: replace the inert-success footgun text with the new contract —
  enabling on an inactive or no-symbols strategy now returns `FAILED_PRECONDITION`; disable always
  succeeds; after enabling, the strategy is guaranteed to satisfy the firing contract.
- `_grpc_error_message`: confirm `ALREADY_EXISTS`/`FAILED_PRECONDITION` surface their server detail
  (default passthrough is fine; no `not_found` override needed for those).

### 5. same-PR docs
- `docs/runbooks/mcp-tools.md` `manage_strategy` (add reactivate verb) + `set_strategy_live` (the
  precondition contract). `manage_strategy`/`set_strategy_live` are in the strat-lab plugin
  (`plugins/strat-lab/skills/backtest/SKILL.md`) per root CLAUDE.md — **check and update it if it
  describes these lifecycle semantics** (same-PR rule).

## Rejected Alternatives

- **Register upsert-on-inactive** (reactivate via register) — rejected: overloads register and keeps
  it non-strict; the explicit REACTIVATE verb mirrors 088 and keeps `ALREADY_EXISTS` honest.
- **`SetStrategyLiveResponse.warnings` instead of `FAILED_PRECONDITION`** — rejected: the AC asks for a
  hard rejection of an inert enable; `FAILED_PRECONDITION` needs no proto change and is unambiguous.
- **Catch `asyncpg.UniqueViolationError` on register** — rejected in favor of a `get_by_id` pre-check:
  no new import, and the deactivated-strategy case routes to reactivate with a clear message.
- **Auto-clear `live_enabled` on deactivate** — out of scope (product-spec); the enable-time
  precondition already makes the inert-live case unreachable going forward.

## Open Risks

- [ ] A pre-existing strategy that was enabled-live-while-inactive before this fix stays enabled in the
  DB; the live loop already skips it (`AND active = TRUE`), so no misfire — the fix prevents *new* inert
  enables. Acceptable (fixing the consumer is out of scope). Target: none (documented).
- [ ] `STRATEGY_OPERATION_REACTIVATE=4` next-free verified locally; re-verify vs remote refs at /sdd-spec (ledger 081).

## Constitution Rules Touched

- `C-04` — reuse the existing `StrategyOperation` enum (add a value with the `_UNSPECIFIED=0` invariant intact).
- `C-08`/`P-06` — analysis + agent steps each get paired RED-first tests (register-dup, reactivate, live preconditions, disable-allowed).
- `C-09` — additive proto (`buf lint`+`breaking`); `./scripts/buf-gen.sh`.
- `C-10` — same-PR docstring + `mcp-tools.md` (+ strat-lab skill if it covers these verbs).
- `F-01`/`F-06`/`F-07` — no migration, no new pool, no config.
