# Design: fix-ui-transport-hardening

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-10-22 (operator approval at the design gate, round 2, choosing Option 2 on agent-health; Floor clear)
**Grounded in**: recon.md

---

## Chosen Approach

Scope: D-37 and D-38 only (operator decision 2026-10-21). Both fixes live in `xstockstrat-ui`. No proto, migration, config-key or env-var change.

**Consumer surfaces (C-14).**
- **Probes and uptime monitors.** The eight segment health routes return their handler response instead of a login redirect (D-38).
- **Signed-in users in every segment.** When identity is unreachable, an expired-token navigation is redirected to `/auth/login` in about 10s instead of hanging (D-37).
- **BFF callers.** A hung backend now returns 504 after the default deadline (`Code.DeadlineExceeded` → 504, recon.md:27) instead of hanging forever.
- When backends are healthy, nothing changes visibly.

### D-37 — transport deadline

1. **One home for every UI deadline constant (C-18).** Add a new leaf module, `services/xstockstrat-ui/src/lib/deadlines.ts`. It has no imports, so `connectClients.ts` can import it without a cycle through `bffShared.ts`. It exports:
   - `DEFAULT_UNARY_TIMEOUT_MS = 30_000`. This follows the 30s precedent of `@AC-1 @feature-191`.
   - `REFRESH_TIMEOUT_MS = 10_000`.
   - `LONG_RPC_TIMEOUT_MS = 300_000`.
   - `FUNDAMENTALS_TIMEOUT_MS = 15_000`, moved from `bffShared.ts:55` (recon.md:38). Its importers (`traderBff.ts`, `insightsBff.ts`) and the declaration site are updated to match.

   The literal `timeoutMs: 30_000` at `insightsBff.ts:58` (recon.md:35, `@AC-1 @feature-191`) is left as written.
2. **Unary default.** In `makeTransport` (`connectClients.ts:48-74`, recon.md:23-25), the `unary` wrapper (`:67-68`) forwards `timeoutMs ?? DEFAULT_UNARY_TIMEOUT_MS`.
   - The `stream` wrapper (`:70-71`) stays byte-for-byte unchanged, so `streamAlerts`, `streamOrderUpdates` and `exportEvents` stay unbounded (recon.md:40-43).
   - The lazy `get()` build (`:45-53`, recon.md:26) stays as it is.
   - `createGrpcTransport({ defaultTimeoutMs })` is **not** used (see Rejected Alternatives).
   - `forward()` already sets `timeoutMs` only when the caller supplies it (`bffShared.ts:65-74`, recon.md:39), so the transport is the single place the default applies. Per-call values keep winning (AC-6).
3. **Refresh bound — the direct D-37 hang site.** In `identity.ts:14` (recon.md:28), the call becomes `identityClient.refreshToken({ refreshToken }, { timeoutMs: REFRESH_TIMEOUT_MS })`.
   - On a deadline, the existing `catch` returns `null` (`identity.ts:20-21`), and every caller fails closed:
     - `middleware.ts:40`: the expired-token branch at `:59-63` clears cookies and redirects with `?redirect=` (recon.md:30).
     - `middleware.ts:76`: the near-expiry branch at `:77-81` does the same (recon.md:31).
     - `src/app/api/auth/refresh/route.ts:10`, the browser interceptor: on `null` it returns 401 and clears cookies.
   - 10s matches the AC-2 wording as written.
   - `revokeToken` (`identity.ts:27`) keeps the 30s default.
4. **`forwardAdmin` widened additively** (`bffShared.ts:80-84`).
   - Signature: `forwardAdmin(call: (req, opts: { headers: Headers; timeoutMs?: number }) => …, options: { timeoutMs?: number } = {})`.
   - Body: `forward(call, { ...options, admin: true })`. `admin` is spread last, so a caller cannot override it.
   - This reuses the existing threading in `forward()`.
5. **Long class (`LONG_RPC_TIMEOUT_MS`)**:
   - `scoreStrategy`, `runBacktest` and `screenSymbols` (`insightsBff.ts:40-42`)
   - `triggerBackfill` (`insightsBff.ts:80`)
   - `deleteBackfilledData` (`insightsBff.ts:117-119`, via the new `forwardAdmin` option)
   - `runFundamentalsScan` (`configUiBff.ts:69`, via the new `forwardAdmin` option)
6. **Classification table** of every server-side unary call through `connectClients.ts`. Line numbers are from this pass; recon.md:111-115 required the enumeration. Classes:
   - **D** = default 30s.
   - **L** = `LONG_RPC_TIMEOUT_MS`.
   - **R** = `REFRESH_TIMEOUT_MS`.
   - **P** = an existing per-call value that keeps overriding the default.
   - **S** = stream; no deadline.

   | File | Calls | Class | Justification |
   |---|---|---|---|
   | `lib/identity.ts:14` | `refreshToken` (refreshSession; callers `middleware.ts:40`, `:76`) | R | D-37 hang site; fail-closed on `null` |
   | `app/api/auth/refresh/route.ts:10` | refreshSession (browser interceptor) | R (via identity.ts) | 401 + cleared cookies on `null` |
   | `lib/identity.ts:27` | `revokeToken` | D | logout; failure already swallowed |
   | `app/api/auth/login/route.ts:12` | `authenticateUser` | D | single credential check |
   | `app/accounts/api/profile/route.ts:37,55`, `authorized-apps/route.ts:18,47` | get/updateUserMetadata, list/revokeAuthorizedApp | D | single-row identity reads/writes |
   | `insightsBff.ts:40-42`, `:80`, `:117-119` | scoreStrategy, runBacktest, screenSymbols, triggerBackfill, deleteBackfilledData | L | inline compute / bulk work; destructive delete must not be abandoned early |
   | `configUiBff.ts:69` | runFundamentalsScan | L | admin batch scan |
   | `insightsBff.ts:58` | listOpportunities | P (30s literal) | `@AC-1 @feature-191` |
   | `insightsBff.ts:102-103`, `:113-114`; `traderBff.ts:77-78` | getFundamentals, getFundamentalsMulti | P (`FUNDAMENTALS_TIMEOUT_MS`) | `@AC-1 @feature-220` |
   | `insightsBff.ts:62`, `:65`, `:66`, `:68`, `:70`, `:72` | evaluateReadiness, getWatchlistReadiness, getStrategyAnalytics, getIndicatorSeries, queryPnLPatterns, getAttribution | D (**provisional**, p99 gate) | interactive analysis reads |
   | `insightsBff.ts:100`, `:105`; `traderBff.ts:74` | getBars, getHistoricalFundamentals | D (**provisional**, p99 gate) | bounded-range marketdata reads |
   | `insightsBff.ts:153`; `traderBff.ts:123` | queryEvents | D (**provisional**, p99 gate) | paged ledger read |
   | `insightsBff.ts:196-197` | executeFormula, computeIndicator | D (**provisional**, p99 gate) | sandboxed single-formula eval |
   | `traderBff.ts:33` | placeOrder | D (**provisional**, p99 gate) | retry-safe via `client_order_id` (`trading.proto:122-125`) |
   | `traderBff.ts:43` | replaceOrder | D (**provisional**, p99 gate) | `ReplaceOrderRequest` (`trading.proto:194-205`) has **no** idempotency key; replace is single-shot, and a retry against an already-replaced `order_id` is rejected by the broker, not duplicated |
   | `traderBff.ts:42`, `:45` | cancelOrder, confirmOrder | D (**provisional**, p99 gate) | cancel is broker-idempotent; confirm writes fill values, so repeating it is safe |
   | all remaining `forward`/`forwardAdmin`/hand-written unary entries in `insightsBff.ts`, `traderBff.ts`, `configUiBff.ts` (list/get/manage/CRUD for strategies, templates, signal sources, watchlists, portfolios, formulas, broker accounts, config, users, alerts, push subscriptions, backfill status/jobs/cancel, `appendEvent`, `setConfig`, `createUser`, `updatePassword`, `resumeAccount`) | — | D | single-entity CRUD or small listings |
   | `traderBff.ts:46`, `:85`; `trader/api/ledger/export/route.ts:115` | streamOrderUpdates, streamAlerts, exportEvents | S | unchanged stream wrapper (`@AC-6 @feature-210`, `@AC-7 @feature-021`) |

7. **Mandatory spec-time latency gate** (fails.md:2946-2950). Before `/sdd-spec` finalizes the table, pull the p99 latency from Grafana, for both staging and production, for every row marked **provisional**.
   - An RPC with a p99 above 15s moves to L or gets an explicit per-call bound.
   - If telemetry is unavailable, record that in context.md and record the operator's risk acceptance before `implementation-ready`.
8. **F-07 record: these deadlines are code constants, not config keys.**
   - This covers all four constants: `DEFAULT_UNARY_TIMEOUT_MS`, `REFRESH_TIMEOUT_MS`, `LONG_RPC_TIMEOUT_MS` and `FUNDAMENTALS_TIMEOUT_MS`.
   - The UI has no `WatchConfig`. The `ui` namespace is read once with a one-shot `GetConfig` (recon.md:54). A key would therefore need new wiring and config-team approval.
   - The values are transport mechanics that the operator does not tune.
   - The existing precedent is `FUNDAMENTALS_TIMEOUT_MS` (recon.md:60, 119).

### D-38 — health exemption

9. **Exact-match Set.** Add a module-level `PUBLIC_HEALTH_PATHS` Set in `src/middleware.ts`. The first statement of `middleware()`, before `getSessionFromRequest` (`:27`), is `if (PUBLIC_HEALTH_PATHS.has(req.nextUrl.pathname)) return NextResponse.next();`.
   - This mirrors the existing exact-path check at `:32` (recon.md:33).
   - `config.runtime` stays `'nodejs'` (recon.md:21).
   - The Set holds all **eight** paths from FR-2 (recon.md:44-52), including `/accounts/api/agent-health`. This follows operator decision 2026-10-22, Option 2.
   - Exact matching by construction satisfies FR-3. `/trader/healthcheck-x` and `/insights/api/health-extra` are not members, so they stay gated.
10. **`/accounts/api/agent-health` (Option 2, KEEP).** The path is exempt from the middleware, like the other health routes. Its handler keeps its own session check (`agent-health/route.ts:7-8`, recon.md:52, 106-110), so an anonymous probe gets the handler's own 401 JSON, not a login redirect. AC-3 must expect that 401 for this row; the other seven rows reach their handlers' normal response. The trade-off is accepted and listed under Open Risks.
11. **Matcher hygiene (FR-3).** The matcher lookahead at `middleware.ts:22` keeps the prefix alternatives `api/health|health` (recon.md:22, 120). They skip auth for any root path that begins with `/health` or `/api/health`, and no route lives under either prefix.
    - Recommendation: delete those two alternatives and leave every other alternative verbatim, including the load-bearing `api/auth/refresh` (recon.md:63, `@AC-5 @feature-128`).
    - Before deleting, `/sdd-spec` must re-read the `@feature-128` and `@AC-1 @feature-165` suites and confirm neither depends on them.
    - If that cannot be confirmed, keep them and state in the spec that they are deliberately retained dead prefixes.
    - The AC-4 lookalike examples gain `/healthcheck-x` and `/health/anything`, so the deletion is proven.

### Header propagation (operator 2026-10-21, x-trace-id)

No change. `backendHeaders` (`bffShared.ts:38-44`) still carries the inbound `x-trace-id` on every forwarded unary and stream call. No call site mints fresh headers or a fresh context.

The `identity.ts` calls carry no inbound headers today. That predates this feature and is outside D-37/D-38 scope; this feature adds no new emit.

### Tests

1. **`src/lib/connectClients.test.ts`** (new; vitest, node env).
   - Mock `createGrpcTransport` at module level so the lazy `get()` runs, and stub `MTLS_*`.
   - Assert: a unary call with no `timeoutMs` forwards 30_000; a per-call value wins; the stream wrapper forwards its `timeoutMs` unchanged, including `undefined`.
   - No test-only branches go in production code (recon.md:124).
2. **`bffShared` unit test.** `forwardAdmin(call, { timeoutMs })` threads the value through and still enforces admin scope.
3. **Real-socket proof for AC-1 and AC-6.** A black-hole h2 listener in the style of `e2e/mtls-transport.spec.ts` (recon.md:66). Its port and env var are wired in both `mock-backend.ts` and `playwright.config.ts` (recon.md:101-102, the fails.md 2026-08-05 trap).
4. **AC-2 e2e.**
   - The identity mock's `refreshToken` hangs when it receives a sentinel token registered in `e2e/fixtures/INVENTORY.md` (C-12, C-13).
   - Assert: a redirect to `/auth/login?redirect=%2Ftrader`, cleared cookies, and completion within about 10s plus slack.
   - Add a variant that POSTs to `/api/auth/refresh` and expects 401 with cleared cookies.
5. **AC-3 and AC-4.**
   - With no cookie, the exact health paths reach their handlers; `agent-health` returns its own 401 JSON.
   - The lookalike paths, including `/healthcheck-x` and `/health/anything`, redirect to `/auth/login`.
6. **AC-5.** A held-open `streamAlerts` mock variant.
   - Before choosing how to deliver the sentinel, verify which path reaches the mock on the server stream: `x-trace-id` through `backendHeaders`, or a request field.
   - The default mock stream (`mock-backend.ts:529-534`, recon.md:122) must still end cleanly.

### `acceptance.feature` edits for `/sdd-spec` to carry

- AC-1 states 30s.
- AC-2 keeps 10s.
- AC-3's `agent-health` row expects the handler's 401.
- AC-4 adds `/healthcheck-x` and `/health/anything`.

### Files

- `services/xstockstrat-ui/src/lib/`: `deadlines.ts` (new), `connectClients.ts`, `identity.ts`, `bffShared.ts`, `insightsBff.ts`, `traderBff.ts`, `configUiBff.ts`
- `services/xstockstrat-ui/src/middleware.ts`
- `services/xstockstrat-ui/src/lib/connectClients.test.ts` (new)
- the `bffShared` vitest (new or extended)
- `services/xstockstrat-ui/e2e/`: `auth.spec.ts`; `mtls-transport.spec.ts` or a sibling spec; `trader/alert-stream.spec.ts`; `mock-backend.ts`; `fixtures/INVENTORY.md`
- `playwright.config.ts`, if a new env var is added
- this feature's `acceptance.feature`

## Rejected Alternatives

- **`createGrpcTransport({ defaultTimeoutMs })`.** Rejected because its effect on server streams is unverified (recon.md:59, 121). It would put `@AC-6 @feature-210`, `@AC-7 @feature-021` and the three long-lived streams at risk. The wrapper-level unary default is safe by construction.
- **An end-anchored `config.matcher` regex for the health paths.** Rejected because it rewrites the feature-128/165 matcher and depends on how Next compiles `$` inside a lookahead. The body Set is exact by construction, and deleting the two dead prefixes is a narrower change.
- **A 10s default plus a 300s opt-in list with no coverage guard (r1).** Rejected because of the "callers differ, so opt in" scar (fails.md:2946-2950): a future heavy RPC that nobody opts in breaks silently.
- **A 10s default plus a registration-completeness vitest (r2 runner-up).** Rejected because it means hand-maintaining a list of about 80 entries. The 30s default plus the mandatory p99 gate gives the evidence at lower cost.
- **A 5s `REFRESH_TIMEOUT_MS` (r2).** Rejected because it widens the single-use rotation-loss window and would require editing the AC-2 number. 10s still bounds D-37.
- **Leaving `refreshSession` on the 30s default.** Rejected because a black-holed identity would stall every expired-token navigation and every `/api/auth/refresh` POST for 30s, which is the D-37 defect itself.
- **Three constant homes (`connectClients.ts`, `identity.ts`, `bffShared.ts`).** Rejected because one concept spread across three files invites a fourth (C-18). `connectClients.ts` also cannot import `bffShared.ts` without a cycle, which is why the leaf `deadlines.ts` exists.
- **Bypassing `forwardAdmin` with `forward(call, { admin: true, timeoutMs })`.** Rejected because it splits admin call sites across two idioms. The additive option is smaller.
- **A `ui.*` config key for the deadlines.** Rejected because the UI has only a one-shot `GetConfig` and no `WatchConfig`. A key needs new wiring and config-team approval for a value the operator does not tune (F-07 record above).
- **Proving AC-1 and AC-6 by unit-level mock assertion only.** Rejected because that proves the value is threaded through, not that connect-node enforces it against a backend that never responds. The black-hole h2 listener is required.
- **Dropping `/accounts/api/agent-health` from FR-2 and AC-3 (Option 1, the synthesis recommendation).** Rejected by the operator on 2026-10-22, who chose Option 2 (keep it exempt). The cost of that choice is recorded under Open Risks.

## Open Risks

- [ ] **The agent-health exemption loses the silent refresh. Accepted by the operator (2026-10-22, Option 2).**
  - What happens: exempting `/accounts/api/agent-health` from the middleware removes the middleware's silent token refresh on that path.
  - Who is hit: the bare `fetch` at `authorized-apps/page.tsx:59`. When the access token expires after the page loads, that fetch gets the handler's 401, and the page shows the agent as unreachable until the next navigation refreshes the session.
  - Anonymous probes get the handler's 401 JSON, not a 2xx. Accepted as-is; no mitigation is in scope.
  - Target: the spec's middleware step plus the AC-3 example.
- [ ] **Unmeasured latency.** A row marked D/provisional may already exceed 30s in production on large watchlists or long histories, and would then return 504 where the browser used to wait. Addressed by the mandatory p99 gate at `/sdd-spec`. If telemetry is absent, the operator must accept the risk before `implementation-ready`.
- [ ] **Forced logout on a slow-but-alive identity.**
  - Identity's single-use rotation (`identityServiceImpl.ts:228-241`) can commit after the 10s client deadline. The UI clears cookies without ever holding the new token.
  - This affects all three `refreshSession` callers (`middleware.ts:40`, `middleware.ts:76`, `api/auth/refresh/route.ts:10`).
  - It is fail-closed and rare at 10s, but user-visible. Accepted. Cite the identity RefreshToken p99 at spec if available.
- [ ] **A client deadline does not cancel server-side work.** `deleteBackfilledData`, `runBacktest`, `triggerBackfill`, `runFundamentalsScan` and the order mutations can finish after a 504, so the UI must not present a 504 as "nothing happened". A `replaceOrder` retry fails safe through broker rejection, but it confuses the user. To be addressed in the spec's BFF step error copy, or noted as pre-existing.
- [ ] **The 300s `LONG_RPC_TIMEOUT_MS` is unmeasured.** The DO edge HTTP timeout may cut the browser request first, so the bound mainly protects the BFF → backend hop. Covered by the spec p99 gate.
- [ ] **30s still pins resources.** A 30s default lets a hung backend hold a BFF request for up to 30s, which is weaker protection than 10s would be. Accepted trade-off.
- [ ] **Deleting the `api/health|health` matcher alternatives may interact with a durable AC.** The spec must re-read the feature-128/165 suites first, or keep the alternatives as deliberate dead prefixes.
- [ ] **The black-hole h2 listener needs wiring in two places.** Its port and env var go in both `mock-backend.ts` and `playwright.config.ts` (fails.md 2026-08-05). Target: the spec's e2e step.
- [ ] **The AC-5 sentinel may not reach the mock on the server-stream path.** If it does not, fall back to a request field. Verify at spec.
- [ ] **Divergence from sibling 273 (`fix-agent-client-deadlines`).** If 273 picks a different default, record why the values differ (an agent tool call versus a browser BFF hop) rather than forcing them to match.

## Constitution Rules Touched

- `F-07` (no hardcoded config): honored. The deadlines are transport mechanics, not operator config, and the code-constant rationale for all four constants is recorded in approach item 8, following the `FUNDAMENTALS_TIMEOUT_MS` precedent.
- `P-02` (mediated debate): honored. Proposer and adversary saw only synthesized state across both rounds.
- `P-03` (no invention): honored. Every load-bearing claim was re-verified in code: `identity.ts:20-21` fail-closed, the three `refreshSession` callers, `ReplaceOrderRequest` having no idempotency key, and the matcher prefixes at `:22`. Unmeasured latency is marked provisional, not asserted.
- `C-03` (header/trace propagation): honored. `backendHeaders` is unchanged, no fresh context is minted, and the operator's 2026-10-21 x-trace-id decision is met.
- `C-11` (design gate): honored. The agent-health fork was surfaced as blocking and resolved by an explicit operator decision (2026-10-22, Option 2).
- `C-12` and `C-13` (test-data inventory): honored. The AC-2 hang sentinel and the AC-5 held-open stream fixture are registered in `e2e/fixtures/INVENTORY.md`.
- `C-15` (acceptance truth): honored. The AC-1, AC-3 and AC-4 edits are carried into `acceptance.feature` at `/sdd-spec`.
- `C-16` (business rules): honored. Every durable AC is PRESERVE or EXTEND (below), with no CHANGE.
- `C-18` (DRY): honored. All UI deadlines are in one leaf `deadlines.ts`, and `FUNDAMENTALS_TIMEOUT_MS` moves there.
- Floor (`F-*`): no breaches.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @feature-128` "The middleware runs on the Node.js runtime" (`services/xstockstrat-ui/acceptance/ui-middleware-nodejs-runtime.feature`). Not regressed: `config.runtime` and the matcher declaration stay.
- PRESERVE `@AC-2 @feature-128` "A near-expiry access token is refreshed in-process". Not regressed: `refreshSession` stays in-process, and only a `timeoutMs` option is added.
- PRESERVE `@AC-3 @feature-128` "Refreshed cookies keep the same attributes". Not regressed: no cookie code is touched.
- EXTEND `@AC-4 @feature-128` "An expired or invalid session still redirects to login with cookies cleared". New case: a refresh that fails with DEADLINE_EXCEEDED lands in the same branch (recon.md:76-77). `?redirect=` is already set, so no sign-off is needed.
- PRESERVE `@AC-5 @feature-128` "PR #925's loopback workaround is removed". Not regressed: `api/auth/refresh` stays in the matcher verbatim.
- PRESERVE `@AC-6 @feature-128` "Node.js-runtime middleware imports connect-node-backed code and the standalone build succeeds". Not regressed: the lazy `get()` is kept, and `deadlines.ts` has no imports.
- PRESERVE `@AC-5 @feature-153` "An Unauthorized data call redirects the browser to login" (`ui-auth-improvements.feature`). Not regressed: a deadline maps to 504, not Unauthenticated.
- PRESERVE `@AC-7 @feature-153` "The redirect does not loop on the login page itself". Not regressed: the `:32` login check is untouched, and the health Set is a disjoint set of exact paths.
- PRESERVE `@AC-1 @feature-191` "BFF enforces a 30s gRPC deadline on ListOpportunities" (`opportunities-latency-fix.feature`). Not regressed: the per-call literal is kept and overrides the default.
- PRESERVE `@AC-1 @feature-220` "A stalled fundamentals request resolves to the error state" (`fix-trader-position-fundamentals.feature`). Not regressed: `FUNDAMENTALS_TIMEOUT_MS` keeps its 15s value; only its home moves.
- PRESERVE `@AC-6 @feature-021` "An unauthenticated request is rejected" (`ledger-event-export.feature`). Not regressed: `/trader/api/ledger/export` is not in the health Set.
- PRESERVE `@AC-7 @feature-021` "A one-million-row export streams without buffering" (`docs/sdd/business-rules/platform.feature`). Not regressed: the stream wrapper is unchanged.
- PRESERVE `@AC-1 @feature-165` "The app is installable and serves a standalone manifest" (`pwa-notifications.feature`). Not regressed: the PWA matcher alternatives are kept verbatim, and deleting the health prefixes is gated on re-confirmation.
- PRESERVE `@AC-2 @feature-210` "A mutually-authenticated peer … is accepted" (`platform.feature`). Not regressed: the mTLS `nodeOptions` are unchanged.
- PRESERVE `@AC-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS". Not regressed: `backendHeaders` is unchanged.
- PRESERVE `@AC-6 @feature-210` "A long-lived streaming RPC survives a certificate rotation". Not regressed: the default is unary-only.
- This feature's own `@AC-1`…`@AC-6 @feature-271` are new regression guards, not durable rules yet, so their edits are not C-16 CHANGEs. The AC-3 `agent-health` row's expectation of a 401 follows operator decision 2026-10-22 (Option 2, context.md).

## Rounds

- **Round 1 (full).**
  - Proposed: a 10s default plus a 300s opt-in list.
  - Blocking objections: an incomplete enumeration of long callers, and silent opt-in drift.
- **Round 2 (full).**
  - Proposed: a 30s default, the refresh bound and the classification table.
  - Synthesis changes: the refresh bound moved to 10s, the constants moved to the leaf `deadlines.ts`, the table was corrected, and the p99 gate became mandatory.
  - One blocking C-11 question remained: agent-health.
- **Termination: approved.** The operator approved at the round-2 gate on 2026-10-22 and chose Option 2 on agent-health. Floor clear.
