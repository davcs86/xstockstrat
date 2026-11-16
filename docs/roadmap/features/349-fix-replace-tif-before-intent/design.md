# Design: fix-replace-tif-before-intent

**Created**: 2026-11-16
**Rounds**: 1 (quick; termination: approved)
**Approved by**: operator, delegated in the 2026-11-16 task handover (design depth `quick`, fix approach named there); no live gate was held — see context.md
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

One hunk in `ReplaceOrder` (`services/xstockstrat-trading/internal/service/trading.go`), D-1/D-2: the
`brokerReq` literal and the TIF block (`validateTIF` + `tifToWireString`; recon `trading.go:1607-1618`)
move up to sit right after `resolveAccount` (`:1558-1561`) and before `deriveReplaceCancelIntentID`
(`:1564`). Nothing else in the function changes: the gates above keep their order, and the dedup
claim and switch (`:1569-1602`), 347's `prevIntent` capture (`:1603`), the PENDING mark (`:1604`), the
broker call, the `ErrRateLimited` → `refuseRateLimitedMutation` branch (`:1620-1622`) and the finalize
paths stay as they are. This is where `PlaceOrder` validates (`:519-531`). `validateTIF` is pure and
`resolveAccount` takes only a read lock, so the move adds no lookup and no side effect.

Precedence (D-3): a disallowed TIF returns `InvalidArgument` whatever intent row already exists for
that content.

Tests (D-5): `internal/service/trading_replace_tif_test.go`, package `service`, real handler through
`newRLFakeHarness` with an IBKR pool entry; `fakeBroker` gains a `replaceOrderFn` hook.

| Scenario | Seam | On today's code |
|---|---|---|
| `@AC-1` refused TIF leaves nothing (OPG, CLS on IBKR; explicit UNSPECIFIED) | handler; `memIntentRepo` row count; service order map; default `fakeBroker` panics on a broker call | RED (1 row, PENDING) |
| `@AC-2` corrected retry, then the refused request again | handler; hook counts broker calls | RED (last step "still pending") |
| `@AC-3` allowed TIF claims one intent; identical replay collapses; no-TIF replace sends an empty TIF | handler; hook records the request | guard (passes) |
| `@AC-4` refusal beats an existing intent row | handler; UNKNOWN row seeded in `memIntentRepo.recs` | RED ("outcome is unknown") |

`@AC-1`'s "no intent-reclaim event … however long the caller waits" is covered by the zero-row
assertion: both reclaim paths act only on an existing PENDING row.

Docs (D-6): TRADING-7 and one sentence in `CLAUDE.md` § Order Replace.

Consumer surface: none (internal, C-14) — the RPC and its error code are unchanged.

## Rejected Alternatives

- `R-1` Release the intent on the TIF error path — TRADING-8 limits the delete to `broker.ErrRateLimited`.
- `R-2` Finalize the intent REJECTED on the TIF error path — still writes a row and a PENDING mark; a retry would replay it.
- `R-3` Validate from `order.BrokerType` at the top of the gate chain — second source of truth; reorders errors.
- `R-4` Move `resolveAccount` above the earlier gates — reorders unrelated errors for no gain.
- `R-5` A `tifWire` local, or an early validate with the wire assignment left in place — larger diff than the pure move.

## Open Risks

- [ ] Intent rows already stranded PENDING/UNKNOWN by this defect in a deployed database are not repaired (product-spec § Out of Scope); after the fix an identical retry no longer reclaims them reactively, the sweeper does, once per row. — no step; reported at the integration PR.

## Constitution Rules Touched

- `C-08` / `P-06` — honored by: the test step lands red before the service step; whole-package run is the pass condition.
- `C-13` — honored by: no new domain-data literal; test doubles reuse the package's helpers.
- `C-14` — honored by: internal-only, stated in the product spec.
- `C-15` — honored by: every `@AC-*` has a named test; `@AC-3` is labelled a guard.
- `C-16` — honored by: no existing rule changed (below); promotion planned at integration.
- `C-18` — honored by: a pure move; one hook instead of a fourth broker double.
- `F-04` — honored: every cited symbol was found by discovery.
- `TRADING-6`, `TRADING-8` (module rules) — honored by D-4; `TRADING-7` amended by D-6.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1`, `@AC-2`, `@AC-3` `@feature-202` (`services/xstockstrat-trading/acceptance/order-time-in-force-enum.feature`) — `validateTIF`, `tifToWireString` and `PlaceOrder` are not touched.
- PRESERVE `@AC-6`, `@AC-7`, `@AC-9` `@feature-267` (`…/fix-trading-order-state-audit.feature`) — the dedup/reclaim block and the final write are not moved.
- PRESERVE `@AC-16`, `@AC-31` `@feature-347` (`…/alpaca-adaptive-rate-limit.feature`) — `prevIntent` and the `ErrRateLimited` branch are not touched.
- EXTEND 202 `@AC-3` — 349 `@AC-1`, `@AC-2`, `@AC-4` add the same rejection, side-effect free, for `ReplaceOrder`.
