# Context Log: fix-ui-transport-hardening

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-ui-transport-hardening-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-37, D-38.
- Severity: SEV-3. Impact type: request-hang-and-health-probe-auth. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Routed to SDD path (Track C) per the batch operator decision (grouped with the UI findings; Track C even at this
  severity, no hotfix/config route applies).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..4), context.md.
- Affected services: xstockstrat-ui.
- Root cause hypothesis: D-37 mTLS transport wrapper never set a default deadline, so each call site must opt in;
  D-38 health routes moved under segment prefixes (feature 045) while the matcher kept root-level exclusions.
- Re-verification on main-dev @ a053b0e: both reproduce in code. Line drift: none — `connectClients.ts:53-62`,
  `identity.ts:14`, `insightsBff.ts:58`, `:103` (plus `:114`), `traderBff.ts:78`, `middleware.ts:22`. No
  `defaultTimeoutMs` anywhere in `src/`. Health routes counted: 8 (trader ×2, insights ×2, config-ui ×2,
  accounts `api/health` + `api/agent-health`); `src/app/api/` has no health route, so the root exclusions match nothing.
  `refreshSession` is called from `middleware.ts:40`.
- **Overlaps:** 241-fix-config-audit-author-spoof (`implementation-ready`) mocks `@/lib/connectClients` in tests
  (test-level only; a new transport option does not change the mock shape). No 240–253 feature touches
  `middleware.ts` or `identity.ts`. Related, separate: debt-radar D-16 (agent `client.py` default deadline) is sibling batch feature
  273-fix-agent-client-deadlines (created concurrently); align the default-deadline value/approach across the two if design
  chooses a shared convention.
- Recommended design depth: skip → `/sdd-spec fix-ui-transport-hardening` (rationale: single service, no
  proto/migration/config, clear root cause). Escalate to `/sdd-design fix-ui-transport-hardening quick` if the
  default deadline is made a `ui.*` config key (root CLAUDE.md "no hardcoded values" vs the existing
  `FUNDAMENTALS_TIMEOUT_MS`-style constants), or if the matcher change needs a Security pass beyond the health routes.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Development branch: feature/fix-ui-transport-hardening

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (no fails, no floor breaches).
- Warnings:
  - Criterion 9 (Open Questions): three unresolved questions remain (default deadline value, constant vs `ui.*`
    key, streaming opt-out mechanism), each with a proposed resolution deferred to /sdd-design. Resolve them before
    the impl-spec gate. Question 2 is material: a config key flips the Fix Scope config box and brings in C-05
    naming and config-team approval.
  - Criterion 8 (AC well-formedness): AC-1 and AC-2 assert "no later than the default deadline (proposed 10s)";
    pin the number in acceptance.feature once design decides. **Resolved this session:** the non-standard tag
    `@AC-1b` (per-call override scenario) was retagged `@AC-6`. No other scenario was renumbered, so the AC
    references in product-spec.md stay valid.
  - Criterion 8 (AC-5): the stream-not-cut-off scenario needs a harness that holds the stream open past the default
    deadline and then delivers an alert. `e2e/mock-backend.ts` may not support that; settle test feasibility at design.
  - Criterion 11 (Consumer Surface): the surface is probe/middleware behavior, not a visible UI change. Acceptable,
    but the section does not use the C-14 checkbox / `None - internal/platform-only` convention.
  - FR-1 / D-37 scope: `connectClients.ts:66-73` wraps unary and stream separately, so a unary-only default is
    feasible. Design must preserve the explicit long unary `timeoutMs` at `insightsBff.ts:58`, `:103`, `:114` and
    `traderBff.ts:78` (30s / `FUNDAMENTALS_TIMEOUT_MS`).
- Overlap findings: none (overlap verdict PASS, no collisions).
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-37, D-38.
- Next: `/sdd-design fix-ui-transport-hardening`.

## Session 2026-10-22 — sdd-batch design state recovered (round 1)

- The batch run that produced round 1 was cut off by the session usage limit before its gate writer persisted the debate state. This block is the round-1 synthesis restored verbatim from the run journal (`synth:fix-ui-transport-hardening:r1`), so the next /sdd-batch run resumes from it instead of redoing the debate.

```sdd-batch-design-state
{
  "round": 1,
  "synth": {
    "approach": "Round-1 synthesis (P-02). Keep the parts of r1 that both sides agree on. Replace the 10s-default-plus-opt-in-list cliff with a generous default and a short, explicit bound on the actual D-37 hang site.\n\nD-37 (transport deadline):\n1. `services/xstockstrat-ui/src/lib/connectClients.ts:66-73`, `makeTransport` \u2192 `unary`: forward `timeoutMs ?? DEFAULT_UNARY_TIMEOUT_MS`. Leave `stream` byte-for-byte unchanged and leave the lazy `get()` build (:45-53) as it is. Do not use `createGrpcTransport({defaultTimeoutMs})`.\n   - Default value: the adversary's alternative (a), 30_000, following the 30s precedent in `@AC-1 @feature-191`.\n   - It is an exported code constant, not a `ui.*` key. design.md must state the F-07 reading: the UI has no `WatchConfig`, and this is transport mechanics the operator does not tune, like `FUNDAMENTALS_TIMEOUT_MS` at `bffShared.ts:55`.\n   - If the next proposer keeps 10s instead, it must adopt option (b), the registration-coverage vitest described below.\n2. `src/lib/identity.ts:14` `refreshSession`: pass `{ timeoutMs: REFRESH_TIMEOUT_MS }` (5_000) on `identityClient.refreshToken`. This is a one-line change and the direct D-37 hang site. Timeout \u2192 `catch` returns null (`identity.ts:20-21`) \u2192 the existing fail-closed redirect runs (`middleware.ts:40`, `:59-63`, `:76-81`). AC-2 then passes in about 5s, not about the default.\n3. `src/lib/bffShared.ts:80-84`: give `forwardAdmin` an additive optional `options: { timeoutMs?: number }` and pass it through to `forward(call, { admin: true, ...options })`. Widen `call`'s opts type to `{ headers: Headers; timeoutMs?: number }`. Add `LONG_RPC_TIMEOUT_MS = 300_000` next to `FUNDAMENTALS_TIMEOUT_MS` (`:55`).\n4. Calls that are known or plausibly longer than 30s get an explicit `{ timeoutMs: LONG_RPC_TIMEOUT_MS }`:\n   - `runBacktest` (`insightsBff.ts:41`; runs inline at `servicer.py:785`)\n   - `screenSymbols` (`:42`)\n   - `scoreStrategy` (`:40`)\n   - `triggerBackfill` (`:80`)\n   - `deleteBackfilledData` (`:117-119`, via the new `forwardAdmin` option). This is a destructive bulk delete, and a client giving up early leaves the server deleting while the UI reports an error.\n   - `runFundamentalsScan` (`configUiBff.ts:69`, via `forwardAdmin(call, { timeoutMs })`)\n5. design.md must contain a full classification table of every unary registration in `insightsBff.ts`, `traderBff.ts`, `configUiBff.ts` and the `accounts/api/*` route handlers, each marked default or long. With a 30s default, the adversary's flagged heavy reads (`executeFormula`/`computeIndicator` :196-197, `getIndicatorSeries` :68, `evaluateReadiness` :62, `getWatchlistReadiness` :65, `getStrategyAnalytics` :66, `queryPnLPatterns` :70, `getAttribution` :72, `getHistoricalFundamentals` :105, `getBars` insights :100 / trader :74, `queryEvents` insights :153 / trader :123) must each be justified as fitting in 30s or moved to long.\n   - Existing per-call 30s and 15s values (`getFundamentals`, `listOpportunities`, `getFundamentalsMulti`) keep overriding the default.\n   - Streams that stay unbounded, to be named explicitly in design.md: `streamAlerts` (`traderBff.ts:85`), `streamOrderUpdates` (`traderBff.ts:46`), and `exportEvents` (`route.ts:115`).\n\nD-38 (health exemption), accepted unchanged from r1:\n- `src/middleware.ts`: a module-level `PUBLIC_HEALTH_PATHS` Set, and as the first statement of `middleware()`, `if (PUBLIC_HEALTH_PATHS.has(req.nextUrl.pathname)) return NextResponse.next();`. This runs before `getSessionFromRequest` and copies the exact-match pattern at `:32`.\n- `config.matcher` (`:16-23`) and `runtime` stay verbatim.\n- Whether `/accounts/api/agent-health` belongs in the Set is an open operator decision (see objections).\n\nHeader propagation (operator 2026-10-21, x-trace-id): no change. `backendHeaders(claims, ctx)` keeps carrying the inbound `x-trace-id` on every forwarded unary and stream call. No call site mints a fresh context or headers.\n\nTests:\n- (1) New `src/lib/connectClients.test.ts`, vitest node env. Mock `createGrpcTransport` at module level so the lazy build is exercised, and stub `MTLS_*` or mock `loadMtls` (`connectClients.ts:34-36`). Cases: the default applies to unary, a per-call value wins, stream `timeoutMs` passes through untouched.\n- (2) Unit-test `forwardAdmin` timeout threading in `bffShared`.\n- (3) e2e for AC-2 (identity mock `refreshToken`, `mock-backend.ts:184`, hangs on a sentinel refresh token that is registered in the fixture INVENTORY per C-12/C-13; test timeout \u2265 10s), AC-3/AC-4 (exact path and lookalike paths in `e2e/auth.spec.ts`), and AC-5 (held-open `streamAlerts` variant, `mock-backend.ts:530-535`). For AC-5, first verify that request-scoping by `x-trace-id` actually reaches the mock on the server-stream path; if not, fall back to a request field.\n- Optional, required only if the default stays at 10s: a vitest asserting that every `forward`/`forwardAdmin` registration is in an explicit default or long list.\n\nFiles: `services/xstockstrat-ui/src/lib/{connectClients,bffShared,identity,insightsBff,configUiBff}.ts`, `src/middleware.ts`, `src/lib/connectClients.test.ts` (new), `e2e/{auth.spec.ts,trader/alert-stream.spec.ts,mock-backend.ts}`, `e2e/fixtures/INVENTORY.md`.",
    "open_objections": [
      {
        "text": "[P-03 / C-16 risk] The long-caller enumeration is incomplete. r1 classified 5 calls by name grep. design.md needs a complete table of every unary registration across insightsBff.ts, traderBff.ts, configUiBff.ts and the accounts/api/* handlers, each marked default or long with a one-line justification. The table must include deleteBackfilledData (destructive bulk delete), executeFormula/computeIndicator, getIndicatorSeries, evaluateReadiness, getWatchlistReadiness, getStrategyAnalytics, queryPnLPatterns, getAttribution, getHistoricalFundamentals, getBars (insights and trader) and queryEvents (insights and trader). A raised default (30s) shrinks this list but does not remove it.",
        "blocking": true
      },
      {
        "text": "[C-18] Opt-in drift: with a tight default plus a long list, any future heavy RPC breaks silently when its author forgets to opt in, and nothing catches the omission. The next proposer must choose: (a) a generous default (30s, the @feature-191 precedent) plus an explicit short timeoutMs on refreshSession, or (b) keep 10s and add a vitest asserting that every forward/forwardAdmin registration is in an explicit default or long list. r1 offered neither.",
        "blocking": true
      },
      {
        "text": "[P-03 / C-11] Exempting agent-health is a scope trade-off that needs an operator decision. Anonymous probes always get a 401 from agent-health/route.ts:7-8, so the exemption serves no probe. It also removes middleware's silent refresh for signed-in users: authorized-apps/page.tsx:59 uses a bare fetch, so an access token that expired after page load now gets a 401 and the page shows the agent as unreachable. Ask the operator to choose between 'exempt it and accept this' and 'drop it from FR-2'. Both are low-rework.",
        "blocking": false
      },
      {
        "text": "Mutations that time out leave unknown state. placeOrder, confirmOrder, replaceOrder and cancelOrder (traderBff.ts:33-45) now return 504 at the default while the broker may still be executing. design.md must confirm that the browser reuses the same client_order_id (trading.proto:48,122-125) on retry after a 504, and must either show that broker latency fits within the default or give these calls a longer bound.",
        "blocking": false
      },
      {
        "text": "[F-07 record] design.md must state in writing why DEFAULT_UNARY_TIMEOUT_MS, REFRESH_TIMEOUT_MS and LONG_RPC_TIMEOUT_MS are code constants rather than ui.* keys: the UI has no WatchConfig, ui is a one-shot GetConfig, and these are transport mechanics the operator does not tune. Without this, review will raise F-07 again.",
        "blocking": false
      },
      {
        "text": "Vitest harness: connectClients.test.ts must stub MTLS_* or mock loadMtls, because the lazy get() throws without them (connectClients.ts:34-36). It must also mock createGrpcTransport at module level so the @AC-6 @feature-128 lazy build is exercised, not bypassed.",
        "blocking": false
      },
      {
        "text": "AC-5 scoping of the streamAlerts mock by x-trace-id is unverified end-to-end on the server-stream path. Verify that backendHeaders delivers the inbound trace id to the mock before relying on it, and fall back to a StreamAlertsRequest field if it does not. The mock's default stream path must keep ending cleanly (mock-backend.ts:534).",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 @feature-271",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-271",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-271",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 @feature-271",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-271",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 @feature-271",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1..6 @feature-128",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-153",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 @feature-153",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-191",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-220",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 @feature-021",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 @feature-021",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-165",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-210",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-210",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 @feature-210",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "`createGrpcTransport({ defaultTimeoutMs })` as the default: its effect on server streams is unverified, and it risks @AC-7 @feature-021, @AC-6 @feature-210 and the streamAlerts/streamOrderUpdates/exportEvents streams. Both sides rejected it; the wrapper-level unary default wins.",
      "An end-anchored `config.matcher` regex for the health paths: it depends on how Next's matcher compiler treats `$` inside a lookahead, and it would rewrite the feature-128/165 matcher. The exact-match Set in the function body is exact by construction and copies `middleware.ts:32`.",
      "A 10s default plus a 300s opt-in list with no coverage guard (r1 as written): the enumeration is incomplete, and nothing stops future opt-in drift. This is the fails.md:2946-2950 class. It survives only if paired with the registration-coverage vitest.",
      "Switching `runFundamentalsScan` (and later `deleteBackfilledData`/`cancelBackfill`) to `forward(call, { admin: true, timeoutMs })` and bypassing `forwardAdmin`: it splits admin call sites across two idioms. An additive optional `timeoutMs` on `forwardAdmin` is smaller and clearer.",
      "A `ui.*` config key for the deadline: the UI's `ui` namespace is a one-shot GetConfig with no WatchConfig, so a key would need new wiring plus config-team approval for a value the operator does not tune. That is high rework against the low-rework directive.",
      "A black-hole h2 listener for AC-1/AC-2/AC-6: it tests a real socket, but costs a port plus an env var wired in two places (the fails.md 2026-08-05 trap). Kept as the runner-up, used only if the reviewer demands a real-socket test; unit tests with a fake transport plus the identity-mock sentinel are cheaper."
    ],
    "open_risks": [
      "Even with a 30s default, an unclassified call longer than 30s regresses to a 504. The completeness of the classification table is the main residual risk.",
      "300s for LONG_RPC_TIMEOUT_MS is not measured against real backtest or fundamentals-scan durations. The DO edge HTTP timeout may cut the browser request earlier anyway, so the long bound mostly protects the BFF to backend hop.",
      "A client deadline does not cancel server-side work. deleteBackfilledData, runBacktest and order mutations can keep running after a 504, and the UI must not present that as 'nothing happened'.",
      "A 30s default still lets a hung backend pin a BFF request for up to 30s, which is less protection against resource pinning than 10s.",
      "The AC-5 trace-id-scoped mock variant may not receive x-trace-id on the server-stream path, which would force a fallback to a request field.",
      "Alignment with sibling 273 (fix-agent-client-deadlines): if 273 picks a different platform default, the two features should reconcile or say explicitly why the values differ."
    ],
    "constitution_rules_touched": [
      "F-07",
      "P-02",
      "P-03",
      "C-03",
      "C-11",
      "C-12",
      "C-13",
      "C-15",
      "C-16",
      "C-18"
    ],
    "rationale": "The two sides agree on the overall shape: the default goes in the unary wrapper, streams stay untouched, and the health exemption is an exact-match Set ahead of the session check with the matcher left verbatim. The adversary confirmed no C-16 breaks against the durable suites, and the operator's x-trace-id rule is met because `backendHeaders` is unchanged on every path.\n\nThe real gap is the deadline policy. A grep of the BFFs shows unary calls r1 left unclassified, including the destructive `deleteBackfilledData`, so a 10s blanket default with a hand-kept opt-in list repeats the fails.md:2946-2950 'callers differ, so opt in' scar. The user asked to preserve as much as possible with low rework, which favours the adversary's alternative:\n- A generous 30s default, which has precedent, changes far fewer existing calls.\n- An explicit 5s bound on `refreshSession` fixes the actual D-37 hang site and makes AC-2 fast.\n- The long-call list stays explicit but much shorter.\n- An additive `forwardAdmin` option removes the need to bypass the helper.\n\nThe completeness objection and the drift objection stay blocking, because r1 does not concretely answer either. The next proposer must produce the full classification table and commit to option (a) or (b). The agent-health exemption needs an operator decision rather than a silent call, and no operator decision covers it today. That is also why no AC is marked covered_by_operator_decision: the feature-271 ACs are new behaviour the spec defines, and every durable AC is preserved."
  },
  "floor_breaches": []
}
```
