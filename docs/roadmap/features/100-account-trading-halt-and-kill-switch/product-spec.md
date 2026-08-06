# Product Spec: account-trading-halt-and-kill-switch

**Created**: 2026-08-04
**Rescoped**: 2026-08-04 (feasibility re-check — see context.md; scope reduced from a green-field
state machine to hardening the kill switch that already exists)

---

## Problem Statement

`xstockstrat-trading` already enforces a server-side kill switch: `platform.maintenance_mode`, read
synchronously inside `PlaceOrder` (`services/xstockstrat-trading/internal/service/trading.go:244`), and
already correctly documented at `services/xstockstrat-trading/CLAUDE.md:63` ("the real halt key; there
is no `trading.maintenance_mode`") — the doc/code drift once flagged in
`services/xstockstrat-trading/docs/context-constitution-findings.md:13` (dated 2026-07-24) has since
been fixed on trunk and is now stale; re-verified 2026-08-04, no remaining action needed on this point.
What the kill switch still lacks: a durable audit trail of who/what flipped it and why, a distinction
between "reject new exposure but allow risk-reducing closes" (`REDUCE_ONLY`) and "reject everything,"
and a guarantee that every order-ingress path actually checks it (today only `PlaceOrder` is confirmed;
`ReplaceOrder`/`CancelOrder`/close-position paths need the same verification).

## User Story

As a platform operator, I want the existing `platform.maintenance_mode` kill switch hardened into an
audited, richer trading state (`ACTIVE` / `REDUCE_ONLY` / `HALTED`) enforced at every order-ingress
path inside `xstockstrat-trading`, so that a halt reliably stops new exposure while still allowing
safe risk-reducing action, and every transition is reconstructable after the fact.

## Functional Requirements

FR-1. **Superseded — already true, kept as a verification step, not a fix.** The doc/code key-name
drift this FR originally targeted no longer exists: `services/xstockstrat-trading/CLAUDE.md:63`
already documents `platform.maintenance_mode` correctly and explicitly disclaims
`trading.maintenance_mode`. `/sdd-spec` should still include a step that re-confirms this at
implementation time (a re-drift is possible between now and then), but must **not** rename the
working config key on the strength of the stale, dated (2026-07-24) findings-doc entry — that would
regress a control that already works.

FR-2. Extend the halt signal from a boolean to a small enum consumed the same way `platform.
maintenance_mode` is today — via the existing `xstockstrat-config` `WatchConfig` stream, no new
service or RPC. Candidate values: `ACTIVE`, `REDUCE_ONLY`, `HALTED` (see Open Questions on whether
`EMERGENCY_FLATTEN` is in scope for this pass or a later one).

FR-3. `REDUCE_ONLY`/`HALTED` reject exposure-increasing orders (new entries, size-increasing replaces)
but continue to permit order cancellation and risk-reducing closes — today's boolean
`maintenance_mode` does not distinguish these; confirm at `/sdd-design` whether it currently blocks
everything indiscriminately.

FR-4. Verify (and fix if not already true) that `ReplaceOrder`, `CancelOrder`, and any close-position
path in `services/xstockstrat-trading/internal/service/trading.go` check the same gate `PlaceOrder`
does at `trading.go:244` — a single shared check, not one copied per handler.

FR-5. Every state transition is durably audited. Reuse the existing `xstockstrat-ledger` append-only
event store (`AppendEvent`, `stream_key = "trading_state:{account}"`) rather than a new database table
— the same no-new-pool pattern already used elsewhere in this codebase for durable per-entity state
(see `docs/roadmap/ledger/insights.md` 2026-07-31, `083-ui-revamp-opportunities-first`). Each event
records actor (operator user id, or a fixed system-trigger identifier), reason, timestamp, and
whatever measurement triggered it.

FR-6. A manual control (existing config-key write path via `xstockstrat-config`, or a small dedicated
admin action — decide at `/sdd-design`) flips the state; recovery from `HALTED`/`REDUCE_ONLY` back to
`ACTIVE` is always an explicit operator action.

## Out of Scope

- Most *automatic* halt triggers (loss thresholds, drawdown, stale market data, abnormal order rate) —
  those assume signals from features that are demoted or don't exist yet (see `106`,
  `demoted/canceled`) or from an automated order-placement path this platform doesn't have. This
  feature is the enforcement point and the richer state only; wiring most automatic triggers is future
  work once there's a real signal to wire. The one exception is an unsafe mismatch from the revived,
  lightweight `102` reconciliation ticker — that signal is real and in scope for this feature to
  consume once `102` exists.
- `EMERGENCY_FLATTEN` (auto-closing every position) — flagged as an open question below; likely a
  distinct, later increment once `030-stop-loss-bracket-orders` exists (closing positions safely needs
  that feature's cancel/replace logic).
- A new UI page — the existing config-ui already lets an operator write `platform.maintenance_mode`;
  extending that existing surface (not building a new one) is the right scope. See Consumer Surface.

## Affected Services

- `xstockstrat-trading` — the enforcement gate (already exists for `PlaceOrder`; extend to the other
  order-ingress handlers) and the ledger-event audit write.
- `xstockstrat-config` — no service change expected; the existing `WatchConfig` mechanism already
  carries the (now richer) value.
- `xstockstrat-ledger` — consumes `AppendEvent` for the audit trail (existing RPC, no proto change).
- `xstockstrat-ui` — the existing `config-ui` segment's config-key editor already lets an operator set
  `platform.maintenance_mode`; a richer enum value is set the same way. A status banner elsewhere
  (e.g. `/trader`) is a nice-to-have, not required for this pass.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — the *existing* `xstockstrat-ui` `/config-ui` segment already exposes config-key
  read/write; no new page. If `/sdd-design` finds the current config-key editor insufficient for an
  enum value (vs. today's boolean), that's a small edit to an existing component, not a new surface.
- [ ] **Agent**
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required — the value travels as a config value via the existing `WatchConfig`
  RPC, and the audit trail uses the existing `AppendEvent` ledger RPC with a `Struct` payload. No new
  message or enum needs to enter `.proto`.

## Config Key Changes

- `platform.maintenance_mode` (existing) is extended from bool to a small string/enum value, or a
  second key is added alongside it (e.g. `platform.trading_state`) — decide at `/sdd-design` based on
  whether existing readers of the boolean key can tolerate the type change or need a parallel key
  during migration.

**Trading-mode scoping (Constitution-adjacent, config-governance rule 4):** every service already
subscribes to `WatchConfig` with `environment` + `trading_mode`, and the config service already
supports per-`trading_mode` rows (`docs/patterns/config-governance.md` rules 3–4) — the scoping
mechanism is not new. This feature must seed the halt key with **per-`trading_mode` rows** (`paper`
and `live` seeded independently, not `trading_mode='all'`), so an operator can halt live trading
during an incident while paper testing continues unaffected (or vice versa) — the opposite default
(`all`) would force every halt to freeze paper testing too, undermining the ability to verify a fix
in paper before lifting a live halt. `/sdd-design` should confirm this against the actual seed-data
pattern used for other per-mode keys before finalizing.

## Database Changes

- [x] No schema changes — audit trail uses the existing ledger event store, not a new table.

## Feature Workflow Notes

Branch to create: `feature/account-trading-halt-and-kill-switch` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change) — **resolved 2026-08-06**:
  `/sdd-design` picked the parallel-key (`platform.trading_state`) path, not "extend existing key" —
  per root `CLAUDE.md` § Approval Flow's "New config key" rule, this requires the gate below instead.
- [x] Service owner + config team approval (new config key) — the applicable gate, per the resolved
  parallel-key decision (`design.md` § Chosen Approach).
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration) — not applicable, no schema change

## Acceptance Criteria

1. `services/xstockstrat-trading/CLAUDE.md` and the code agree on the halt config key name (already
   true as of this writing — re-verified, not re-fixed, per FR-1).
2. `HALTED`/`REDUCE_ONLY` reject exposure-increasing orders on every order-ingress handler
   (`PlaceOrder`, `ReplaceOrder`, close-position), verified by a test per handler — not just
   `PlaceOrder`.
3. `HALTED`/`REDUCE_ONLY` still permit order cancellation and risk-reducing closes.
4. Every transition is a ledger event with actor, reason, and timestamp, queryable via the existing
   `QueryEvents` RPC.
5. Recovery to `ACTIVE` is always an explicit operator action (config write), never automatic.

## Open Questions

- [ ] Does today's boolean `platform.maintenance_mode` already block cancellations too (over-broad), or
  does `checkPortfolioRisk`/order-handling code already distinguish reduce-only intent? Grep and
  confirm at `/sdd-design` before assuming FR-3 is new behavior rather than a fix.
- [ ] Enum value vs. a second config key, and whether `EMERGENCY_FLATTEN` belongs in this feature or a
  follow-up once `030` exists — flag for `/sdd-design`.
- [ ] Is a `/trader` status banner worth adding in this same pass, given the config-ui editor already
  lets an operator see/set the value? Lean toward "not required" unless `/sdd-design` finds operators
  don't visit config-ui often enough to notice a halt.
