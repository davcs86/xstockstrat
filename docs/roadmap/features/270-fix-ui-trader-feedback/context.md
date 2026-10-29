# Context Log: fix-ui-trader-feedback

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-ui-trader-feedback-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-11, D-17,
  D-45, D-64 (plus needs-confirmation NC-D recorded as an open question).
- Severity: SEV-2 (group severity; D-64 alone was rated one tier lower by the surveyor). Impact type:
  misleading-trading-ui. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..7), context.md.
- Affected services: xstockstrat-ui (fix site); xstockstrat-analysis (D-45 semantics, NC-D); xstockstrat-trading
  read-only (D-17 server-side mode derivation).
- Root cause hypothesis: fire-and-forget stream hook with no freshness rule (D-11); display default leaking into
  requests (D-17); half-copied request shape (D-45); per-call `onError` omitted with no global fallback (D-64).
- Re-verification on main-dev @ a053b0e: all four reproduce in code. Line drift: D-11 unchanged
  (`useOrderUpdates.ts:25-27`, `OrdersTable.tsx:66`, `AlertStream.tsx:44`); D-17 page lines unchanged,
  `AccountContext.tsx:60` → `:61-62`, plus `OrderForm.tsx:139` (where PAPER enters the request); D-45 unchanged
  (`positions/[symbol]/page.tsx:1144`, `:1149-1158`; `insights/strategies/[id]/page.tsx:101-103`; analysis
  `servicer.py:865-870`); D-64 unchanged (`opportunities/page.tsx:155-156`, `signal-sources/page.tsx:254-262`,
  `trader/portfolio/page.tsx:108-113`).
- D-17 server contract checked: trading `resolveTradingMode` (`services/xstockstrat-trading/internal/service/trading.go:3570-3581`)
  maps `TRADING_MODE_UNSPECIFIED` to the environment's mode (`trading.broker.paper` / `TRADING_MODE`), so sending
  UNSPECIFIED needs no trading change.
- **Open question (NC-D):** does `strategy_id=''` create or overwrite a phantom `''` row in
  `analysis.strategy_scores_v2`? Partial evidence: `_recompute_headline` (`servicer.py:2811-2826`) resolves
  `get_by_owner_and_id(user_id, '')` first and returns `None` on a miss, so the headline path likely no-ops; but the
  run-history / per-symbol cell rows (`servicer.py:1280-1310`) are persisted keyed `''`. Settle in design: if
  phantom score rows exist, the fix needs an analysis guard (reject or ignore empty `strategy_id` with
  `strategy_id_ref`) and possibly a cleanup of existing `''` rows (which would add a migration and DBA review).
- **Overlaps:** 245-fix-screener-symbol-isolation (`implementation-ready`) edits `positions/[symbol]/page.tsx`
  (EmptyState host, `:66`); 246-fix-fundsignal-neutral-score (`implementation-ready`) edits
  `insights/opportunities/page.tsx`; launched 240-offline-account-full-pnl last touched `positions/[symbol]` and
  `trader/portfolio/page.tsx`. Expect textual conflicts; check `merge-order.md`. Related: feature-gap I-15 (unpriced
  guard) is out of scope. Sibling batch feature 272-fix-analysis-backtest-bounds (created concurrently, D-28/D-29)
  touches analysis `RunBacktest` — coordinate if NC-D adds an analysis guard there.
- Recommended design depth: full → `/sdd-design fix-ui-trader-feedback` (rationale: affected services ≥ 2 — ui +
  analysis for D-45/NC-D). The fix site is likely UI-only, so the operator may downgrade to
  `/sdd-design fix-ui-trader-feedback quick`; escalation stays warranted if NC-D confirms phantom rows. Design forks:
  D-17 send UNSPECIFIED vs block order entry; D-64 global mutation `onError` toast vs per-site handlers; D-11
  freshness by `updatedAt` vs dropping stream records on each poll.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Development branch: feature/fix-ui-trader-feedback

## Session 2026-10-22 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict PASS WITH WARNINGS (0 fails, 0 floor
  breaches); overlap verdict WARN (file-level only).
- Warnings (resolved in this session unless noted):
  - C-15: FR-2 alert stream had no scenario. **Resolved:** added AC-9 (alert stream disconnect + reconnect).
  - C-15: FR-5 global mutation `onError` fallback (`lib/queryClient.ts`) had no scenario. **Resolved:** added AC-10.
  - AC-3 checked the Paper label only on `/trader`. **Resolved:** added AC-12 (Scenario Outline over `/trader`,
    `orders`, `positions`, `positions/AAPL`, `portfolio`). AC-3's `tradingMode` request assertion is kept as an
    API-boundary check. **Open:** none.
  - AC-7 disjunction. **Resolved:** AC-7 is now HTTP 500 only; the rejected-request case is AC-11.
  - AC-5..AC-7/AC-11 say only "an error message is shown" with no concrete text or location. **Open:** design
    picks the error surface (global toast vs per-site handlers, a fork already listed for D-64); the e2e then
    asserts that surface.
  - AC-4's history Then relies on the existing analysis fingerprint rule (NC-D, unchanged). **Open:** the e2e/mock
    must assert the RunBacktest request shape (`strategyId` and `strategyIdRef` both `s-1`).
  - Fix Scope template note `(Update after investigation...)`. **Resolved:** removed.
  - Reviewer verified against code: `resolveTradingMode` (`trading.go:3573-3577`), the five `environmentMode ??
    'paper'` defaults, `OrdersTable.tsx:66`, and the `strategyIdRef` senders. Not re-verified: the analysis
    `servicer.py` NC-D cites, the hook, `AlertStream`, `queryClient` and the portfolio export cites — recon
    re-checks them.
- Overlap findings (WARN, rebase-only; no config, proto or migration collision; no merge-order entry):
  - `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — 215-block-fundamentals-strategy-on-etf
    (in-progress, `implementation-spec.md:1271`, `:1288`); different regions.
  - `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — 215 (`implementation-spec.md:1267`, `:1281`)
    and 246-fix-fundsignal-neutral-score (implementation-ready, `implementation-spec.md:59`); whichever lands second
    rebases.
  - `services/xstockstrat-ui/src/lib/traderBff.ts` — candidate only (270 does not yet name a BFF edit) vs
    263-fix-edge-owner-scope (draft, D-25, `traderBff.ts:118-126`); flag at impl-spec time if 270 edits the BFF.
  - Low-risk shared context, no collision: 271, 245, 244, 256, 267, 262, 255, 261, 265.
- NC-D: the product spec records a code-read resolution (no grade row; inert `""` history rows; FR-4 UI-only).
  Per the operator decision below, that is treated as the floor and `/sdd-design` recon confirms or overturns it
  (C-11); an analysis guard or cleanup migration would re-open scope.
- OPERATOR DECISIONS (binding, recorded 2026-10-22):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C (precedent #1264).
  - Scope is D-11, D-17, D-45, D-64.
  - Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
  - NC-D (strategy_id='' phantom rows) is deferred to /sdd-design recon per C-11; the review may mark it [x] Deferred with FR-4 scoped to the UI fix as the floor.
- Next: `/sdd-design fix-ui-trader-feedback`.

## Session 2026-10-22 — sdd-batch design gate (round 2)

Full-mode `/sdd-design` debate halted at the approval gate after round 2 (gate policy: halt). Per the grilling
protocol, `design.md` is not written and `status.md` stays `spec-ready`.

### Open Threads

- **Approach (synthesis r2):** UI-only fix in `services/xstockstrat-ui`. No proto, config, migration or backend
  change. Build order is D-45 → D-64 → D-17 → D-11 freshness → D-11 reconnect.
  - FR-4: one-liner at `[symbol]/page.tsx:1149-1155`.
  - FR-3: `toPbTradingMode` in `lib/tradingMode.ts`. Mode widens to `EnvironmentMode|null`, the `?? 'paper'`
    defaults are removed, and reads send UNSPECIFIED.
  - FR-1: `pickFresherOrder` in `lib/orderFreshness.ts` with a Vitest sibling, applied in `OrdersTable.tsx:65-68`.
  - FR-5 / D-64: per-call handlers in signal-sources and opportunities, plus an `errMessage` hoist to
    `src/lib/errMessage.ts` (3 consumers).
    - The global `MutationCache.onError` fallback writes a single-slot `mutationErrorStore`. A newer error
      overwrites the slot, and the slot clears on dismiss or pathname change.
    - `MutationErrorFallback` uses `useSyncExternalStore` with a null server snapshot. It is mounted once per
      provider.
    - The only opt-out is `meta.errorHandled === true`. A hook may carry it only when every one of its call sites
      handles errors.
    - `useInvalidatingMutation.ts:17,22` gains a `meta` passthrough.
    - The no-op `onError`s in `useBacktest`/`useScreenSymbols` are deleted.
  - AC-7/AC-11: ledger export try/catch plus CardNotice.
  - FR-2 / D-11: new `useReconnectingStream` with `nextBackoffMs` (capped at 30 s).
    - It reconnects on any non-abort end (clean OK or a retryable code) and stops terminally on
      PermissionDenied/InvalidArgument.
    - The indicator clears on the first item or after `STREAM_STABLE_MS`. Clearing on `onHeader` was rejected.
    - The e2e mock streams stay open until abort.
- **Strongest open objections (BLOCKING, 2):**
  - **(a) C-01/F-04 evidence:** r2 claimed that neither flagged hook is built on `useInvalidatingMutation`. That
    is false (`useOpportunities.ts:65-69`, `useSignalSourceMutations.ts:10-14`), and the factory has no `meta`
    (`:17`, `:22`). The proposer must accept the passthrough step, and spec must cite those lines.
  - **(b) Silent guard (fails.md:116-132):** the predicate "onError set ⇒ handled" would be fooled by the no-op
    `onError`s at `useBacktest.ts:12-15` and `useScreenSymbols.ts:13-16`. The proposer must commit to the
    meta-only predicate.
  - Both fixes are one-liners already folded into the synthesis. They stay blocking only until the proposer states
    them. The 7 non-blocking items (clean-end reconnect, retryable-code gating, keyHash drop, SSR snapshot, C-17
    placement, P-03 inventory check, C-16 PRESERVE guards) are recorded in the state block below.
- **Floor status:** no breaches. F-07 was checked, and the UI-local constants have precedent.
- **@AC changes not covered by an operator decision:** all twelve 270 ACs (AC-1..AC-12) are EXTEND. The guards
  @AC-10 @feature-095, @AC-5 @feature-202 and @AC-6 @feature-203 are PRESERVE. There is no CHANGE, so no operator
  sign-off is needed.
- **Trace:** reconnects reuse `tradingClient`/`notifyClient`, so x-trace-id is still forwarded under the standing
  operator decision (no C-03 waiver).
- **Next:** re-run `/sdd-batch` to resume the debate at round 3 from the state below, or have the operator
  approve once the proposer accepts (a) and (b).

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "UI-only fix in services/xstockstrat-ui, with no proto, config, migration or backend change. The build order stays D-45 → D-64 → D-17 → D-11 freshness → D-11 reconnect. D-45, D-17 and D-11 freshness are unchanged from the r1 synthesis:\n- FR-4: the one-liner at [symbol]/page.tsx:1149-1155.\n- FR-3: toPbTradingMode in lib/tradingMode.ts, mode widened to EnvironmentMode|null, the `?? 'paper'` defaults removed, and reads send UNSPECIFIED.\n- FR-1: pickFresherOrder in lib/orderFreshness.ts, with a Vitest sibling, applied in OrdersTable.tsx:65-68.\n- AC-7/AC-11: the ledger export try/catch plus CardNotice.\n\nr2 changes below. They adopt r2's answers to the three earlier blocking items and the adversary's r2 corrections. Each correction is checked against the wf_dcd9f6a8 worktree.\n\n1. D-64 per-call handlers (AC-5, AC-6).\n- signal-sources/page.tsx:257-260: handleToggle gets `{ onError: (e) => setSaveError(errMessage(e)) }`.\n- opportunities/page.tsx:155-156: `act` gets a per-call onError that writes a local actionError, shown in a CardNotice error.\n- errMessage moves to a new src/lib/errMessage.ts in this feature. It has three consumers: signal-sources/page.tsx:137, config-ui/[namespace]/NamespaceEditor.tsx:24, and opportunities (DRY guard rail).\n\n2. Opt-out flag: meta-only, no inference from onError.\n- The MutationCache skip rule is `mutation.options.meta?.errorHandled === true` and nothing else. The branch \"mutation.options.onError is set ⇒ handled\" is dropped. useBacktest.ts:12-15 and useScreenSymbols.ts:13-16 have no-op onError bodies (`return err`), and inferring \"handled\" from them would silence their callers.\n- Binding rule: a hook may carry meta.errorHandled only when every call site handles errors. Handling means a per-call onError, a hook-level onError that actually displays, or inline .error/.isError rendering. Spec lists each flagged hook with its call sites.\n- Order of work: the per-call handler lands first, the flag second.\n- useInvalidatingMutation passthrough is now a required step. useSetOpportunityAction (useOpportunities.ts:65-69) and useManageSignalSource (useSignalSourceMutations.ts:10-14) are both built on useInvalidatingMutation. Change useInvalidatingMutation.ts:17 to `options?: { mutationKey?: QueryKey; meta?: Record<string, unknown> }` and pass `meta: options?.meta` at :22. Then flag both hooks.\n- No-op onErrors: delete them from useBacktest.ts and useScreenSymbols.ts. Their callers render .error inline ([symbol]/page.tsx:1109, insights/strategies/[id]/page.tsx:65 runErrorObj, SymbolScreening.tsx:66-68, screener/page.tsx:92-94), so both hooks qualify for the flag under the rule. Spec decides between flagging them and leaving them unflagged and double-reporting.\n- The inventory also carries LiveStrategiesPanel.tsx:99 and NamespaceEditor.tsx.\n\n3. Global fallback (AC-10).\n- createQueryClient (lib/queryClient.ts:11-17) gets `new MutationCache({ onError })`.\n- onError writes a single-slot module store, src/lib/mutationErrorStore.ts, holding `{ message } | null`. The newest error overwrites the slot. The slot clears on dismiss and on pathname change.\n- The keyHash clear-on-success logic is dropped. Only watchlists set mutationKey (useWatchlists.ts:86-170), so key matching meant \"any keyless success clears\", which is under-reporting against FR-5. A lingering banner is the safer, visible failure.\n- components/shared/MutationErrorFallback.tsx reads the store with useSyncExternalStore and provides a getServerSnapshot that returns null, so SSR does not throw. It renders Alert variant=\"destructive\" with role=\"alert\" and a dismiss button.\n- It is mounted once in trader/providers.tsx and once in shared/QueryProviders.tsx. Spec confirms the trader/insights/config-ui/accounts layouts mount exactly one provider each, never nested. Spec names the placement relative to PlatformHeader and BottomTabBar pb-20 against docs/patterns/ui-ux-governance.md.\n- The store and the skip predicate are pure and get a Vitest test. That test also pins the TanStack v5 assumption that MutationCache sees hook-level options only.\n- mutateAsync: zero sites in src (grep), so the \"no unhandled rejection\" scope is mutate() only.\n\n4. D-11 reconnect (AC-2, AC-9).\n- New src/hooks/useReconnectingStream.ts:\n  - onItem is held in a ref, and the effect is keyed on one primitive key (filterKey in useOrderUpdates.ts:12).\n  - nextBackoffMs in src/lib/streamBackoff.ts: exponential, capped at 30 s, unit-tested.\n- Reconnect policy:\n  - Reconnect on any non-abort end, whether a clean OK or a retryable error (Unavailable, Unknown/network, Internal, DeadlineExceeded). Both streams are meant to run forever (trading.go:1684-1685, notifyServiceImpl.ts:119).\n  - Stop with a terminal error state on PermissionDenied, InvalidArgument and other non-retryable codes.\n  - Unauthenticated stays with the existing makeBrowserTransport interceptor.\n  - Never reconnect on unmount or abort.\n- e2e mock change: e2e mock-backend streamAlerts (:530) stays open until abort after it yields ALERT_STREAM_ALL, replacing the clean end. A new streamOrderUpdates mock handler holds open until abort, in the canonical fixture home (C-12/C-13).\n- Indicator:\n  - It clears on the first item of the new attempt, or after that attempt stays alive with no error for STREAM_STABLE_MS (~3 s, a UI constant in streamBackoff.ts, precedent useScreenSymbols.ts:24-27).\n  - onHeader is rejected: the BFF opens the backend stream lazily inside generators (traderBff.ts:46-52, 85-91).\n  - Spec may add a show-side debounce: show the indicator only once the first reconnect attempt fails, to damp edge idle-timeout flicker.\n- Other preserved behavior:\n  - The AlertStream merge dedupes on alertId (:42, :96).\n  - The bell-badge fetch stays in its own mount-only effect (AlertStream.tsx:18-31).\n  - Reconnects reuse tradingClient/notifyClient, so x-trace-id is still forwarded by the middleware and BFF backendHeaders, per the operator's trace decision and C-03 with no waiver.",
    "open_objections": [
      {
        "text": "[BLOCKING, C-01/F-04 evidence, fails.md:358] r2 claimed neither flagged hook is built on useInvalidatingMutation. That is false: useOpportunities.ts:65-69 and useSignalSourceMutations.ts:10-14 both return useInvalidatingMutation, and its options type at :17 accepts only mutationKey and passes no meta at :22. The synthesis makes the meta passthrough (useInvalidatingMutation.ts:17,22) a required step. The proposer has not yet accepted this, and spec must cite those lines. Resolution is a one-line change and stays inside the approach.",
        "blocking": true
      },
      {
        "text": "[BLOCKING, fails.md:116-132 silent guard, FR-5/AC-10] The skip predicate 'mutation.options.onError set ⇒ handled' silences hooks whose onError is a no-op: useBacktest.ts:12-15 and useScreenSymbols.ts:13-16 both just return err. The synthesis adopts the fix: meta.errorHandled is the only opt-out, and the no-op onErrors are deleted or the two hooks go into the inventory. All four current callers render .error inline (verified), so today's risk is latent. The proposer must commit to the meta-only predicate before approval.",
        "blocking": true
      },
      {
        "text": "[Non-blocking, FR-2] Reconnect on a clean non-abort end, not only on error. The synthesis adopts this together with a mock-backend.ts:530 streamAlerts change that holds the stream open until abort. It reverses r1's rejected alternative, because an OK end on a forever-stream (trading.go:1684-1685) recreates D-11 silently. The proposer should confirm. alert-stream.spec.ts needs only the first 3 items.",
        "blocking": false
      },
      {
        "text": "[Non-blocking, FR-2] Gate reconnect on retryable codes and give a terminal error on PermissionDenied/InvalidArgument. Optionally debounce the show side so Cloudflare idle cuts do not flash the indicator. Spec fixes the code list.",
        "blocking": false
      },
      {
        "text": "[Non-blocking, C-18/FR-5] Drop keyHash clear-on-success in favour of overwrite plus clear on dismiss/pathname change. The synthesis adopts this. Lingering is visible and under-reporting is silent.",
        "blocking": false
      },
      {
        "text": "[Non-blocking, SSR] MutationErrorFallback must supply a getServerSnapshot that returns null. Spec must confirm one provider per segment layout with no nesting.",
        "blocking": false
      },
      {
        "text": "[Non-blocking, C-17] Spec names the fallback Alert's placement relative to PlatformHeader and the mobile BottomTabBar pb-20 clearance, citing docs/patterns/ui-ux-governance.md.",
        "blocking": false
      },
      {
        "text": "[Non-blocking, P-03] The opt-out inventory greps for onError, .isError, .error &&, mutation.error and inline rendering, and covers LiveStrategiesPanel.tsx:99, insights/strategies/[id]/page.tsx:65/327, NamespaceEditor.tsx, SymbolScreening.tsx:66, screener/page.tsx:92. Spec pins the list with a check.",
        "blocking": false
      },
      {
        "text": "[Non-blocking, C-16] PRESERVE guards are spec constraints: @AC-10 @feature-095 (known mode still sends LIVE/PAPER), @AC-5 @feature-202 (UNSPECIFIED sent as the NAME string), @AC-6 @feature-203 (bell badge fetched once on mount, and reconnect must not re-run that effect).",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 @FR-1 (270)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @FR-2 (270)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @FR-3 (270)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 @FR-4 (270)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @FR-5 (270)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 @FR-5 (270)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 @FR-5 (270)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 @FR-1 (270)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9 @FR-2 (270)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-10 @FR-5 (270)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-11 @FR-5 (270)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-12 @FR-3 (270)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-10 @FR-5 @feature-095",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-202",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 @feature-203",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Inferring 'handled' from mutation.options.onError in the MutationCache skip predicate: lost because no-op onErrors (useBacktest.ts:12-15, useScreenSymbols.ts:13-16) would silently suppress the fallback (fails.md:116-132).",
      "Setting meta.errorHandled on the two hooks without changing useInvalidatingMutation: impossible, because the factory's options type (:17) has no meta and it passes none (:22).",
      "keyHash-matched clear-on-success in the fallback store: lost because only watchlists have mutationKeys, so any keyless success clears an unrelated error. That is silent under-reporting against FR-5, plus matching logic to maintain (C-18).",
      "Clearing the disconnected indicator on connect onHeader: lost because the BFF opens the backend stream lazily inside a generator (traderBff.ts:46-52, 85-91), so headers prove only that the BFF was reached. It would clear falsely and then flicker.",
      "Clearing the indicator only on the first message: lost because quiet streams (no orders, no alerts) never clear.",
      "Error-only reconnect that treats a clean end as final: lost because both streams are meant to run forever (trading.go:1684-1685, notifyServiceImpl.ts:119), so a clean end is the D-11 silent stop. The bounded mock is a one-line fix.",
      "Retrying every error code forever: lost because PermissionDenied/InvalidArgument never succeed. Unauthenticated already has a transport interceptor.",
      "Opt-in global fallback (meta.globalError): lost because it contradicts AC-10's wording ('a mutation that declares no onError handler').",
      "useMutationState cache-predicate fallback: lost because failed mutations persist until gcTime and show stale errors.",
      "Hook-level flag on useManageSignalSource with no per-call handleToggle handler: lost because it silences AC-6. The per-call handler must land first.",
      "Deferring the errMessage hoist to spec: lost because opportunities is the third consumer now (signal-sources:137, NamespaceEditor:24).",
      "Gating D-17 reads on a known mode: lost because it adds a dead loading state, and separate per-environment DBs make the unfiltered read safe.",
      "Fixing NC-D phantom rows here: deferred by operator decision. The FR-4 floor is the D-45 one-liner."
    ],
    "open_risks": [
      "STREAM_STABLE_MS (~3 s, unmeasured) is a heuristic. A late BFF→backend failure clears and then re-shows the indicator. A long window leaves quiet healthy streams marked 'disconnected' after reconnect. The optional show-side debounce mitigates this.",
      "Edge (Cloudflare) idle timeouts on quiet streams will cause periodic reconnects and full snapshot replays. This is acceptable with dedupe and debounce, but unmeasured.",
      "TanStack v5 behaviour (MutationCache sees hook-level options only) is unverified locally because node_modules is absent. It is pinned by the Vitest predicate test.",
      "Double reporting from any flagged-or-not inventory miss is cosmetic but spread across the UI. It needs a pinned grep check.",
      "Unproven e2e infrastructure: the in-process mock may not hold streamOrderUpdates/streamAlerts open until abort, and page.route may not be able to inject error-then-recover per page.",
      "A lingering fallback banner after a successful retry, until dismiss or navigation. This is the accepted visible trade-off.",
      "Not verified line by line: that OrderForm shows paper/live only through TradingModeBadge or the mode prop (AC-12)."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-03",
      "C-11",
      "C-12",
      "C-13",
      "C-15",
      "C-16",
      "C-17",
      "C-18",
      "F-04",
      "F-07",
      "P-02",
      "P-03",
      "PLAT-N1"
    ],
    "rationale": "This follows the user directive to preserve as much as possible with low rework. r2 concretely answered all three earlier blocking items:\n- per-call handlers plus a call-site-audited flag;\n- a single-slot show-once store with no gcTime staleness;\n- a transport-independent indicator clear on first item or a stable window, with onHeader correctly rejected after the BFF analysis.\n\nThose items close. The adversary's two new blocking objections are both confirmed in the worktree:\n- useInvalidatingMutation.ts:17,22 has no meta, and both flagged hooks are built on it.\n- useBacktest.ts and useScreenSymbols.ts have no-op onErrors that the onError-inference predicate would treat as handled.\n\nEach fix is a one-line change inside the existing approach, and the synthesis folds both in. They stay blocking only because the proposer has not yet stated them.\n\nNon-blocking refinements are adopted where they reduce code or close a silent-failure path. Reconnect on a clean end with a one-line mock change, retryable-code gating, the getServerSnapshot null, and dismiss/navigation clearing in place of keyHash all close silent-failure risks. Dropping keyHash also cuts logic. The mutateAsync concern is closed by grep (zero sites).\n\nNo Floor breach: F-07 is checked, and the constants are UI-local with precedent. All 270 ACs are EXTEND, and the feature-095/202/203 rules are PRESERVE with no sanctioned CHANGE. Reconnects reuse the existing clients, so x-trace-id propagation follows the operator's standing decision with no C-03 waiver."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: wrote recon.md in an earlier session (services: xstockstrat-ui fix site; analysis and trading
  read-only). Key reuse patterns: the `Alert`/`CardNotice` primitives with the per-call `onError` + `errMessage`
  pattern, `timestampToMillis`, and the server-derived `resolveTradingMode` from UNSPECIFIED.
- Phase 1 Grilling: 2 rounds (full).
  - Operator approved at the design gate as synthesized: the `meta` passthrough in `useInvalidatingMutation`
    (`:17`, `:22`), `meta.errorHandled` as the ONLY opt-out from the global mutation error fallback, and removal
    of the no-op `onError`s in `useBacktest.ts:12-15` / `useScreenSymbols.ts:13-16` (or listing them in the
    inventory).
  - Chosen approach: a UI-only fix in this build order:
    1. D-45 `strategyId` one-liner.
    2. D-64 per-call handlers, the `errMessage` hoist, the export try/catch, and the `MutationCache` fallback
       (single-slot store, meta-only skip).
    3. D-17 `toPbTradingMode` with a null mode sending UNSPECIFIED.
    4. D-11 `pickFresherOrder`.
    5. D-11 `useReconnectingStream` (reconnect on any non-abort end or retryable code, terminal on
       PermissionDenied/InvalidArgument, indicator clears on first item or `STREAM_STABLE_MS`).
  - Rejected: inferring "handled" from `onError`, keyHash clear-on-success, `onHeader` indicator clearing,
    error-only reconnect, opt-in `meta.globalError`, `useMutationState`, and NC-D cleanup (deferred by operator
    decision).
- Constitution rules touched: C-01, C-03, C-11, C-12, C-13, C-15, C-16, C-17, C-18, F-04, F-07, P-02, P-03,
  PLAT-N1. Floor breaches: none.
- Business rules: all twelve 270 ACs are EXTEND. @AC-10 @feature-095, @AC-5 @feature-202 and @AC-6 @feature-203
  are PRESERVE. No CHANGE, so no additional sign-off is needed.
- Trace: reconnects and all touched calls reuse the existing clients, so x-trace-id propagates under the standing
  2026-10-21 operator decision (no C-03 waiver).
- Status: spec-ready → design-approved.

### Decisions

- The approach recorded in design.md § Chosen Approach is binding for `/sdd-spec`.
- The global mutation fallback's skip rule is `mutation.options.meta?.errorHandled === true` only.
- A hook may be flagged only when every call site handles errors.
- A per-call handler always lands before its hook is flagged.

### Open Threads

- [ ] `STREAM_STABLE_MS` (~3 s, unmeasured) and the optional show-side debounce. Target step: D-11 reconnect.
- [ ] Edge (Cloudflare) idle-timeout reconnects and snapshot replays on quiet streams. Target step: D-11
  reconnect (PR verification note).
- [ ] TanStack v5 "MutationCache sees hook-level options only" is unverified locally. Target step: D-64 global
  fallback (Vitest predicate test pins it).
- [ ] Any miss in the opt-out inventory double-reports. Target step: D-64 global fallback (pinned grep check).
- [ ] The e2e mock's ability to hold `streamOrderUpdates`/`streamAlerts` open until abort, and per-page
  error-then-recover via `page.route`, is unproven. Target step: D-11 reconnect (lands last).
- [ ] The fallback banner lingers after a successful retry until dismiss or navigation (accepted). Target step:
  D-64 global fallback (documented in the PR).
- [ ] It is not verified that OrderForm shows paper/live only via `TradingModeBadge` or the mode prop (AC-12).
  Target step: D-17.
- Next: `/sdd-spec fix-ui-trader-feedback`.

## Session 2026-10-22 — sdd-spec

- Wrote implementation-spec.md with 14 steps: 7 `service` steps, each followed by a paired red-green `test`
  step. Status: design-approved → implementation-ready.
- Build order:
  - D-45: Steps 1–2.
  - D-64 per-call handlers: Steps 3–4.
  - Ledger export: Steps 5–6.
  - Global mutation fallback: Steps 7–8.
  - D-17: Steps 9–10.
  - D-11 freshness: Steps 11–12.
  - D-11 reconnect: Steps 13–14.
- Every step is in `xstockstrat-ui`. Analysis and trading are read-only.
- C-15 coverage:

  | Scenario | Step(s) |
  |---|---|
  | AC-1 | 12, 14 |
  | AC-2 | 14 |
  | AC-3 | 10 |
  | AC-4 | 2 |
  | AC-5 | 4 |
  | AC-6 | 4 |
  | AC-7 | 6 |
  | AC-8 | 12 |
  | AC-9 | 14 |
  | AC-10 | 8 |
  | AC-11 | 6 |
  | AC-12 | 10 |

- Codebase findings that correct the evidence in design.md (its binding Chosen Approach is unchanged):
  - **AlertStream has no dedupe today.**
    - `AlertStream.tsx:76` is `[alert, ...prev].slice(0, 50)`, and `alertId` is only the React key (`:130`).
    - Step 13 adds the `alertId` dedupe that design.md assumed already existed. Without it, a reconnect or the
      mock's replay would duplicate React keys.
  - **signal-sources `saveError` renders only inside the edit card** (`:548`, `:759`).
    - Reusing `setSaveError` would leave the AC-6 error invisible while the form is closed.
    - Step 3 adds a dedicated `toggleError`, shown in a page-level `CardNotice`, with the same per-call
      `onError` + `errMessage` pattern.
  - **A third no-op `onError`** is in `useSetConfig.ts:15-18`. Step 7 deletes it together with the two in
    `useBacktest.ts` and `useScreenSymbols.ts`.
  - **A fifth trading-mode mapping** is in `usePositionLineage.ts:10,21,27`, as a string form that filters
    ledger payloads. With a null mode it skips the mode clause.
  - **Proto3 JSON omits a zero-valued enum**, so an UNSPECIFIED `tradingMode` is absent on the wire. The AC-3
    e2e accepts either absent or `TRADING_MODE_UNSPECIFIED`, never `TRADING_MODE_PAPER`.
  - **The mock backend has no `streamOrderUpdates` handler.**
    - Under the new reconnect policy, every orders spec would hit a terminal `Unimplemented`.
    - Step 14 adds a held-open handler and makes `streamAlerts` hold open too.
  - **`OrderForm.tsx` was read in full**, closing the design Open Risk. `mode` is used only at `:139`, in the
    request, and the form renders no Paper label.
  - **The dashboard `OrderBook` never consumes the order stream.** `OrdersTable`, rendered only on
    `/trader/orders`, is the sole consumer.
- `tradingMode` request fields were verified against the proto (`fails.md:358`):
  - Trading: `PlaceOrderRequest` field 12, `ListOrdersRequest` field 6.
  - Portfolio: `GetPortfolioRequest` field 2, `GetPositionRequest` field 3, `ListPositionsRequest` field 3.
  - Both servers skip the mode filter on UNSPECIFIED (`trading_repo.go:239`, `portfolio_repo.go:146`).

### Decisions

- **Opt-out inventory (P-03).** It is pinned by `grep -rn "errorHandled: true" src`, which must return 9 hits.
  - Flagged hooks:
    - `useSetOpportunityAction`, `useManageSignalSource`.
    - `useRunBacktest`, `useScreenSymbols`.
    - `useSetConfig`, `useSetStrategyLive`.
    - `usePlaceOrder`, `useReplaceOrder`, `useConfirmOrder`.
  - Each flagged hook was audited, and every one of its call sites handles errors.
  - Every other mutation stays unflagged. Where an unflagged hook's caller also renders the error inline, the
    error shows twice. That cosmetic double report is accepted.
  - `useCancelOrder` stays unflagged because `OrdersTable.tsx:235` cancels with no handler. The AC-10 e2e uses
    that path.
- **Reconnect policy.**
  - Retryable: non-Connect errors, plus the codes Unavailable, Unknown, Internal, DeadlineExceeded,
    ResourceExhausted, Aborted, Canceled and Unauthenticated.
  - Every other code is terminal.
  - Unauthenticated is retryable because `guardStream` (`transport.ts:16`) refreshes the session and expects
    the stream to "recover on the next reconnect". A failed refresh redirects to login.
- **Backoff and indicator.**
  - Backoff starts at 1 s, doubles each attempt and caps at 30 s, with no jitter. `STREAM_STABLE_MS` is 3000 ms.
  - The indicator shows as soon as a stream drops, with no show-side debounce, because AC-2 and AC-9 need it
    visible.
  - It clears on the first item, or once the stream has stayed open for `STREAM_STABLE_MS`.
- **Fallback banner placement.**
  - Mobile: `bottom-24`, which clears the `BottomTabBar`.
  - Desktop: `sm:bottom-4`.
  - `z-50`, so it stays clear of the `sticky top-0 z-40` header.
  - Mounted once per provider.

### Open Threads

- [ ] Edge (Cloudflare) idle-timeout reconnect churn. The Step 13 PR records a 5-minute idle observation on dev.
- [ ] Whether `page.route` can hold a fulfilled stream open. Step 14 records a fallback variant: send a complete
  body, then reconnect on the clean end.
- [ ] The fallback banner stays after a successful retry until the user dismisses it or navigates. This is
  accepted and documented in the Step 7 PR.
- Next: `/sdd-review fix-ui-trader-feedback impl-spec`.

## Session 2026-10-22 — sdd-review impl-spec (advisory)

- Result: 0 failures, 7 warnings. Overlap: file-level WARN only, with no migration, proto or config collision.
  Advisory, so the lifecycle stays `implementation-ready`.
- Addressed in `implementation-spec.md`:
  - [x] Steps 7 and 8: the `errorHandled: true` count pin is now scoped to `src/hooks src/app/config-ui/hooks`,
    so Step 8's `*.test.ts` literals do not push it above 9 (P-03 / F-05 risk). Step 7 instruction 6 now spells
    out the factory form `{ meta: { errorHandled: true } }`, passed as the third `options` argument.
  - [x] Coverage thresholds (B2). Steps 4, 8, 10, 12 and 14 now state the Vitest 40% lines/functions/statements
    floor over `src/lib/**`. Steps 2 and 6 now say no threshold applies, because they are Playwright-only and
    touch nothing in `src/lib/**`.
  - [x] Steps 4, 6 and 8: alert locators are now scoped by text (`getByRole('alert').filter({ hasText })`), so the
    global fallback or an inline alert cannot trigger Playwright strict-mode violations.
  - [x] Rebase-only overlaps. Added `e2e/trader/position-detail.spec.ts` (215, 245), `e2e/insights/opportunities.spec.ts`
    (215), `e2e/mock-backend.ts` (215) and `e2e/fixtures/INVENTORY.md` (215, 245, 249). Dropped the unverified claim
    that 245 edits `positions/[symbol]/page.tsx`: 245's files list does not modify it and only cites it as evidence.
    246 on `opportunities/page.tsx` is reworded as prose-only.
- Still open, carried into execution (announce at each `/sdd-execute` checkpoint):
  - [ ] Step 7 touches 15 files and Step 14 touches 6, both above the 5-file guideline. The split is kept: store,
    then wiring, then the 9 audited hooks. At execution, re-audit every flagged hook's call sites before adding
    its flag.
  - [ ] Step 14: it is still unproven that `page.route` can hold a fulfilled stream open. Record in the Deviation
    Log which variant ran (held open, or the complete-body fallback). This duplicates the open thread above.
  - [ ] Step 7: the banner stays after a successful retry, and some failures are reported twice (banner plus
    inline). Both are accepted trade-offs (C-18) and must be noted in the Step 7 PR body.
  - [ ] Step 13: Cloudflare idle-timeout reconnect behavior has not been measured. The PR must include the
    5-minute dev observation. This duplicates the open thread above.
  - [ ] Merge-order: no blocking row is needed. Optional coordination: 270 rebases after 215 (in-progress) on the
    shared UI page, e2e mock and INVENTORY files. The `merge-order.md` row was not written, because this run may
    only edit files under the feature directory.

---

## Session 2026-10-28 — re-spec (sdd-execute sequential, sdd-batch-execute)

- Branch setup (§5.3): merged `origin/main-dev` into `feature/fix-ui-trader-feedback` with `-X ours` (brings in
  launched 245/246 among others). All `**Files**` paths re-verified against the merged tree.
- Re-spec, line drift only; no step semantics, files or verification changed:
  - Step 2: AMZN?strategy=strat-live-001 test now at `position-detail.spec.ts:688` (goto) / `:693` (run-backtest
    visible); analysis `TestRunBacktestCells` `:1991`, `test_registered_own_run_stamps_fingerprint` `:2044`,
    `test_id_mismatch_stamps_none` `:2075`. (feature.md Reviewers row still cites the old `:1968,1999`; stale but
    not a step body.)
  - Step 7: `useScreenSymbols` in `SymbolScreening.tsx` at `:43`.
  - Step 9: `PlaceOrderRequest.trading_mode = 12` at `trading.proto:128`.
  - Step 13: `AlertStream.tsx` (115 lines) — `listAlerts` effect `:18-31`, `streamAlerts` effect `:33-48`, merge
    `:42`, silent catch `:44`, bell `Button` `:57`, `key={a.alertId}` `:96`.
  - Step 14: noted the second `router.service(TradingService, …)` at `mock-backend.ts:1353` (insights mock; no
    `streamOrderUpdates`), left untouched.

---

## Session 2026-10-28 — sdd-execute sequential (sdd-batch-execute)

- Status `implementation-ready` → `in-progress`. Mode: `sequential` (one commit per step on
  `feature/fix-ui-trader-feedback`, single integration PR at the end). Severity SEV-2.
- **Up-front confirmation (mode entry):** operator approved the plan by standing authorization — operator chat
  2026-10-28 (session_01NpS3HShZK6pSnogA7CFo2f): "Start executing features 241-276" via batch-execute; answers:
  unattended checkpoints (checkpoints `report`), C-16 promotion auto-confirmed unless it changes an existing
  `@AC` rule, merge-train authorized, defer 255/275; operator-only DB/prod steps: open PR, hold merge; "start
  batch 2 in parallel too".
- Carried-forward open threads from the impl-spec review (Step 7/14 file-count, Step 14 held-open stream variant,
  Step 7 banner/double-report trade-offs, Step 13 5-minute idle observation) remain to be announced at their
  steps.

## Session 2026-10-28 — sdd-execute sequential, Step 1 (sdd-batch-execute)

- Step 1 done: `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:1151` adds `strategyId: strategyId,`
  directly above `strategyIdRef`, mirroring `insights/strategies/[id]/page.tsx:101-103`. No other change; analysis
  untouched.
- TDD (AC-4, via a throwaway probe of Step 2's assertions, deleted before commit): red — `expect.poll(() =>
  body?.strategyId).toBe('strat-live-001')` failed, received `undefined` (strategyIdRef already present) →
  green — probe passed, and all 41 existing `position-detail.spec.ts` tests passed (prebuilt app, `CI=1
  E2E_PREBUILT=1`).
- Verification: grep finds one hit at `:1151`; `pnpm run lint` has no errors (only pre-existing warnings);
  `tsc --noEmit` fails only on the pre-existing, untouched `e2e/insights/backfills.spec.ts:135-136` (see the
  Deviation Log). This is a defect candidate for `/sdd-qa defect`.
- Tooling: `pnpm install --frozen-lockfile` in the worktree (the main worktree has no `node_modules` to symlink) and
  Playwright Chromium headless shell 1.62.1.

## Session 2026-10-28 — sdd-execute sequential, Step 2 (sdd-batch-execute)

- Step 2 done: `e2e/trader/position-detail.spec.ts` adds `@AC-4 symbol-page RunBacktest sends strategyId and
  strategyIdRef`. It intercepts `**/xstockstrat.analysis.v1.AnalysisService/RunBacktest`, captures the body,
  `route.continue()`s to the mock, and polls `toMatchObject({ strategyId, strategyIdRef })`. The id comes from
  `STRATEGY_DEF_LIVE` (C-12); no inline literal.
- TDD (AC-4): red — with `page.tsx` temporarily reverted to the pre-Step-1 tree, `toMatchObject` failed with
  `- "strategyId": "strat-live-001"` missing and `"strategyIdRef": "strat-live-001"` present → green — passed
  after restoring Step 1. All 43 `position-detail.spec.ts` tests pass (prebuilt app, `CI=1 E2E_PREBUILT=1`).
- Verification: `pnpm run lint` exit 0 (pre-existing warnings only). The grep shows the `helpers/auth` and
  `'../fixtures'` imports. Analysis `pytest -k "stamps_fingerprint or id_mismatch_stamps_none"`: 2 passed, which
  covers the "reaches history" half of AC-4.
- Tooling: `pnpm install --frozen-lockfile` in the worktree; `uv sync --extra dev --frozen` in
  `services/xstockstrat-analysis`.


## Session 2026-10-29 — re-spec (sdd-execute sequential, sdd-batch-execute)

- Branch setup (§5.3): merged `origin/main-dev` into `feature/fix-ui-trader-feedback` with `-X ours` (brings in
  241 among others; the only UI files it touched are `configUiBff`/`insightsBff` and the UI constitution).
- Status was already `in-progress` (flipped 2026-10-28), so there was no status change. The run continues under the
  operator's standing authorization: operator chat 2026-10-28/29 (session_01NpS3HShZK6pSnogA7CFo2f), "Start
  executing features 241-276" via batch-execute; unattended checkpoints (`report`), C-16 promotion auto-confirmed
  unless it changes an existing `@AC` rule, merge-train authorized, defer 255/275; operator-only DB/prod steps:
  open PR, hold merge; blocker decisions 2026-10-29 recorded per feature.
- Re-spec, line drift only; no step semantics, files or verification changed:
  - Step 7: mount point is `QueryProviders.tsx:15-17` (the file is 20 lines; was cited `:32-34`). The
    `SymbolScreening` inline `symbol-screen-error` is at `:230-234` (was `:228`). Every other Step 7 evidence item
    re-verified unchanged.
  - Step 13: the disconnect `Alert` goes under the `QueryStateMessages` at `OrdersTable.tsx:203` (was `:202`).
    Trading `StreamOrderUpdates` is `trading.go:1667-1686` (its closing brace was mis-cited as `:1685`). The
    rest re-verified unchanged.

## Session 2026-10-29 — sdd-execute sequential, Step 3 (sdd-batch-execute)

- Step 3 done (D-64):
  - **Hoist.** Created `services/xstockstrat-ui/src/lib/errMessage.ts`. The local copies in
    `signal-sources/page.tsx` and `NamespaceEditor.tsx` were deleted, along with their now-unused `ConnectError`
    imports. `grep "function errMessage"` now returns one hit, the new file.
  - **Signal-sources.** Added a dedicated `toggleError` state, because `saveError` is invisible outside the edit
    card. `handleToggle` now passes per-call `onSuccess`/`onError`. A
    `<CardNotice variant="error">{toggleError}</CardNotice>` renders right after the page `QueryStateMessages`.
  - **Opportunities.** Added an `actionError` state. `act` now passes per-call `onSuccess`/`onError`. One shared
    `CardNotice variant="error"` sits between the filter row and the `sm:hidden` mobile block, so the mobile and
    desktop layouts share it.
  - No `meta.errorHandled` was added; that is Step 7's job.
- TDD (AC-5/AC-6, via throwaway probes of Step 4's assertions, reverted before commit; prebuilt app,
  `CI=1 E2E_PREBUILT=1`):
  - **Red:** `getByRole('alert').filter({ hasText: 'opportunity action unavailable' })` and
    `… 'deactivate unavailable'` both failed with "element(s) not found" after a 503 `unavailable`
    SetOpportunityAction / ManageSignalSource.
  - **Green:** both probes passed, and all 50 existing `opportunities.spec.ts` + `signal-sources.spec.ts` tests
    passed (52/52).
- Verification:
  - The `function errMessage` grep returns exactly one hit (`src/lib/errMessage.ts:3`).
  - The `setToggleError`/`setActionError` grep has hits in both pages.
  - `pnpm run lint` exits 0. `pnpm run lint:dup` finds 0 clones. `pnpm build` passes.
  - `tsc --noEmit` fails only on the pre-existing, untouched `e2e/insights/backfills.spec.ts:135-136` (see the
    Deviation Log).
- Tooling: `pnpm install --frozen-lockfile` in the worktree. The main worktree has no `node_modules`, so a symlink
  would dangle. Playwright Chromium comes from the preinstalled `/opt/pw-browsers`.

## Session 2026-10-29 — sdd-execute sequential, Step 4 (sdd-batch-execute)

- Step 4 done (AC-5, AC-6):
  - `src/lib/errMessage.test.ts` checks that `errMessage` returns a ConnectError's `rawMessage` (`'boom'`, with no
    `[unavailable]` prefix) and a plain Error's `message`.
  - `opportunities.spec.ts` adds `@AC-5 a failed Snooze shows an error`. It re-routes `SetOpportunityAction` to a
    503 `unavailable` after `beforeEach`'s mock, so the later route wins. It then clicks
    `snooze-${OPPORTUNITIES[0].symbol}`.
  - `signal-sources.spec.ts` adds `@AC-6 a failed deactivate shows an error`. It routes `**${MANAGE_SOURCE_BFF}` to
    a 503 and clicks the `Disable` row action for `SIGNAL_SOURCE_WEIGHTED`. It then asserts that the alert is
    visible and the edit form (`Display name`) is absent.
- TDD (AC-5/AC-6). The tree was reverted to pre-Step-3 for RED, then restored, then rebuilt for GREEN:
  - **Red:** `errMessage.test.ts` failed to import `./errMessage`. `getByRole('alert').filter({ hasText:
    'opportunity action unavailable' })` and `… 'deactivate unavailable'` each failed with "element(s) not found".
  - **Green:** both new e2e tests pass, and all of `opportunities.spec.ts` + `signal-sources.spec.ts` pass
    (52/52). Vitest passes 240/240, and `src/lib/errMessage.ts` has 1/1 lines covered.
- Verification:
  - `pnpm run lint` exits 0.
  - `pnpm run test:coverage` exits 0, at 73.41% lines over the files exercised.
  - The `helpers/auth` / `'../fixtures'` grep hits both specs. `opportunities.spec.ts` imports `'../fixtures/opportunities'`,
    which is the pre-existing import.
- Tooling: `pnpm install --frozen-lockfile` in the worktree. Chromium came from `/opt/pw-browsers`.

## Session 2026-10-29 — sdd-execute sequential, Step 5 (sdd-batch-execute)

- Step 5 done (D-64, ledger export) in `services/xstockstrat-ui/src/app/trader/portfolio/page.tsx`:
  - Added `useState` and an `exportError` state.
  - `onExportEvents` now resets the error, then runs inside `try/catch`. A non-OK response sets
    `Export failed (HTTP <status>)`; a rejected `fetch` sets `Export failed: <message>`, so there is no unhandled
    rejection.
  - The blob → anchor download success path is unchanged (PRESERVE `@feature-021` AC-1/2/7/9).
  - `{exportError && <CardNotice variant="error">…}` renders right after the `Portfolio unavailable` notice.
- TDD (AC-7/AC-11, via a throwaway probe of Step 6's assertions, deleted before commit; prebuilt app,
  `CI=1 E2E_PREBUILT=1`):
  - **Red:** `getByRole('alert').filter({ hasText: 'Export failed (HTTP 500)' })` and `… 'Export failed'` (abort)
    both failed with "element(s) not found".
  - **Green:** both probes passed, and all 8 existing `ledger-export.spec.ts` tests passed (10/10).
- Verification: the `setExportError` grep has 4 hits. `pnpm run lint` exits 0 and `lint:dup` finds 0 clones.
  `tsc --noEmit` fails only on the pre-existing `e2e/insights/backfills.spec.ts:135-136`.
- Tooling: `pnpm install --frozen-lockfile` in the worktree. Chromium came from `/opt/pw-browsers`.

