# Recon: account-trading-halt-and-kill-switch

**Created**: 2026-08-06
**From**: product-spec.md
**Affected services**: xstockstrat-trading, xstockstrat-config, xstockstrat-ledger, xstockstrat-ui

---

## Objective

Harden the existing `platform.maintenance_mode` kill switch (already read synchronously inside
`PlaceOrder`) into an audited, richer trading state (`ACTIVE`/`REDUCE_ONLY`/`HALTED`) verified across
every order-ingress handler, with transitions durably logged to the ledger — not a new state machine
built from scratch.

## Codebase Map

- **`xstockstrat-trading`** (Go)
  - Existing gate: `if s.cfgW.GetBool("platform.maintenance_mode", false) { return error }` —
    `services/xstockstrat-trading/internal/service/trading.go:244-246` (confirmed exact)
  - `ReplaceOrder` (`trading.go:433-504`) and `CancelOrder` (`trading.go:387-427`) have **no** such
    gate today — confirmed via full-body read, not just grep
  - **No `ClosePosition` RPC exists in this service.** The only `ClosePosition` hits repo-wide are an
    internal DB-state helper in `xstockstrat-portfolio`, not an order-ingress RPC. Closes are ordinary
    `PlaceOrder` calls with an offsetting side — FR-4's real scope is `PlaceOrder` (already gated) +
    `ReplaceOrder`/`CancelOrder` (not gated), not a fourth "close-position path."
  - CLAUDE.md doc/code drift (previously flagged in `docs/context-constitution-findings.md:13`,
    2026-07-24) is **already fixed on trunk**: `trading.go:63` correctly documents
    `platform.maintenance_mode` and disclaims `trading.maintenance_mode`.
  - `checkPortfolioRisk`'s fail-open pattern (`trading.go:1285-1326`) is a distinct, softer "warn
    only" mechanism — not itself a halt, and not touched by this feature.
  - No per-account halt/freeze concept exists yet (confirmed: last migration is
    `004_broker_accounts_credential_status`; feature 030's `005_broker_accounts_halted` — see below —
    has not landed).
  - Ledger emit pattern (reuse target): `emitLedgerEvent` helper, `trading.go:1426-1439`, called via
    `go s.emitLedgerEvent(...)` at every order-lifecycle transition; fire-and-forget, 10s timeout,
    errors logged not propagated.

- **`xstockstrat-config`** (Node)
  - `platform.maintenance_mode` seed: `bool`, single `trading_mode='all'` row (dev:
    `migrations/001_config_tables.up.sql:55`; prod: `002_config_environment.up.sql:48`) — **not**
    seeded per-mode today (unlike e.g. `marketdata.alpaca.paper`, which has independent
    paper/live rows, `002_config_environment.up.sql:65-66`).
  - `SetConfig` is **unconditionally ADMIN-scope-gated**
    (`src/grpc/configServiceImpl.ts:286-300`, `hasAdminAccessScope`/`ADMIN_SCOPE = 0x04`,
    `src/grpc/authz.ts:22,38-42`) — **no internal/service-to-service bypass exists anywhere**. Any
    *automated* (non-human-operator) trigger for a halt transition would hit this exact wall — the
    same authz gap that broke feature 030's original automated-halt-fallback design.
  - **No precedent exists** for converting an existing key's `value_type` (bool→string), nor for
    adding a parallel key alongside an existing one — searched all migrations, zero hits either way.
    Genuinely novel territory for this codebase; both of the product-spec's own candidate approaches
    (widen the existing key vs. add `platform.trading_state`) are equally unprecedented.

- **`xstockstrat-ui`** (Next.js)
  - Config-key editor (`/config-ui/[namespace]/page.tsx:73-94,136-148`) **already sends every edited
    value as `string_val`** regardless of the key's seeded type, and the config service's
    `inferValueType`/`extractValueData` (`configServiceImpl.ts:428-455`) already handles this
    generically — extending `platform.maintenance_mode` to a string/enum value needs **zero write-path
    code change**. The only real UI gap is display/UX: a plain-text `Input`, not an enum `<Select>`.
  - **Unrelated data-integrity bug found** (out of scope, flag only): `ListKeys` (the read path the
    editor's table renders) selects the `default_value` column, not the live `value_data` column
    `SetConfig` writes (`configServiceImpl.ts:362-379` vs. `:338-347`) — the editor's displayed/seed
    value may not reflect the current live value after a prior write. Not this feature's bug to fix,
    but worth a defect report.
  - No `/trader` halt/status banner exists anywhere (`grep -i "halt|maintenance_mode|HALTED|REDUCE_ONLY"`
    across `src/`, zero matches) — confirms product-spec's framing as a genuine net-new nice-to-have.

- **`xstockstrat-ledger`** (Node)
  - `AppendEvent`/`QueryEvents` both exist exactly as the product spec assumes —
    `packages/proto/ledger/v1/ledger.proto:33-66`, impl `src/grpc/ledgerServiceImpl.ts:28-176`.
    `AppendEvent` supports an `idempotency_key` for at-most-once semantics
    (`ledgerServiceImpl.ts:69-118`).
  - Stream-key convention table exists (`services/xstockstrat-ledger/CLAUDE.md:95-104`) — this
    feature's `trading_state:{account}` key should follow it.

## Patterns to REUSE

- Ledger audit trail → reuse `emitLedgerEvent`'s exact call shape (`trading.go:1426-1439`), new event
  type `trading_state.changed`, stream key `trading_state:{account}` per the existing convention.
- Config-key editor write path → **no code change needed**; the existing generic `string_val`
  write already handles an enum-shaped value.
- Config-read idiom → `s.cfgW.GetBool`/`GetString` (`trading.go:244,1280`).
- Per-`trading_mode` seed pattern → follow `marketdata.alpaca.paper`'s independent paper/live rows
  (`002_config_environment.up.sql:65-66`), not the single-`all`-row pattern this key currently uses.

## Dependencies

- Proto/RPC: none required — value travels as a config value via existing `WatchConfig`; audit trail
  uses existing `AppendEvent` with a `Struct` payload.
- Migration: none in `xstockstrat-trading`/`xstockstrat-ledger`/`xstockstrat-ui`; `xstockstrat-config`
  needs new seed rows (extend existing key or add a new one — undecided, see Risks) — coordinate
  numbering against 023's/030's contested `011`/`012`.
- Config keys: `platform.maintenance_mode` (extend) or `platform.trading_state` (new) — undecided.
- Inter-service edges: none new.
- **Cross-feature coupling with 030 (critical — read 030's `design.md` before designing this
  feature):** feature 030 (`design-approved`, not yet implemented) already designed its **own**
  per-account, DB-persisted halt mechanism (`trading.broker_accounts.halted` column, migration
  `005_broker_accounts_halted`) specifically because 030 found `SetConfig`'s ADMIN-gate made an
  automated config-write halt fallback non-functional. 030's `design.md` explicitly names this as a
  forward dependency: "030's per-account auto-halt and this feature's platform-wide gate are
  orthogonal, both required, and must not be conflated." **This feature (100) must NOT attempt to
  unify or replace 030's per-account mechanism** — it is a separate, human-operator-driven,
  platform-wide (or eventually per-mode) control, checked independently alongside 030's per-account
  check in `PlaceOrder`.

## Risks / Not-found

- **Config-key type decision has no precedent either way** (bool→string widen vs. parallel key) — a
  genuine, evidence-backed design fork, not a stale claim. `/sdd-design` must decide and justify.
- **Automated-trigger authz gap** — if this feature's design (or a future consumer, e.g. 102's
  reconciliation ticker) ever wants a *non-human* caller to write the halt state via `SetConfig`, it
  will hit the same unconditional ADMIN-gate wall that broke 030's original design. Must be an
  explicit design decision: human-only for V1 (deferring automated triggers to a later increment), or
  design an internal-caller authz path (real new surface, not "reuse").
- **FR-4's "close-position path" doesn't exist as a distinct RPC.** REDUCE_ONLY semantics must
  distinguish exposure-increasing vs. exposure-reducing calls *within* `PlaceOrder` itself (side vs.
  existing position), not gate the whole RPC — this is a real design question, not a simple boolean
  gate extension.
- **Interaction with 030's `ReplaceOrder`/`CancelOrder` gating decisions.** 030 already decided:
  `ReplaceOrder` blocks outright when its own per-account halt is active; `CancelOrder` is
  **deliberately never gated** (operator's sole de-risk tool). If 100's REDUCE_ONLY/HALTED gate is
  added to the same handlers, `/sdd-design` must confirm consistent semantics — in particular,
  `CancelOrder` should almost certainly stay ungated by 100's gate too, for the same reason 030 left
  it ungated.
- **Unrelated `ListKeys`/`value_data` staleness bug** in the config-ui editor (found incidentally) —
  out of scope for this feature; recommend a separate defect report, not a fix bundled here.
- fails.md/insights.md **2026-08-06** (030-stop-loss-bracket-orders): the persisted-state-vs-in-memory
  lesson and the "reuse a precedent's actual mechanics, not just its shape" lesson are directly
  relevant if this feature's chosen approach involves any new persisted state.

## Recommended Scope

Advisory only — not binding.

1. `xstockstrat-config`: decide widen-vs-parallel-key, seed migration (per-mode rows, not single `all`).
2. `xstockstrat-trading`: extract the maintenance-mode check into a single shared gate function
   (avoid the C-10(a)-style "copied per handler" trap FR-4 itself warns against); call it from
   `PlaceOrder` (extend) and `ReplaceOrder` (new); explicitly do not gate `CancelOrder`, consistent
   with 030's decision on its own per-account gate.
3. `xstockstrat-trading`: REDUCE_ONLY semantics — distinguish exposure-increasing from
   exposure-reducing `PlaceOrder` calls.
4. `xstockstrat-trading`: ledger audit event on every transition, reusing `emitLedgerEvent`.
5. `xstockstrat-ui`: decide whether the plain-text config editor is sufficient for V1, or whether an
   enum `<Select>` is worth the small UI addition.
6. Tests per C-08/C-13 pairing at each service step.
