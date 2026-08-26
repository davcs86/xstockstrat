# Context: offline-account-portfolios  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: Added a broker-less "offline" account variant (`BROKER_TYPE_OFFLINE=3`) whose positions
and P&L are driven by manually entered/editable order confirmations (a `/trader` UI card + a new
`manage_offline_account` MCP tool) rather than a broker poller. The correctness core: offline
confirmations flow through the SAME portfolio consumer as broker syncs, but because they are
editable they emit the self-healing absolute snapshot (`account.positions.synced`), never the
incremental `order.filled`. Shipped with realized P&L (an account-grain table) and shorts in v1,
and a shared `packages/proto/pnl` Fold now backing both trading and portfolio. Left UI gaps that
spawned follow-up feature 159.

**Why (irrecoverable rationale)**: An editable input re-runs a non-idempotent incremental fold with
NO broker snapshot left to self-heal — so the offline producer had to recompute absolute state from
its own source of truth and emit the reconciling snapshot instead. (Full "why" chain — per-account
lock, emit-nothing-on-failed-recompute, economic `filled_at` fold order, separate realized table —
already recorded at insights.md:2123-2126.)

**Rejected alternatives** (all were in the now-deleted design.md):
- Parallel `s.offlineAccounts` map — lost: duplicates the account-existence source and self-collides
  with the sole-account fallback.
- Incremental `order.filled` fold / signed-delta emission — lost: non-idempotent double-count/mis-sign;
  a delta-qty=0 can't express an avg-price-only edit.
- Per-position `realized_accum` — lost: `DeletePositionsNotInSync` deletes the row on close, losing
  realized; an account-grain table survives position wipes.
- Surface realized via `GetPnL` Pass 3 — lost: `GetPnL` is account-blind, so it would bleed broker
  realized onto offline cards.
- `deregistered:true` flag on the snapshot event — lost: overloads a valuation event with a lifecycle
  command; a dedicated `account.deregistered` keeps the audit honest.
- Standalone `packages/pnl` module — deferred fallback: adds a go.mod + 2 replaces + a CI entry for no
  functional gain (`replace`/go-lint already cover `packages/proto/`); the Fold went into
  `packages/proto/pnl`.
- Dedicated "set absolute positions from statement" reconcile RPC — lost by operator decision: monthly
  reconciliation is a Claude task correcting drift via the editable confirmation tools; positions stay
  purely order-derived.
- Extend `ReplaceOrder` to carry fill fields (vs a dedicated `ConfirmOrder` RPC) — lost: `ReplaceOrder`
  is broker-routed and edits only working orders' qty/limit/stop/TIF, so a fill-write is a different
  non-broker operation; a dedicated `ConfirmOrder` keeps the offline mutation off the broker path.

**Scars & gotchas**:
- **Agent tool-count baseline was wrong by grep.** The impl-spec review flagged docstring "29" vs 28
  `@server.tool()` decorators and assumed docstring drift; execute proved the true baseline was 29 —
  the "28" was a bad grep missing one decorator FORM. Any of six inventory surfaces synced to the grep
  count would have been wrong. (Recorded at fails.md 2026-08-26.)
- **`DeletePositionsNotInSync` makes an empty snapshot destructive.** A FAILED recompute must emit
  nothing — an empty snapshot is indistinguishable from a legitimate flat and wipes the account.
- **E2E warmup gotcha**: Playwright's shared `warmup.setup.ts` SSR pre-warm times out on cold start in
  the CI-less sandbox; the offline spec was verified with `--no-deps` (3/3 green), the full suite runs
  in CI with a prebuilt bundle.
- **Directory renumber 156→157 mid-flight** after 156-fix-fundamentals-signal-producer (PR #1014)
  claimed 156; slug/branch unchanged. Explains the git branch `claude/features-157-158-impl-ulk0l2`.

**Permanent deviations**:
- design/impl-spec said agent tools 28→29 → shipped 29→30 → because the recon/spec baseline of 28 came
  from a decorator-form-blind grep; the true baseline was 29.
- design said branch `feature/offline-account-portfolios` → shipped on `claude/features-157-158-impl-ulk0l2`
  (a shared 157+158 harness branch) → because the task mandated a single branch for both.
- `@AC-7` amended from "order.filled emitted" → "account.positions.synced emitted, no order.filled" →
  because the operator chose absolute-recompute at the round-2 gate; sign-off per C-16.
  (`acceptance.feature` is RETAINED, so this amendment survives in the source.)

**Cross-feature signal**: 159-fix-offline-account-ui-gaps is a direct follow-up fix — 157 shipped with
UI gaps despite the C-14 consumer-surface sweep, echoing the recurring "the enum/consumer sweep missed
a surface" pattern. It also reinforces the 056 dual-read-path drift trap: 157 deliberately populated
realized in BOTH `buildAccountPortfolio` and `GetPortfolio` with a parity assertion precisely because
056 added valuation to only one path.

**Deferred follow-ons**:
- **offline-broker-card-realized** — surface realized on BROKER cards; blocked on fixing `GetPnL`
  account-blindness (it aggregates across all of a user's accounts, not one `account_id`); offline-only
  realized is deliberate v1 scope.
- **Offline crash-recovery resync** — offline self-heals only on a `ConfirmOrder` recompute; a
  boot-time recompute-from-confirmed-orders is a possible follow-up.
- **Operator's scheduled Routines** — 157 built the platform capability only; the scheduled
  email-processing + monthly-statement-sync tasks are the operator's to wire.

**Ledger entries written**: insights.md (1, reuse — null-client pooled-member skip), fails.md (1,
assumption — agent tool-count grep undercount) — see the 2026-08-26 entries. The absolute-recompute /
per-account-lock / emit-nothing-on-failure / economic-fold-order / separate-realized-table design was
already recorded at insights.md:2123-2126 (DUP, not re-added).
**Runtime-invariant recommendations (→ /context-constitution)**: (1) `PORTFOLIO-*`/`TRADING-*` — an
offline account's `ConfirmOrder` MUST emit only `account.positions.synced` and MUST NOT emit
`order.filled` (the disjointness that keeps `GetPnL` Pass 1/2 and `ConsumeOrderFills` from
double-folding offline positions). (2) `PORTFOLIO-*` — a `account.positions.synced` consumer applies
`DeletePositionsNotInSync` absolutely, so an empty snapshot wipes the account; any producer must emit
nothing on a failed recompute.
**Scenario promotion (C-16)**: all 15 `@AC-*` were NEW — promoted to
`services/xstockstrat-trading/acceptance/offline-account-portfolios.feature` (AC-1,2,4,5,8,9),
`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature` (AC-7,10,11,12,14),
`services/xstockstrat-ui/acceptance/offline-account-portfolios.feature` (AC-3,13),
`services/xstockstrat-agent/acceptance/offline-account-portfolios.feature` (AC-6), and the cross-service
deregister cascade `@AC-15` appended to `docs/sdd/business-rules/platform.feature`.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
