# Design: fix-ui-trader-feedback

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-10-22 (operator approval at the `/sdd-batch` design gate after round 2, approved as synthesized; Floor clear)
**Grounded in**: recon.md

---

## Chosen Approach

The fix is UI-only, in `services/xstockstrat-ui`. It has no proto, config, migration, env-var or backend change
(recon.md:160-172). Analysis and trading are read-only. Every change reaches its consumer surface directly: the
`/trader` segment (dashboard, orders, positions, `positions/[symbol]`, portfolio, header `AlertStream`) and the
`/insights` segment (opportunities, signal-sources, strategy detail). The build order is D-45 → D-64 → D-17 →
D-11 freshness → D-11 reconnect, which follows recon.md:206-227.

### 1. D-45: symbol-page backtest is fingerprinted (FR-4, AC-4)

- `positions/[symbol]/page.tsx:1149-1155` adds `strategyId: strategyId` next to `strategyIdRef` (recon.md:54).
  This copies the reference runner's pair (recon.md:55, :117).
- The analysis fingerprint gate needs `strategy_id == strategy_id_ref` (recon.md:72), so with this change the
  run reaches history and grade through the unchanged owner-scoped analysis path (recon.md:78-81).
- NC-D (`strategy_id=''` phantom rows) is deferred by operator decision. `_recompute_headline` writes no grade
  for an empty id (recon.md:78), so FR-4's floor is this one-liner. The existing inert `''` history rows are not
  cleaned up (recon.md:147).
- The e2e asserts that the RunBacktest request body carries both `strategyId` and `strategyIdRef` = `s-1`.

### 2. D-64: per-call handlers, global fallback, export (FR-5, AC-5, AC-6, AC-7, AC-10, AC-11)

**Per-call handlers.** These land before any opt-out flag is set.

- `signal-sources/page.tsx:257-260`: `handleToggle` gets `{ onError: (e) => setSaveError(errMessage(e)) }`.
  This reuses the page's own pattern (recon.md:58-60, :104).
- `opportunities/page.tsx:155-156`: `act` gets a per-call `onError` that writes a local `actionError`, shown in a
  `CardNotice` error (recon.md:57, :100-103).
- `errMessage` is hoisted to a new `src/lib/errMessage.ts` in this feature. It has three consumers:
  `signal-sources/page.tsx:137`, `config-ui/[namespace]/NamespaceEditor.tsx:24`, and opportunities (recon.md:60,
  :105, DRY guard rail).

**Ledger export (AC-7, AC-11).** `trader/portfolio/page.tsx:106-113` `onExportEvents` gets a try/catch plus
non-ok handling, and shows a `CardNotice` error (recon.md:61).

**Global fallback (AC-10).**

- `createQueryClient` (`lib/queryClient.ts:11-17`, recon.md:62, :107) gets `new MutationCache({ onError })`.
  Both providers pick it up through their existing call sites (`trader/providers.tsx:9`,
  `shared/QueryProviders.tsx:12`).
- `onError` writes a single-slot module store, `src/lib/mutationErrorStore.ts`, holding `{ message } | null`.
  - The newest error overwrites the slot.
  - The slot clears on dismiss and on pathname change.
  - There is no keyHash clear-on-success.
- The skip rule is `mutation.options.meta?.errorHandled === true` and nothing else. "handled" is never inferred
  from the presence of `onError`. This avoids the double report flagged at recon.md:193 without the silent-guard
  trap in `fails.md:116-132` (recon.md:202).
- Binding rule for setting the flag: a hook may carry `meta.errorHandled` only when **every** call site handles
  errors. Handling means one of:
  - a per-call `onError`;
  - a hook-level `onError` that actually displays something;
  - inline `.error`/`.isError` rendering.
- Required factory step: `useSetOpportunityAction` (`useOpportunities.ts:65-69`) and `useManageSignalSource`
  (`useSignalSourceMutations.ts:10-14`) are both built on `useInvalidatingMutation`, whose options type at `:17`
  carries only `mutationKey` and passes no `meta` at `:22`.
  - Widen `:17` to `options?: { mutationKey?: QueryKey; meta?: Record<string, unknown> }`.
  - Pass `meta: options?.meta` at `:22`.
  - Then flag both hooks.
- The no-op `onError`s (`return err`) in `useBacktest.ts:12-15` and `useScreenSymbols.ts:13-16` are deleted.
  - Their callers render `.error` inline: `[symbol]/page.tsx:1109`, `insights/strategies/[id]/page.tsx:65`
    (`runErrorObj`), `SymbolScreening.tsx:66-68` and `screener/page.tsx:92-94`. Both hooks therefore qualify for
    the flag.
  - Spec chooses between flagging them and leaving them unflagged, which accepts a double report.
- The opt-out inventory also carries `LiveStrategiesPanel.tsx:99` and `NamespaceEditor.tsx`.
- `components/shared/MutationErrorFallback.tsx` reads the store through `useSyncExternalStore`.
  - Its `getServerSnapshot` returns `null`, so SSR does not throw.
  - It renders the existing `Alert variant="destructive"` (`ui/alert.tsx:12`, recon.md:101) with `role="alert"`
    and a dismiss button. No toast library is added (recon.md:100).
  - It is mounted once in `trader/providers.tsx` and once in `shared/QueryProviders.tsx` (recon.md:194).
- The store and the skip predicate are pure, and each gets a Vitest test. That test also pins the TanStack v5
  assumption that `MutationCache` sees hook-level options only.
- `mutateAsync` has zero sites in `src` (grep), so the "no unhandled rejection" scope is `mutate()` only.

### 3. D-17: no PAPER default while the environment is unknown (FR-3, AC-3, AC-12)

- The display mode widens to `EnvironmentMode | null` through the five `?? 'paper'` pages, and the defaults are
  removed (recon.md:32-42).
- The `No ${mode} orders` copy strings handle `null` (recon.md:187).
- The proto mapping moves into one helper, `toPbTradingMode` in `src/lib/tradingMode.ts`. It replaces:
  - the `OrderForm.tsx:139` ternary (recon.md:44);
  - the four `toPbMode` copies (`useOrders.ts:31-32`, `usePortfolio.ts:8-9/:44-45/:68-69`, recon.md:46-47, :191).
- A `null` mode maps to `PbTradingMode.UNSPECIFIED`, and both orders and reads send UNSPECIFIED. Trading's
  `resolveTradingMode` derives the environment's mode from UNSPECIFIED (recon.md:90-93, :113-114), so trading
  needs no change.
- A known mode still maps to LIVE/PAPER exactly as before (PRESERVE @feature-095).
- `TradingModeBadge` already renders nothing for `null` (recon.md:50).
- Spec must cite the actual `tradingMode` field on each request message it touches (`fails.md:358`,
  recon.md:203).

### 4. D-11 freshness (FR-1, AC-1, AC-8)

- `pickFresherOrder` goes in a pure `src/lib/orderFreshness.ts` with a Vitest sibling, and is applied at the
  `OrdersTable.tsx:65-68` merge (recon.md:28).
- It compares `updatedAt` through `timestampToMillis` (`lib/protoTime.ts:11`, recon.md:110). The server stamps
  `updatedAt` on every mutation (recon.md:95).
- The newer `updatedAt` wins.
- On a tie, the streamed record is kept.
- An absent `updatedAt` counts as oldest, so an absent poll never displaces a streamed record (recon.md:112,
  :192; `insights.md:1551`).

### 5. D-11 reconnect (FR-2, AC-2, AC-9)

**Shared hook.** A new `src/hooks/useReconnectingStream.ts` is used by `useOrderUpdates` and `AlertStream`. It
replaces their silent `catch {}` blocks (recon.md:27, :30, :180).

- `onItem` is held in a ref.
- The effect is keyed on one primitive key (`filterKey`, `useOrderUpdates.ts:12`).
- `nextBackoffMs` lives in `src/lib/streamBackoff.ts`. It is exponential, capped at 30 s, and unit-tested.

**Reconnect policy.**

- Reconnect on any non-abort end: a clean OK end or a retryable error (Unavailable, Unknown/network, Internal,
  DeadlineExceeded). Both streams are meant to run forever (`trading.go:1684-1685`, `notifyServiceImpl.ts:119`;
  recon.md:94, :181).
- Stop with a terminal error state on PermissionDenied, InvalidArgument and other non-retryable codes. Spec fixes
  the exact code list.
- Unauthenticated stays with the existing `makeBrowserTransport` interceptor.
- Never reconnect on unmount or abort.

**Indicator.**

- The disconnected indicator clears on the first item of the new attempt, or once that attempt has stayed alive
  with no error for `STREAM_STABLE_MS`.
  - `STREAM_STABLE_MS` is about 3 s, a UI constant in `streamBackoff.ts`, with precedent at
    `useScreenSymbols.ts:24-27`.
- `onHeader` is not used to clear it, because the BFF opens the backend stream lazily inside its generators
  (`traderBff.ts:46-52`, `:85-91`).
- Spec may add a show-side debounce, showing the indicator only once the first reconnect attempt fails.

**Preserved.**

- The `AlertStream` merge still dedupes on `alertId` (`:42`, `:96`).
- The bell-badge fetch stays in its own mount-only effect (`AlertStream.tsx:18-31`), so a reconnect never
  re-runs it (PRESERVE @feature-203).

**e2e** (recon.md:118-127, :178-179).

- `e2e/mock-backend.ts` `streamAlerts` (`:530`) holds open until abort after yielding `ALERT_STREAM_ALL`, in
  place of the clean end.
- A new `streamOrderUpdates` mock handler also holds open until abort.
- Fixtures go in the canonical home (C-12/C-13).
- Failure injection is per-page (`page.route`, `insights.md:1160`).

**Trace.** Reconnects reuse `tradingClient`/`notifyClient`, so `x-trace-id` is still forwarded by
`src/middleware.ts` and the BFF `backendHeaders` (recon.md:172). This follows the operator's standing
trace-propagation decision (2026-10-21), with no C-03 waiver.

## Rejected Alternatives

- Inferring "handled" from `mutation.options.onError` in the `MutationCache` skip predicate — rejected because the no-op `onError`s (`useBacktest.ts:12-15`, `useScreenSymbols.ts:13-16`) would silently suppress the fallback (`fails.md:116-132`).
- Setting `meta.errorHandled` on the two hooks without changing `useInvalidatingMutation` — rejected as impossible: the factory's options type (`:17`) has no `meta`, and it passes none (`:22`).
- keyHash-matched clear-on-success in the fallback store — rejected because only watchlists set a `mutationKey` (`useWatchlists.ts:86-170`), so any keyless success would clear an unrelated error. That is silent under-reporting against FR-5, plus matching logic to maintain (C-18).
- Clearing the disconnected indicator on the connect `onHeader` — rejected because the BFF opens the backend stream lazily inside a generator (`traderBff.ts:46-52`, `:85-91`). Headers prove only that the BFF was reached, so the indicator would clear falsely and then flicker.
- Clearing the indicator only on the first message — rejected because quiet streams (no orders, no alerts) would never clear.
- Error-only reconnect that treats a clean end as final — rejected because both streams are meant to run forever (`trading.go:1684-1685`, `notifyServiceImpl.ts:119`). A clean end is the D-11 silent stop, and the bounded mock is a one-line fix.
- Retrying every error code forever — rejected because PermissionDenied and InvalidArgument never succeed, and Unauthenticated already has a transport interceptor.
- An opt-in global fallback (`meta.globalError`) — rejected because it contradicts AC-10's wording ("a mutation that declares no onError handler").
- A `useMutationState` cache-predicate fallback — rejected because failed mutations persist until `gcTime` and would show stale errors.
- A hook-level flag on `useManageSignalSource` with no per-call `handleToggle` handler — rejected because it silences AC-6. The per-call handler must land first.
- Deferring the `errMessage` hoist to spec — rejected because opportunities is already the third consumer (`signal-sources:137`, `NamespaceEditor:24`).
- Gating the D-17 reads on a known mode — rejected because it adds a dead loading state, and separate per-environment databases make the unfiltered UNSPECIFIED read safe.
- Fixing NC-D phantom rows in this feature — deferred by operator decision. The FR-4 floor is the D-45 one-liner.

## Open Risks

- [ ] `STREAM_STABLE_MS` (about 3 s, unmeasured) is a heuristic.
  - A late BFF→backend failure clears the indicator and then re-shows it.
  - A long window leaves quiet healthy streams marked "disconnected" after a reconnect.
  - The optional show-side debounce mitigates this. To be addressed at the D-11 reconnect step: spec fixes the value and the debounce.
- [ ] Edge (Cloudflare) idle timeouts on quiet streams will cause periodic reconnects and full snapshot replays. This is acceptable with dedupe plus debounce, but unmeasured. To be addressed at the D-11 reconnect step, with a verification note in the PR.
- [ ] The TanStack v5 behavior that `MutationCache` sees hook-level options only is unverified locally, because `node_modules` is absent. To be addressed at the D-64 global-fallback step: the Vitest predicate test pins it.
- [ ] Any miss in the flagged-or-not inventory produces a double report. The effect is cosmetic but spread across the UI. To be addressed at the D-64 global-fallback step: spec pins the inventory with a grep check (P-03).
- [ ] The e2e infrastructure is unproven.
  - The in-process mock may not hold `streamOrderUpdates`/`streamAlerts` open until abort.
  - `page.route` may not be able to inject an error and then a recovery per page.
  - To be addressed at the D-11 reconnect step, which lands last.
- [ ] After a successful retry, the fallback banner lingers until dismiss or navigation. This is the accepted visible trade-off. To be addressed at the D-64 global-fallback step: document it in the PR.
- [ ] It is not verified line by line that `OrderForm` shows paper/live only through `TradingModeBadge` or the `mode` prop (AC-12). To be addressed at the D-17 step: spec reads `OrderForm.tsx` in full.

## Constitution Rules Touched

- `C-01` — honored by: every architectural claim cites recon.md or a verified path:line. The round-2 false claim about `useInvalidatingMutation` was corrected against the worktree.
- `C-03` — honored by: the operator's standing trace decision. Reconnects and all touched calls reuse the existing clients, so `x-trace-id` is forwarded by the middleware and BFF. No waiver.
- `C-11` — honored by: a full-mode recon and a 2-round debate before spec. NC-D is deferred by recorded operator decision.
- `C-12` / `C-13` — honored by: new stream mocks and domain fixtures live in `e2e/fixtures/` and `e2e/mock-backend.ts` with `INVENTORY.md` rows. Error payloads stay inline.
- `C-15` — honored by: AC-1..AC-12 in `acceptance.feature` are the single source of acceptance truth. Each step maps to its ACs.
- `C-16` — honored by: the Business Rules section below. EXTEND and PRESERVE only, with no CHANGE.
- `C-17` — honored by: reuse of the `Alert`/`CardNotice` primitives with design-role tokens, `role="alert"` and a dismiss control, and no new toast library. Spec names the fallback's placement relative to `PlatformHeader` and the mobile `BottomTabBar` `pb-20` clearance, citing `docs/patterns/ui-ux-governance.md`.
- `C-18` — honored by: dropping keyHash matching. The fallback logic is minimal: single slot, overwrite, clear on dismiss or navigation.
- `F-04` — honored by: nothing invented. Unverified items are listed in Open Risks.
- `F-07` — honored by: no hardcoded config values. `STREAM_STABLE_MS` and the backoff cap are UI-local constants with precedent (`useScreenSymbols.ts:24-27`), not config keys.
- `P-02` — honored by: proposer and adversary exchanges were mediated through the synthesized state.
- `P-03` — honored by: the opt-out inventory is pinned by a grep check in spec, covering `onError`, `.isError`, `.error &&`, `mutation.error` and inline rendering.
- `PLAT-N1` — honored by: failures surface (indicator, terminal error state, fallback banner) and are never swallowed. This replaces the silent `catch {}` blocks.

## Business Rules Touched (C-16)

No CHANGE is made, so no sign-off is required. The operator approval at the 2026-10-22 design gate (context.md)
covers the design as a whole.

**This feature's own scenarios** (`docs/roadmap/features/270-fix-ui-trader-feedback/acceptance.feature`):

- EXTEND `@AC-1 @FR-1` — new case: a newer polled `updatedAt` displaces a stale streamed order.
- EXTEND `@AC-2 @FR-2` — new case: the order stream shows a disconnected indicator on drop, then reconnects.
- EXTEND `@AC-3 @FR-3` — new case: an unknown environment sends `TRADING_MODE_UNSPECIFIED` and shows no Paper label.
- EXTEND `@AC-4 @FR-4` — new case: the symbol-page RunBacktest carries both `strategyId` and `strategyIdRef`.
- EXTEND `@AC-5 @FR-5` — new case: a failed Snooze/Dismiss/Take shows an error.
- EXTEND `@AC-6 @FR-5` — new case: a failed signal-source toggle shows an error.
- EXTEND `@AC-7 @FR-5` — new case: an HTTP 500 ledger export shows an error.
- EXTEND `@AC-8 @FR-1` — new case: on an equal timestamp the streamed record is kept.
- EXTEND `@AC-9 @FR-2` — new case: the alert stream disconnects and recovers.
- EXTEND `@AC-10 @FR-5` — new case: the global mutation fallback fires for a mutation with no handler.
- EXTEND `@AC-11 @FR-5` — new case: a rejected export request shows an error with no unhandled rejection.
- EXTEND `@AC-12 @FR-3` — new case: no Paper label on any of the five trader pages while the mode is unknown.

**Existing guards:**

- PRESERVE `@AC-10 @FR-5 @feature-095` "The order ticket's execution path is unchanged" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — not regressed by: `toPbTradingMode` still maps a known mode to LIVE/PAPER. Only `null` becomes UNSPECIFIED.
- PRESERVE `@AC-5 @FR-5 @feature-202` "The trader form sends the TIF as a Connect-JSON NAME-string" (`services/xstockstrat-ui/acceptance/order-time-in-force-enum.feature`) — not regressed by: enum fields stay on the wire as NAME-strings, so UNSPECIFIED serializes as `TRADING_MODE_UNSPECIFIED`.
- PRESERVE `@AC-6 @FR-5 @FR-6 @feature-203` "The notifications inbox shows level, module, body, and unread state" (`services/xstockstrat-ui/acceptance/alert-read-unread-persistence.feature`) — not regressed by: the bell badge is fetched once in its own mount-only effect, and a reconnect never re-runs it.
- EXTEND `@AC-9`/`@AC-10 @FR-8 @feature-031` and `@AC-9 @FR-8 @feature-021`, and PRESERVE the remaining guards listed in recon.md:131-149 — not regressed by: OrderForm's quantity and sizing routing, the offline-account rules, the export success path and the analysis owner-scoping are all untouched.

## Rounds

- **Round 1 (full):** the base approach was settled: the D-45 one-liner, `toPbTradingMode`, `pickFresherOrder`, and the export try/catch. Three items stayed blocking: the double-report mechanism, fallback-store staleness, and when the indicator clears.
- **Round 2 (full):**
  - The three round-1 blockers were closed by:
    - per-call handlers plus a call-site-audited flag;
    - a single-slot store;
    - clearing the indicator on the first item or after a stable window, with `onHeader` rejected.
  - The adversary raised two new blocking items, both confirmed in the worktree:
    - `useInvalidatingMutation.ts:17,22` has no `meta`;
    - the no-op `onError`s would fool an inference predicate.
  - Both were folded into the synthesis as one-line fixes.
- **Termination:** approved. The operator approved as synthesized at the 2026-10-22 design gate, including the `meta` passthrough, meta-only opt-out and no-op `onError` removal. No Floor breaches.
