# Context: account-trading-halt-and-kill-switch

**Feature**: `docs/roadmap/features/100-account-trading-halt-and-kill-switch/feature.md`
**Product Spec**: `docs/roadmap/features/100-account-trading-halt-and-kill-switch/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/100-account-trading-halt-and-kill-switch/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review (session-provided feedback document, not a GitHub issue). The review recommended
  a dedicated Live-Capital Safety program with P0/P1/P2 items; this feature is P0 item 3
  ("account-level trading kill switch").
- Source feedback also recommended accelerating two existing draft features as P0 blockers rather than
  creating new ones for them: `023-position-sizing-engine` and `030-stop-loss-bracket-orders`. Their
  `context.md` files were annotated with a priority note pointing back to this program; no new feature
  numbers were allocated for them.
- This feature is a foundational dependency for 102 (reconciliation halts through it), 106 (market-data
  gate halts through it), and 107 (canary rollout enforces stage limits at the same gate). Per the
  review's suggested execution order, this and 101 (idempotent order intents) have no upstream
  dependency and can start first.

## Session 2026-08-04T01:00:00Z — feasibility re-check (rescoped, not demoted)

- The user pushed back on the mechanical translation and asked for a real feasibility check. Grepping
  `services/xstockstrat-trading/internal/service/trading.go` found `platform.maintenance_mode` is
  **already** read synchronously inside `PlaceOrder` (`trading.go:244`) — a real, already-enforced
  kill switch, not a green-field gap. A doc/code key-name drift is already flagged in
  `services/xstockstrat-trading/docs/context-constitution-findings.md:13`.
- Kept in the backlog (unlike 102/103/104/105/106/107/108/109, which were demoted — see their
  context.md files) because a halt is valuable regardless of whether order flow is human-initiated or
  automated. But rewrote `product-spec.md` to reflect the real, much smaller scope: harden the
  existing key into a richer enum, verify every handler checks it, audit via the existing ledger
  event store (no new DB table, no new proto message — reusing the `insights.md` 2026-07-31 pattern of
  append-only-store-instead-of-new-table). Dropped every *automatic* trigger (loss threshold,
  drawdown, reconciliation, stale data) since those either depend on demoted features or on an
  automated order-placement path this platform doesn't have yet.

## Session 2026-08-05T00:00:00Z — sdd-review product-spec (2 rounds)

- Round 1 FAIL: (1) the Problem Statement/FR-1 doc-drift claim was stale —
  `services/xstockstrat-trading/CLAUDE.md:63` already documents `platform.maintenance_mode` correctly;
  the cited findings-doc entry is dated 2026-07-24 and no longer reflects trunk. (2) C-3 trading-domain
  gap: no statement of whether the halt states are scoped per `trading_mode` (paper/live). Fixed:
  rewrote the Problem Statement/FR-1 to a verification-only step (do not rename a working key on stale
  evidence), and added explicit per-`trading_mode` config-seeding guidance (independent paper/live halt
  rows, not `trading_mode='all'`) so an operator can halt live without freezing paper testing.
- Round 2: **PASS WITH WARNINGS** (3 advisory: `platform.*` 2-segment key format is an inherited,
  pre-existing exception not new debt; 3 Open Questions correctly deferred to `/sdd-design`; C-4 order
  type coverage not explicitly stated). Status: `draft` → `spec-ready`.

## Session 2026-08-06T00:00:00Z — sdd-design (full mode, 5 rounds — hard cap)

- Phase 0 Recon: wrote `recon.md` (services: trading, config, ledger, ui). Confirmed `PlaceOrder` is
  the only currently-gated handler (`trading.go:244-246`); `ReplaceOrder`/`CancelOrder` are ungated;
  no `ClosePosition` RPC exists (closes are ordinary offsetting `PlaceOrder` calls, so FR-4's real
  scope is `PlaceOrder` + `ReplaceOrder`, not a fourth path). Found `SetConfig` is unconditionally
  ADMIN-scope-gated with no internal/service-to-service bypass — the same authz wall that broke 030's
  original automated-halt-fallback design. Found the config-ui editor's write path needs zero code
  change (already sends every value as `string_val`), but flagged an out-of-scope `ListKeys`/
  `value_data` staleness bug for a separate defect report. Flagged the critical cross-feature coupling
  with 030 (`design-approved`): 030's per-account persisted halt and this feature's platform-wide gate
  are orthogonal, both required, must not be conflated or unified.
- Round 1: proposer's initial approach widened `platform.maintenance_mode` from bool to string in
  place. Adversary CONFIRMED (via direct code read of `Watcher.GetBool`'s oneof handling) this is
  fail-open: a bool-typed watcher reading a string-shaped `ConfigValue` gets the zero value (`false`)
  on any type mismatch during rollout, silently disabling the halt exactly when it's needed. Abandoned
  in favor of a new parallel key, `platform.trading_state` (string enum: `ACTIVE`/`REDUCE_ONLY`/
  `HALTED`), leaving `platform.maintenance_mode` untouched.
- Round 2: resolved the widen-vs-parallel-key fork. Adversary found the proposed fail-closed-only-on-
  `NotFound` distinction for `GetPosition` errors was unimplementable — `portfolio_handler.go` wraps
  every error uniformly in `CodeNotFound`, so trading can't distinguish "no position" from "backend
  down." Also found the proposed config→ledger dependency for audit was largely redundant: an existing
  `config.config_audit` table (missed by initial recon) already captures every `SetConfig` write.
- Round 3: resolved by deciding REDUCE_ONLY fails closed on *any* `GetPosition` error (not just
  `NotFound`) and adopting `config.config_audit` as the audit mechanism instead of a new ledger
  dependency. Adversary's own claim that "`GetPosition` has zero current callers" (used to justify a
  cavalier fix) was disproven in the same round by the adversary's follow-up read, which found an
  internal `processOrderFill` caller and a UI position-detail-page caller — both confirmed unaffected
  by the fix, but the claim itself had to be corrected before round 4.
- Round 4: fixed the `GetPosition` error-code root cause at the source in `xstockstrat-portfolio`: a
  new `ErrPositionNotFound` sentinel, following the existing `ErrWatchlistNotFound` precedent (not
  `GetPortfolio`/`ListPositions`/`GetPnL`, which was the adversary's own earlier — and still wrong —
  citation, corrected in round 5). Also downgraded AC-4's audit "reason" field to boilerplate text,
  reasoning the DB/wire support for a real reason wasn't there — final adversary in round 5 reversed
  this, showing the support already existed and a real fix was cheap.
- Round 5 (hard cap, final adversary): **APPROVE WITH NOTED OPEN RISKS** (no Floor breach). Corrected
  the `ErrPositionNotFound` precedent citation (`ErrWatchlistNotFound`, confirmed exact this time).
  Reinstated the real reason-capture UI fix (`<Input>` in config-ui) over the round-4 boilerplate
  downgrade. Found the proposed WatchConfig-subscriber ledger-emit mechanism (an alternate audit path
  floated alongside `config.config_audit`) structurally broken — `ConfigValue`/`ConfigSnapshot` carry
  no actor/reason field and `config.Watcher` has no on-change hook at all; resolved by dropping that
  mechanism entirely (audit stays `config.config_audit`-only) and recording it as an unbuilt Open Risk
  instead of building it. Also caught the recon-inherited stream-key convention `trading_state:{account}`
  copy-pasted from 030's per-account convention despite this feature being platform/mode-scoped, not
  per-account — corrected as an Open Risk note (no code built against it, since the ledger-emit
  mechanism itself was dropped).
- Chosen approach: new parallel config key `platform.trading_state` (string enum, per-`trading_mode`
  seed rows), `platform.maintenance_mode` left untouched; a single shared gate function called from
  `PlaceOrder` (extended) and `ReplaceOrder` (new), `CancelOrder` permanently ungated (mirrors 030's
  own decision on its per-account gate, same rationale — operator's sole de-risk tool); REDUCE_ONLY
  fails closed on any `GetPosition` error via a new `ErrPositionNotFound` sentinel in
  `xstockstrat-portfolio`; audit via the existing `config.config_audit` table only; real reason-capture
  added to the config-ui editor; C-04 (enum-over-string) explicitly deferred, not permanently waived,
  since `trading_state` is deployment-time-closed but ships as `string` today for `Watcher`-oneof
  compatibility with the existing `maintenance_mode` mechanics. Rejected: bool→string in-place widen
  (confirmed fail-open), config→ledger audit dependency (redundant with `config_audit`), WatchConfig-
  subscriber ledger-emit (no actor/reason field, no on-change hook — structurally broken), fail-closed-
  only-on-`NotFound` (unimplementable given uniform `CodeNotFound` wrapping).
- Open Risks carried to `/sdd-spec`: (1) the fail-closed REDUCE_ONLY dependency on `GetPosition` needs
  further investigation at spec time (latency/availability impact on every `PlaceOrder` call); (2) the
  `trading_state:{account}` stream-key convention was corrected to a platform/mode-scoped key, not
  per-account — no ledger event is actually built in this design, so this is a note for if/when one
  is; (3) no automated-trigger authz path exists yet for a future non-human caller (e.g. 102's
  reconciliation ticker, 106/107) — deferred, human-operator-only for V1; (4) a 3-way migration-number
  contention with 023/030 (all want config migration `011`) needs resolving at `/sdd-spec` time;
  (5) confirm no regression to feature 096's UI consumer of `platform.maintenance_mode`; (6) a stale
  "automated halt trigger" approval-gate checkbox from the original product-spec should be flipped to
  reflect the human-only V1 decision; (7) recommend a future `fails.md` entry on the bool→string oneof
  fail-open trap for the next feature that considers widening an existing config key's type in place.
- Constitution rules touched: C-01, C-04 (deferred, not waived — see Open Risks), C-05, C-08/P-06,
  C-10(a) (shared gate function avoids per-handler copy-paste), C-10(b) (parity across `PlaceOrder`/
  `ReplaceOrder`), C-11, C-14, P-01, P-02, P-03, P-04, F-11. No Floor breach across any of the 5 rounds.
- Status: `spec-ready` → `design-approved`.
