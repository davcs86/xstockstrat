# Design: fix-retired-surface-proto-cleanup

**Created**: 2026-11-13
**Rounds**: 3 (full; termination: approved — operator approval at the gate, Floor clear, O-1 unanswered)
**Approved by**: user @ 2026-11-13 (design-approval gate, /sdd-batch)
**Grounded in**: recon.md
**Debate register**: debate.md

> **Status hold (D-11).** The operator approved the design but recorded no answer to O-1. Under
> settled D-11, a recorded O-1 answer is a precondition for `spec-ready → design-approved`, so
> `status.md` stays `spec-ready`. `/sdd-spec` must not draft step 1 until an O-1 answer is recorded
> in context.md, and must then write exactly one unconditional step 1 (R-7).

---

## Chosen Approach

The fix is three sweeps of retired or drifting contract surfaces: the `trading_mode` config axis, the
server-side opportunity sparkline, and proto contract hygiene. They ship as one non-breaking proto
PR-unit followed by per-service cleanups. No new code mechanism is introduced, and no config
migration is added.

### 1. Proto PR-unit (D-2, D-13; recon.md:39-50, :258-265)

All edits are additive or deprecations. Field numbers are kept and no `reserved` is added
(`@AC-5 @feature-196`, recon.md:227).

- `analysis.proto:626`: `Opportunity.sparkline = 17` gets `[deprecated = true]` (recon.md:42).
- `marketdata.proto:333`: `BatchGetBarsRequest.timeframe = 2` is deprecated, and `Timeframe
  timeframe_enum = 7` is added. The comment copies the `marketdata.proto:89-92` "use timeframe_enum
  … once all callers migrate" wording, which is true here because its producers do switch (D-1, D-13;
  recon.md:44, :178).
- `indicators.proto:60`: `ComputeIndicatorRequest.timeframe = 6` is deprecated with a comment of the
  form "deprecated; ignored by the server". The indicators servicer reads neither field
  (`app/handlers/servicer.py:214-241`), and no caller switches (D-2), so the marketdata "once all
  callers migrate" wording must NOT be copied (D-13, R-9; recon.md:43).
  - Field 7 `timeframe_enum` depends on the O-1 answer (see § O-1 below). Under (A) it is added with
    the comment "accepted but ignored by the server; carried for contract parity with
    BatchGetBarsRequest". Under (B) it is not added.
- `trading.proto:336`: `SnapshotOfflinePositionsRequest.user_id = 2` is deprecated, reusing the
  `trading.proto:144` wording ("caller identity resolved from the x-user-id header; body value
  ignored") (recon.md:45, :186).
- `common.proto:21,28`: `Decimal` and `Error` get message-level `option deprecated = true;` plus a
  comment naming them unused. If `buf` rejects message-level deprecation, the fallback is
  comment-only deprecation (recon.md:46, :265).
- Then run `buf lint`, `buf breaking` against main-dev, and `./scripts/buf-gen.sh`.

### 2. BatchGetBars enum migration (D-1, R-1, R-2; recon.md:35, :87, :100, :119)

- The marketdata handler (`internal/service/marketdata_service.go:782`, which today resolves only
  from `req.Timeframe` at `:787-788`) reads `timeframe_enum` first via `timeframe.Resolve` and falls
  back to the string. This follows the `marketdata_service.go:267-269` precedent.
- All three producers send both `timeframe="1d"` and `timeframe_enum=TIMEFRAME_1DAY` during the
  deprecation window, because the deploy is not atomic:
  - analysis `servicer.py:5675-5677` (recon.md:119);
  - portfolio `internal/service/offline_valuation.go:170-176` (recon.md:87);
  - UI `services/xstockstrat-ui/src/hooks/useOhlcBars.ts:23-25`.
- Any edit to `services/xstockstrat-ui/e2e/mock-backend.ts:153-154,188-189` follows C-12 fixture
  homes (D-14).

### 3. trading_mode axis, option (a) (D-3, D-5, D-10; recon.md:52-60, :81-108, :123-155, :278-282)

- Delete the watcher resolvers and the `trading_mode` send in all 10 services' config watchers:
  - Python: analysis `app/config/watcher.py:28,47,63` (recon.md:108), indicators `:30,52,69`
    (recon.md:125), and ingest `:40,59,75` (recon.md:135).
  - Go: trading, portfolio and marketdata `NewWatcher(...)`, with the `tradingMode` parameter
    removed (recon.md:60, :83, :93).
  - Node: config `src/services/configWatcher.ts:8,41-42,51` (recon.md:142), plus the three
    byte-identical identity/ledger/notify copies, verified with `scripts/check-watcher-copies.sh`
    (recon.md:151-155, :192).
- Remove the marketdata `Paper` vestige (`NewLiveClient(settings, paper)` becomes
  `NewLiveClient(settings)`).
- Keep trading `Config.TradingMode` (`config.go:46`). It is the live `broker.paper` fallback read at
  `trading.go:2730,3743` and owned by feature 321. Name that consumer in trading's CLAUDE.md, which
  satisfies AC-1's "unless it names the consumer" (recon.md:54-59, :281-282).
- Remove `TRADING_MODE=paper` from the other service CLAUDE.md env blocks.
- Tests:
  - The Python watcher regression test asserts `trading_mode == TRADING_MODE_UNSPECIFIED` with
    `TRADING_MODE` patched, and does not use `HasField` (D-5, R-4). It uses the no-network
    `ConfigWatcher.__new__` + `snapshot_watcher` pattern (recon.md:129, :196).
  - Go P-06 (D-10): update the test call sites first (trading, portfolio and marketdata
    `config_test.go`, and the marketdata `NewLiveClient` test caller). The resulting test-package
    compile failure against the old signatures is the RED. Record it as "compile-only RED; no
    assertion-level RED because trading_mode is already omitted". If the tdd-gate rejects a compile
    RED, record a P-06 deviation instead. Never record "no RED possible".

### 4. Sparkline residue and config (D-4, D-7, D-8, R-3; recon.md:23-30, :161-165, :204-205, :269)

- No config migration 048 (R-3). Migration `046_config_dead_rows_prune.up.sql:11-14` already prunes
  `analysis`/`opportunity.sparkline_bars` and `marketdata`/`alpaca.paper`, gated on signed sha256
  matches (`:18-22`) (recon.md:28-30).
- AC-1's `alpaca.paper` clause is verified by a launch-gate query on dev and prod: query
  `config_keys_report_296` for an `unmatched-signed-tuple`, plus a `config_values` count (D-4).
- Durable `@AC-8 @feature-191` (`services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature:24`)
  loses only its `BatchGetBars … (sparkline)` clause (recon.md:204-205).
- Agent: the `list_opportunities` projection emits no `sparkline` key. The parity guard
  `tests/test_opportunity_projection.py:54-55` excludes deprecated descriptor fields, and the module
  docstring states that contract (D-7; recon.md:165).
- Docs: `docs/patterns/config-governance.md:153-154,311,416,549-550` only. No analysis CLAUDE.md
  step. `scripts/config-wiring-stored.json` and the `live_enrich_ttl` rows at governance `:422,473`
  are not touched, because feature 330 owns them (D-8).

### 5. SnapshotOfflinePositions carrier (D-9, D-6, R-6; recon.md:71-72, :186-188)

- The handler `internal/handler/trading.go:90` (`req.Msg.UserId = extractUserID(ctx)`) keeps its
  write under its own scoped `//nolint:staticcheck // SA1019`.
- In `internal/service/trading.go`, hoist exactly one
  `userID := req.UserId //nolint:staticcheck // SA1019…` at `:1174`. The reads at
  `:1178,1196,1274,1276,1284` use `userID`.
- Rewrite the `:1193-1194` ownership comment to name the local while keeping the invariant that the
  header overwrites the body (≤2 lines).
- The ListOrders/GetOrder reads at `:1646,1652,1730` are untouched, and the signature does not
  change.
- SA1019 nolint directives elsewhere, including `_test.go` (`trading_offline_test.go:677` helper,
  `:1398`; `trading_ownership_test.go:104`), are added only where golangci-lint flags them after
  buf-gen (D-6).

### 6. O-1: ComputeIndicatorRequest field 7 — UNANSWERED (D-11, D-12, R-5, R-7, R-8)

The operator must answer exactly one of these, recorded in context.md:

- **(A) keep field 7 `timeframe_enum`** — recommended. Matches `acceptance.feature:28` as written,
  and product-spec `:89` / Q5 `:114`. No artifact amendment is needed.
- **(B) deprecation-only** — deprecate the string and add no enum field. The D-12 edit set applies:
  - Drop indicators field 7 and its collision check against feature 310.
  - Reword `acceptance.feature:28`, keeping the `@AC-3` ID (C-15).
  - Amend product-spec.md `:45` (Expected), `:89` (Fix Scope row: split ComputeIndicatorRequest
    out as deprecation-only) and `:114` (Q5).
  - Append a context.md entry recording the answer.
  - This is a 322-local AC, so no C-16 durable sign-off is needed.

Silence is not an answer (R-5). Until an answer is recorded, status stays `spec-ready` (D-11).

### 7. Scope record (D-14)

`xstockstrat-ui` is a D-1 producer (`useOhlcBars.ts:25`), but product-spec.md:74-80 Affected
Services and the feature.md reviewers omit it. Add it to both, and record the amendment in
context.md, before `/sdd-spec` routes reviewers (C-14).

### Consumer surfaces (C-14)

- **Agent** `list_opportunities`: the `sparkline` key is gone, and `live_price` and the omission of
  absent fields are preserved (`@AC-15 @feature-095`, recon.md:246).
- **UI** opportunities OHLC strip: `useOhlcBars` sends both timeframe fields. Rendering is unchanged
  (`sparkline-ohlc-replacement.feature`, recon.md:250).
- Everything else (watchers, proto annotations, the trading carrier) is internal-only.

### Verification

- `buf lint` and `buf breaking` are clean against main-dev, and `proto-freshness` passes after
  `./scripts/buf-gen.sh`.
- golangci-lint passes for trading, portfolio and marketdata.
- `scripts/check-watcher-copies.sh` passes.
- The Python, Go and Node watcher tests pass.
- `trading_ownership_test.go` stays green.
- The agent projection parity test passes, and `test_guard_has_teeth` keeps its teeth.
- The D-4 launch-gate query returns no `unmatched-signed-tuple` for either key on dev and prod.

## Rejected Alternatives

- `R-1` Switching BatchGetBars producers to an enum-only request in the same PR as the server read — rejected because the deploy is not atomic and an old server would resolve an empty timeframe (fails 2026-07-29/080).
- `R-2` Leaving BatchGetBars producers on the string only — rejected because the enum would ship with no producer, recreating the stalled-deprecation drift (fails.md:1334).
- `R-3` Adding a duplicate config migration 048 for `sparkline_bars` and `alpaca.paper` — rejected because migration 046 already prunes both under evidence gating.
- `R-4` Using `HasField('trading_mode')` in the Python regression test — rejected because it raises `ValueError` on a non-optional proto3 enum.
- `R-5` Treating operator silence as acceptance of the O-1 keep-enum default — rejected as a silent guess (C-11, CLAUDE.md behaviour 1).
- `R-6` Deferring the choice between per-line nolint and a hoisted local to `/sdd-spec` — rejected because the directive count is already known, so deferring hands design's decision to the implementer (F-09).
- `R-7` A dual-branch (A)/(B) step 1 in implementation-spec.md with an `/sdd-execute` verifier that reads the O-1 answer from context.md — rejected because it defers a design choice into execution and forces step edits after spec (F-09). It is a near-variant of R-6.
- `R-8` (B′): option (B) plus deleting the six analysis writes of the ignored `ComputeIndicatorRequest.timeframe`, as the design recommendation — rejected because no AC requires it (CLAUDE.md #3) and it cuts against D-2's "no caller switch". It remains available only if the operator explicitly asks for it.
- `R-9` Copying the marketdata "use timeframe_enum … once all callers migrate" deprecation comment onto `indicators.proto:60` — rejected because it would be false: no indicators caller switches and the server reads neither field (fails.md:1334).

## Open Risks

- [ ] **O-1 unanswered (non-blocking objection; D-11 hold).** Approval came without an O-1 answer, so status stays `spec-ready` and 322 is stalled in the batch until the operator records (A) or (B) in context.md — to be addressed before `/sdd-spec` (gate precondition).
- [ ] The tdd-gate may reject a compile failure as RED for the Go watcher steps. If so, record a P-06 deviation (D-10) — to be addressed at the Go watcher steps.
- [ ] The hoisted-local refactor touches the ownership gate at `trading.go:1196`. `trading_ownership_test.go` must stay green, and the rewritten `:1193-1194` comment must keep the header-overwrites-body invariant — to be addressed at the trading carrier step.
- [ ] Adding `xstockstrat-ui` to scope (D-14) pulls the UI owner into review routing, and any `mock-backend.ts` edit must respect C-12 fixture homes — to be addressed before `/sdd-spec` (scope amendment) and at the BatchGetBars producer step.
- [ ] `buf breaking` has not been run with message-level deprecation on `common.v1.Decimal`/`Error`. The fallback is comment-only — to be addressed at proto step 1.
- [ ] Field number 7 may collide with in-flight features 310 (`indicators.proto`) and 312 (`trading.proto`). Re-check merge order — to be addressed at proto step 1.
- [ ] The generated TS field name `timeframeEnum` is unverified — to be addressed at the UI producer step (after buf-gen).
- [ ] Migration 046 may have left keep-and-report rows. The D-4 launch-gate query covers this — to be addressed at launch.
- [ ] The agent projection silently drops deprecated fields. The D-7 docstring states the contract — to be addressed at the agent step.

## Constitution Rules Touched

- `C-11` — honored by: the design gate ran 3 full rounds with operator approval. The one operator question (O-1) is recorded as unanswered rather than defaulted, and status is held under D-11.
- `C-12` — honored by: any `e2e/mock-backend.ts` edit uses the canonical `xstockstrat-ui` fixture homes (D-14).
- `C-14` — honored by: consumer surfaces (agent `list_opportunities`, UI OHLC strip) are named, and `xstockstrat-ui` is added to Affected Services and reviewers (D-14).
- `C-15` — honored by: `acceptance.feature` stays the single source of acceptance truth. Under (B), `@AC-3` is reworded with its ID kept.
- `C-16` — honored by: the one durable CHANGE (`@AC-8 @feature-191`) carries the 2026-11-10 operator sign-off. Every other durable rule is PRESERVE.
- `C-18` — honored by: O-1 records that `ComputeIndicatorRequest.timeframe_enum` would have no reader or producer, and leaves its fate to the operator rather than shipping it silently.
- `P-02` — honored by: the proposer and adversary reported only to the orchestrator and never coordinated laterally in any of the three rounds.
- `P-03` — honored by: O-1 is escalated to the operator rather than guessed (R-5), and unverified items (buf behavior, TS names, live 046 rows) are listed under Open Risks.
- `P-04` — honored by: design approval is recorded (feature.md Status History + context.md). The status transition itself waits for the recorded O-1 answer required by D-11.
- `P-06` — honored by: RED-first tests for Python and Node. Go uses a compile-only RED, with a recorded deviation path (D-10).
- `F-04` — honored by: nothing invented. buf behavior, TS names and live 046 row state are flagged as unverified.
- `F-09` — honored by: no design choice is left for an implementer to settle by editing step bodies (R-6, R-7). O-1 gates status instead of branching steps (D-11), so implementation-spec.md step 1 is written once, unconditionally.
- `PLAT-4` — honored by: identity propagation is unchanged. The deprecated `SnapshotOfflinePositionsRequest.user_id` stays handler-overwritten from `x-user-id` (D-9), and no outbound call changes its header forwarding.
- `PLAT-5` — honored by: no `x-access-scope` handling changes. The trading carrier refactor renames only the local that feeds the ownership gate at `trading.go:1196`, and `trading_ownership_test.go` must stay green.

Floor (`F-*`) status: no breaches.

## Business Rules Touched (C-16)

- CHANGE `@AC-8 @FR-6 @feature-191` "Live enrichment uses batch RPCs instead of per-symbol calls" (`services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature:19-25`) — drops only the `:24` "calls BatchGetBars once for all 30 symbols (sparkline)" clause. Signed off by the operator on 2026-11-10 (context.md, "Session 2026-11-10 (operator decisions before /sdd-design)").
- EXTEND `@AC-1 (322)` "No service sends or documents the retired trading_mode axis except the recorded trading fallback" — feature-local regression guard. It is not yet promoted, so no durable sign-off is needed.
- EXTEND `@AC-2 (322)` "The opportunity contract and consumers reflect the client-side sparkline" — feature-local regression guard. It is not yet promoted.
- EXTEND `@AC-3 (322)` "Proto contracts carry no stalled migrations or mislabelled caller identity" — feature-local regression guard. Its wording depends on the O-1 answer (D-12).
- PRESERVE `@AC-3..@AC-5 @feature-305` (`docs/sdd/business-rules/platform.feature`) — not regressed by: no migration is added and `deadRowVerdict` evaluator behavior is unchanged (D-4).
- PRESERVE `@AC-2 @feature-305` (`services/xstockstrat-config/acceptance/config-dead-rows-prune.feature`) — not regressed by: migration 046 stays the single prune path (R-3).
- PRESERVE `@AC-5 @FR-4 @regression @feature-196` (`platform.feature`) — not regressed by: deprecations keep field numbers and add no `reserved`, and `buf breaking` stays clean.
- PRESERVE `@AC-9 @FR-5 @regression @feature-196` — not regressed by: the deprecated `SnapshotOfflinePositionsRequest.user_id` stays server-ignored, and identity still comes from `x-user-id` (D-9).
- PRESERVE UI `sparkline-ohlc-replacement.feature` (opportunities OHLC strip, `services/xstockstrat-ui/acceptance/`) — not regressed by: the client-side sparkline is independent of field 17, and `useOhlcBars` keeps sending the string alongside the enum (D-1).

## Rounds

| Round | Date | +D | +R | O closed | +O | Progress |
|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | 8 | 4 | 0 | 3 | yes |
| 2 | 2026-11-11 | 2 | 2 | 2 | 0 | yes |
| 3 | 2026-11-13 | 4 | 3 | 0 | 0 | yes |

**Termination**: approved by the operator at the design gate after round 3 (full mode, within the 2–5 bound). The adversary judged round 3 SOUND, with no Floor breach and no REOPEN petitions. O-1 stays open (non-blocking) because no operator answer was recorded. Under D-11 that holds `status.md` at `spec-ready`.
