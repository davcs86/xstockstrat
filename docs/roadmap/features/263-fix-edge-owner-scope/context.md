# Context Log: fix-edge-owner-scope

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-edge-owner-scope-defect.md` (Issues disabled), sidecar
  `triaged` / `ref: feature:263-fix-edge-owner-scope`.
- Source: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-25,
  D-31 (both flagged security, "Human triage" routing in the scan).
- Severity: SEV-2. Impact type: cross-tenant-data-read. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2
  (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..6), context.md.
- Affected services: xstockstrat-ui, xstockstrat-ledger, xstockstrat-agent, xstockstrat-config.
- Root cause hypothesis: owner scoping is per-edge special-casing; ledger `QueryEvents` has no owner concept and
  config reads trust body `user_id` over the verified `x-user-id`.
- Both D-ids reproduce on a053b0e. Line drift vs the scan: none — `traderBff.ts:118-126`,
  `ledgerServiceImpl.ts:124-165` (WHERE built `:126-156`), `tools.py:1592-1617` / `:1620-1639`, config
  `configServiceImpl.ts:317` / `:527`.
- New evidence found at triage (not in the scan): the exposure has live callers —
  `services/xstockstrat-ui/src/hooks/usePositionLineage.ts:16-19` sends no stream key (owner filtered client-side
  only) and `useReconciliationStatus.ts:12-13` sends `account:<id>` with no ownership check. Lineage also filters
  `sourceService: 'trading'`, which trading never writes (it writes `xstockstrat-trading`), so lineage likely returns
  nothing today; fixing that literal before D-25 would begin shipping other users' fills to the browser.
- Agent propagates the verified caller as `x-user-id` (`client.py:59-79` `_metadata`), so config already has the
  signal it needs; a config-side bind would also cover the trader/insights BFF `getConfig` forwards
  (`traderBff.ts:146`, `insightsBff.ts:161`), which pass the browser's body through unchanged.
- **Overlap check:** no `docs/reports/*config*user*` report exists. Adjacent but excluded: debt-radar NC-B
  (`configServiceImpl.ts:343`, `getSecret` takes body `user_id`) is still a needs-confirmation question, not a
  finding. Feature `241-fix-config-audit-author-spoof` (implementation-ready) edits config `setConfig` and agent
  `tools.py`/`client.py` config tools — rebase against it. Feature `242-fix-push-untargeted-broadcast` touches
  `traderBff.ts` and config `authz.ts` — textual merge risk. Feature `251-fix-getpnl-source-service` is the same
  source-service literal class as the lineage note above.
- Design forks to settle: (a) D-25 fix locus — BFF allow-list + account-ownership check (needs a trading
  `ListBrokerAccounts` lookup per call or a cached set) vs a backend ledger owner predicate. `ledger.events` already
  has a nullable `user_id` (`migrations/003_events_user_id.up.sql`, feature 021) and `ExportEvents` already scopes
  `WHERE user_id = <x-user-id>` (`ledgerServiceImpl.ts:279-311`), so no migration is needed — but historical rows
  are `user_id = NULL` (UPDATE is denied), and backend writers that append without a user would vanish from a
  scoped read; empty stream key: refuse vs force-scope. (b) D-31 fix
  locus — agent binds `user_id` to the caller vs config binds body `user_id` to `x-user-id` unless admin /
  allow-listed internal caller (must not break internal per-user `WatchConfig` subscribers); whether admins keep
  cross-user reads.
- Recommended design depth: full → `/sdd-design fix-edge-owner-scope` (rationale: SEV-2 security with 4 affected
  services — the C-0 full trigger; no proto/migration anticipated).
- Development branch: feature/fix-edge-owner-scope

## Session 2026-10-22 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (0 fails, 0 floor breaches).
- Warnings (8):
  1. AC-2 had no NULL-`user_id` fixture — **resolved**: Background seeds an `order.filled` on `account:acct-legacy`
     with NULL `user_id` (symbol TSLA); AC-2 asserts it is not returned.
  2. AC-3 copilot isolation loosely specified — **resolved**: seeds `note-a` (`copilot:u-a:default`) and `note-b`
     (`copilot:u-b:default`); asserts exactly `note-a` is returned.
  3. FR-2 "either refused or owner-scoped" contradicted AC-2/AC-7 — **resolved**: FR-2 narrowed to owner-scoping
     (Expected paragraph aligned).
  4. FR-6 listed before FR-5 — **resolved**: reordered.
  5. FR-1 `account:<id>` ownership determination unnamed — **deferred to /sdd-design**: recorded as an open Open
     Question (trading `ListBrokerAccounts` per call vs cached set vs ledger `user_id` predicate; C-11).
  6. Consumer surface PERMISSION_DENIED mapping for `useReconciliationStatus` (advisory) — **resolved**: foreign
     account surfaces through the hook's existing error state.
  7. Doubled input paths from the caller — informational; real dir is `docs/roadmap/features/263-fix-edge-owner-scope/`.
  8. Trading-domain grep matched incidentally — C-1..C-5 not applicable; no action.
- Operator override applied (2026-10-22): FR-3/FR-4, AC-4/AC-5, Expected, Consumer Surface and the Open Questions
  entry now assert **bind-to-caller** (the caller's own `x-user-id` replaces a foreign `user_id`; caller's own
  overrides returned; no other user's data read), replacing the 2026-10-21 "refuse with PERMISSION_DENIED".
- Overlap findings (WARN, file-level only; no config-key / proto-field / migration FAIL):
  - ledger `ledgerServiceImpl.ts:124` QueryEvents vs `257-fix-ledger-query-pagination` (draft; same queryEvents
    body `:157-171`) — high merge-conflict risk if 263 adds a backend owner predicate; 257 also flags other
    QueryEvents callers.
  - ledger `ledgerServiceImpl.ts` vs `248-fix-ledger-trimmed-notify-payload` (implementation-ready; `:196-257`,
    `:364-377`) — same file, non-overlapping bands.
  - agent `tools.py:1592`/`:1620` vs `241-fix-config-audit-author-spoof` (implementation-ready; `set_config`
    `:1694`, `_write_source_bearer` `:353`) — same file, different functions.
  - agent `tools.py:1592-1640` vs `247-fix-agent-getconfig-deadline` (implementation-ready; `client.py:1751`,
    `tools.py:627`, `:2378`) — collides if 263 changes the `client.get_config` call.
  - agent `tools.py` vs `273-fix-agent-client-deadlines` (draft; `GetConfig` `:2043`) — low-to-medium risk.
  - config `configServiceImpl.ts` (`:78-79`, `:317-319`, `:527-536`) vs `241` (SetConfig `:376-414`, `:513`) —
    same file, non-overlapping bands.
  - UI `traderBff.ts:118-123` vs `270-fix-ui-trader-feedback` (draft; no anchors yet) — same-service WARN.

### OPERATOR DECISIONS (binding, recorded 2026-10-22)

- Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C (precedent #1264).
- Scope is D-25, D-31.
- Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
- Operator 2026-10-22 overrides the review writer's D-31 resolution: a non-admin get_config/list_config_keys call carrying a foreign user_id is BOUND to the caller (the caller's own x-user-id replaces it), NOT refused with PERMISSION_DENIED. Amend FR-3/FR-4 and AC-4/AC-5 (and the Open Questions entry) to assert the caller's own overrides are returned and no other user's data is ever read. Confirmed unchanged: admin-scope callers stay exempt (FR-6/AC-8); NULL-user_id ledger rows are never returned by trader-BFF reads (FR-2, ExportEvents parity). D-25 fix site remains a /sdd-design choice.

- Next: `/sdd-design fix-edge-owner-scope` (full depth recommended).

## Session 2026-10-22 — sdd-batch design gate (round 2)

`/sdd-design fix-edge-owner-scope` (full debate) is halted at the approval gate after round 2 (gate policy: halt).
Per the grilling protocol `design.md` is not written and `status.md` stays `spec-ready`.

## Open Threads

- **Approach (D-31):** bind at config. A new `boundReadUserId(call)` helper in `xstockstrat-config/src/grpc/authz.ts`
  replaces a foreign, non-empty body `userId` with the header caller when that caller is non-empty and not
  admin-scoped (0x04). It is used by `getConfig` (:317) and `listKeys` (:527). There is no refusal path (operator
  2026-10-22). `watchConfig`/`getSecret` are untouched. The config-ui admin view is verified safe because
  `backendHeaders` sets 0x04 from the admin role. The trader and insights forwards are closed with no BFF edits.
  New in round 2: the agent's `get_config`/`list_config_keys` (`client.py:2059`/`:2080`) echo the *effective*
  user_id, computed by the same rule from `_CALLER` with `scopes._ADMIN`, plus one unit test. The "agent unchanged"
  claim is withdrawn.
- **Approach (D-25):** unchanged from round 1. In trader BFF `queryEvents`:
  - one `backendHeaders` call per request
  - `copilot:` keys are rewritten to the caller's own key
  - `account:<id>` keys are ownership-checked with `ListBrokerAccounts`: unowned or empty → PERMISSION_DENIED,
    trading error → its code passed through (fail-closed), owned → unfiltered
  - every other key forces `ownerOnly:true`

  An additive `bool owner_only = 7` on `QueryEventsRequest` drives a ledger owner predicate. That predicate comes
  from a helper shared with `exportEvents` (C-18), and the SQL is byte-identical when the flag is absent.
- **Strongest open objection (blocking):** [P-03/C-18] the agent echo fix must land as specified, with a test, or
  the team must explicitly drop the echo and document that in agent CLAUDE.md and mcp-tools.md. A silent mislabel
  is not acceptable. Proposer r3 or spec must confirm.
- **Floor status:** no Floor breaches.
- **Uncovered @AC changes:**
  - @AC-1 @feature-263 is EXTEND with no explicit operator text.
  - All CHANGE kinds are covered by the operator's 2026-10-22 decisions: AC-2, AC-4, AC-5, and @AC-9 @feature-196.
    @AC-9 @feature-196 still needs an explicit CHANGE sign-off entry in context.md.
- **Owed before spec (non-blocking):**
  - acceptance.feature: the AC-4/AC-5 bind amendment, plus new AC-7 (lineage, evidenced by SQL-capture and the e2e
    mock, not a live smoke test) and AC-8 (admin exemption)
  - FR-1/FR-2 wording for the owned-account exception
  - the config-ui non-admin assumption stated explicitly
- **Risks to record:**
  - field-7 / `queryEvents` overlap with 257
  - `configServiceImpl.ts` collision with 241
  - `client.py:2034-2080` collision with 247/273
  - `owner_only` fails open by default

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "ROUND-2 SYNTHESIS (feature 263, D-25 + D-31). Proposer r2 confirmed the config-side bind and answered both blocking round-1 objections, so those are closed. One new blocking objection remains: the agent mislabels which user a result belongs to. It has a small, contained fix, adopted below. Everything else is preserved as synthesized.\n\nD-31: bind in config (confirmed), plus a small agent echo fix.\n- New helper `boundReadUserId(call)` in services/xstockstrat-config/src/grpc/authz.ts, next to userIdFrom (:27) and hasAdminAccessScope (:20-24).\n  - It returns the header caller `userIdFrom(call.metadata)` only when all three hold:\n    - the header caller is non-empty\n    - `!hasAdminAccessScope(call.metadata)`\n    - the body userId is non-empty and differs from the header caller\n  - Otherwise it returns the body userId unchanged.\n  - There is no refusal path (operator decision 2026-10-22).\n- Call sites:\n  - configServiceImpl.ts getConfig (:317)\n  - configServiceImpl.ts listKeys (:527); its SQL `(user_id IS NULL OR user_id = $3)` at :534 then reads only global rows plus the caller's own\n- watchConfig (:283) and getSecret (:343) are untouched, which keeps invariant #5, @AC-13 @feature-147 and NC-B intact.\n- The config-ui admin view is verified safe. configUiBff.ts:33 calls `forward`, which calls `backendHeaders` (bffShared.ts:38-44, :71-73). That sets x-access-scope from `rolesToAccessScope`, and the admin role sets 0x04 (ui auth.ts:79/:89). Config tests the same 0x04 bit (authz.ts:8). So @AC-8/9/12 @feature-219 are preserved.\n- The trader (traderBff.ts:146) and insights (insightsBff.ts:162) forwards are closed at the same site. No BFF edits are needed.\n- NEW, adopted from adversary r2 (blocking): fix the agent result label.\n  - services/xstockstrat-agent/app/client.py get_config (:2034-2061) and list_config_keys (:2064-2080) echo the requested `user_id` (:2059, :2080).\n  - Instead, compute the effective id with the same rule config uses, from the existing `_CALLER` contextvar (:34-36):\n    - if a caller is bound, its user_id is non-empty, `not (access_scope & 0x04)`, and the requested user_id is non-empty and differs from it, echo the caller's user_id\n    - otherwise echo the request\n  - Use the existing `_ADMIN = 0x04` in app/scopes.py:35 rather than a new literal (DRY).\n  - The fix needs no ctx, so the ctx-less tests at tests/test_config_tools.py:78/:320/:328 keep passing (with no caller bound, the echo is unchanged).\n  - Add one agent unit test: bind a non-admin caller, request a foreign user_id, and assert the echoed user_id is the caller's.\n  - Docstrings and agent CLAUDE.md rows must say that a non-admin's foreign user_id is bound to the caller.\n- The \"agent code unchanged\" claim is withdrawn. Agent changes are limited to the two echo lines, one small private helper, and docstrings.\n\nD-25 is unchanged from the round-1 synthesis, with r2 hardening.\n- traderBff.ts:118-127 queryEvents builds `headers = backendHeaders(claims, ctx)` once and reuses it for every outbound call, so one x-trace-id covers the request (C-03).\n  1. A `copilot:` key is rewritten to copilotStreamKey(claims.user_id).\n  2. An `account:<id>` key:\n     - Parse the id as the exact remainder after the prefix, then call `tradingClient.listBrokerAccounts({}, {headers})`. Ownership comes from account_repo.go:84-92; the call is unpaginated (trading.proto:297-301) and includes OFFLINE accounts.\n     - Empty id or id not owned: PERMISSION_DENIED.\n     - ListBrokerAccounts itself errors: pass through the trading error code (UNAVAILABLE / DEADLINE_EXCEEDED). Do not relabel it as PERMISSION_DENIED (adopted, r2 non-blocking). It still fails closed: no ledger call and no fall-through to branch 3.\n     - If owned, forward unfiltered so the NULL-owned reconciliation rows still appear (trading.go:1930, :3669; AC-3).\n  3. An empty key or any other key: always force ownerOnly:true and never take it from the browser.\n- Proto: additive `bool owner_only = 7;` on ledger.v1.QueryEventsRequest (ledger.proto:60-67), with a field comment of at most 2 lines saying every user-facing edge MUST set it. Then run buf lint, buf breaking and ./scripts/buf-gen.sh.\n- Ledger, ledgerServiceImpl.ts:124 queryEvents:\n  - Extract the caller-owner derivation that exportEvents uses today (:301-302, `call.metadata?.get?.('x-user-id')?.[0] ?? ''`, where an empty caller matches nothing and NULL rows are excluded) into one small helper.\n  - exportEvents and queryEvents both use the helper (adopted from adversary r2, C-18 DRY; existing export tests protect @AC-11 @feature-021).\n  - The predicate applies only when req.ownerOnly is set. A SQL-capture test proves the flag-absent SQL stays byte-identical.\n- Tests:\n  - ledger SQL/params capture\n  - BFF unit test: branch 3 always sends ownerOnly:true; the account branch denies an unowned id and an empty id, and passes a trading error code through\n  - e2e mock (mock-backend.ts:394) returns foreign and NULL rows when ownerOnly is unset\n  - fixtures in e2e/fixtures/ledgerEvents.ts plus INVENTORY.md (C-13)\n\nBuild order:\n1. Proto + buf-gen.\n2. Ledger helper/predicate + tests.\n3. BFF branches + unit test + e2e mock/fixtures.\n4. Config helper + test matrix (both RPCs):\n   - non-admin foreign → bound\n   - admin foreign → honoured\n   - header-less → body honoured\n   - empty body → global\n   - self → own overlay\n   - secrets still redacted under a bound overlay\n   - a regression test pinning bind-not-refuse for a header-carrying internal caller\n5. Agent echo fix + test.\n6. Docs (C-10), in the same PR:\n   - ledger CLAUDE.md: owner_only semantics, the invariant that edges must set it, and the Stream Key table with account:{id} and copilot:{user}:default\n   - config CLAUDE.md invariant #5: reads open, a non-admin body user_id is bound to the header, and future internal readers must not rely on a foreign body id while forwarding a user header\n   - agent CLAUDE.md rows and the \"Body user_id is still sent…\" paragraph, plus docs/runbooks/mcp-tools.md\n   - product-spec Fix Scope \"No proto changes anticipated\" line corrected\n   - FR-1/FR-2 scoped exception text\n   - AC-4/AC-5 bind amendment, AC-7/AC-8 added to acceptance.feature\n   - findings entry (P-03) covering: WatchConfig body user_id, unbound stdio/empty-claims agent paths, unscoped streamEvents (:182)/getEvent (:262), and branch 3 hiding the owner's NULL-owned order_intent.* rows on order:<id> streams (trading.go:2247, :2278), accepted as a limitation\n   - context.md: the CHANGE sign-off citing the operator's 2026-10-22 decision for the @AC-9 @feature-196 field-semantics change\n   - field-7 / queryEvents overlap recorded in 263 and 257 context.md and merge-order.md\n   - 241 (configServiceImpl.ts) and 247/273 (client.py:2034-2080) collisions recorded in merge-order.md\n\nUnchanged: insightsBff queryEvents, ExportEvents behaviour, the four internal Go QueryEvents callers, and the agent→config wire.",
    "open_objections": [
      {
        "text": "[P-03/C-18] The agent echo fix must land as specified above. client.py:2059/:2080 must echo the effective (bound) user_id, using the same rule as config: a non-admin caller with a foreign non-empty user_id gets their own id, and the 0x04 check comes from app/scopes.py:35. A test must pin this. Proposer r3 or spec must confirm. If the team prefers to drop the user_id echo entirely, that must be stated and documented in agent CLAUDE.md and mcp-tools.md. A silent mislabel is not acceptable.",
        "blocking": true
      },
      {
        "text": "[C-15] acceptance.feature on this checkout still needs: the AC-4/AC-5 bind amendment (caller's own overrides returned, no other user's data read), AC-7 (lineage) and AC-8 (admin exemption) added, and FR-1/FR-2 wording for the owned-account unfiltered exception. Owed before spec, not before design approval.",
        "blocking": false
      },
      {
        "text": "[C-16] AC-7 cannot be proven live, because usePositionLineage.ts:18 sends sourceService 'trading', which nothing writes. It must be evidenced by the ledger SQL-capture test plus the e2e mock, and must not be counted as a dev smoke-test pass.",
        "blocking": false
      },
      {
        "text": "[C-16 @AC-9 @feature-196] The change in meaning of body user_id for non-admin callers that send a header needs an explicit CHANGE sign-off entry in context.md, citing the operator decision of 2026-10-22.",
        "blocking": false
      },
      {
        "text": "Config-ui non-admin case: a non-admin who picks user X in useConfigKeys sees their own rows. The assumption should name this case explicitly (a UI hint stays out of scope).",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 @feature-263",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-263",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3 @feature-263",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 @feature-263",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-5 @feature-263",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-6 @feature-263",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 @feature-263 (lineage under ownerOnly)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "FR-6/AC-8 admin-scope exemption",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-13 @feature-219 (empty user_id = global)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8/@AC-9/@AC-12 @feature-219 (config-ui operator view)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-13 @feature-147 / @AC-3 @feature-147 (secret redaction/read path)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-11 @feature-021 (ExportEvents owner scoping, via extracted helper)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9 @feature-196 (body user_id semantics for non-admin header callers)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      }
    ],
    "rejected_alternatives": [
      "Agent-tool-only bind via ctx (D-31, r1 and recon option). It closes only the agent edge, leaves traderBff.ts:146, insightsBff.ts:162 and the configUiBff.ts:33 non-admin path open, and breaks tests/test_config_tools.py:78/:320/:328.",
      "Minimal BFF userId pins, as listOrders does. Three edits instead of one, the agent edge still needs its own fix, and config-ui listKeys would become a follow-up.",
      "Refusing a foreign user_id with PERMISSION_DENIED (D-31). Overridden by the binding operator decision of 2026-10-22, and there is no Floor breach that would justify reopening it.",
      "Adding an effective_user_id field to the ConfigSnapshot/ListKeysResponse protos to fix the mislabel. It is correct but needs a second proto change and an approval gate. The agent can compute the same rule locally from _CALLER at lower rework.",
      "Copying the exportEvents predicate verbatim into queryEvents. Two copies of the same rule would drift (C-18), so a shared helper was chosen instead.",
      "Ledger owner filter keyed on the presence of x-user-id (no proto field). It would hide NULL-owned order.filled history from portfolio GetPnL (portfolio_service.go:534/:751/:796) and the reconciliation rows (trading.go:1930).",
      "Ledger user_id filter on account:<id> streams. It would hide NULL-owned reconciliation.mismatch_found rows from their owner and break AC-3.",
      "Gating on an x-internal-caller header, or on a peer-SAN gate, instead of a typed proto field. The header is an untyped contract that is easy to drop; for the SAN gate there is no evidence the ledger can read SAN identity. Both are kept as fallbacks only.",
      "BFF-only post-filtering. It produces short or empty pages and pulls other users' rows into BFF memory.",
      "Mapping a ListBrokerAccounts error to PERMISSION_DENIED. It misreports a trading outage as 'forbidden'. Passing the original code through still fails closed.",
      "Adding an owned-order branch for order:<id> NULL rows now. YAGNI: there is no current consumer, so it is recorded as an accepted limitation instead.",
      "Caching ListBrokerAccounts per poll. It risks serving a stale ownership set (YAGNI). The extra RPC per poll is accepted."
    ],
    "open_risks": [
      "Rebase conflict with feature 257 on ledgerServiceImpl.ts queryEvents (:124-176), and a possible collision on field number 7 of QueryEventsRequest. Must be recorded now.",
      "Config-side bind collides with feature 241 in configServiceImpl.ts (setConfig). Hunks are not expected to overlap textually.",
      "The agent echo fix touches client.py:2034-2080, the zone feature 247/273 also edits. Record it in merge-order.md.",
      "owner_only defaults to false and fails open for any future user-facing edge that forgets it. Mitigated by the proto comment, the ledger CLAUDE.md invariant and the BFF/e2e tests, but not prevented structurally.",
      "The bind applies to every non-admin caller that sends a header. A future internal reader that forwards a user's x-user-id while asking about another user would be bound silently. Mitigated by a regression test and the config invariant #5 text. The grep found only trading test fakes (config_test.go:193/:201) beyond the agent and UI.",
      "The bind does not fire for callers without x-user-id (agent stdio, claims with an empty user_id) or for WatchConfig's body user_id. Accepted and recorded in the findings entry.",
      "Each account: poll adds one ListBrokerAccounts RPC, doubling BFF→backend fan-out per tick. Accepted with no cache.",
      "The proto field needs the C-09 approval gate. If that stalls, the only fallback is the unverified peer-SAN gate.",
      "streamEvents (:182) and getEvent (:262) stay unscoped. They are unreachable from the trader BFF today; recorded as a follow-up finding only."
    ],
    "constitution_rules_touched": [
      "C-03 (one backendHeaders per request; trading error pass-through keeps x-trace-id; operator no-waiver decision)",
      "C-09 (additive proto field, buf lint/breaking, codegen freshness)",
      "C-10 (same-PR docs: ledger/config/agent CLAUDE.md, mcp-tools.md, product-spec Fix Scope line)",
      "C-11 (design gate; D-31 locus fork settled at config, echo fix adopted)",
      "C-13 (fixture inventory for new e2e ledger fixtures)",
      "C-15 (acceptance.feature amendments owed: AC-4/AC-5 bind, AC-7, AC-8)",
      "C-16 (durable rules preserved: @feature-219, @feature-147, @feature-021; @feature-196 CHANGE under operator sign-off)",
      "C-18 / DRY guard rail (shared ledger owner helper, reuse of scopes._ADMIN and authz helpers)",
      "P-02 (mediated synthesis)",
      "P-03 (no silent gaps: agent mislabel, WatchConfig/stdio gaps, streamEvents/getEvent, order:<id> NULL rows)",
      "PLAT-4/PLAT-5/PLAT-13 (cross-module seams: new ui→trading edge, config read semantics, agent result contract)"
    ],
    "rationale": "Following the relayed request to preserve as much as possible with low rework, round 2 keeps both synthesized designs and closes the round-1 blockers with evidence from the code.\n\nThe config-ui admin view is safe. configUiBff.ts:33 forwards through backendHeaders, which sets the 0x04 admin bit from the admin role. Config tests the same bit. So binding at config, two lines in one place, closes all four edges without regressing @feature-219.\n\nThe adversary's new blocking point holds up against the code, which I checked. client.py:2059 and :2080 echo the requested user_id, and the config responses carry no effective scope. A non-admin's bound result would therefore be labelled with the foreign user. Nothing leaks, but an LLM would misreport whose data it is.\n\nThe lowest-rework fix is local to the agent. The `_CALLER` contextvar (client.py:34-36) already holds (user_id, access_scope), and scopes.py:35 already defines `_ADMIN = 0x04`. So the agent can echo the effective id using the same rule config applies. This needs no proto change and no ctx plumbing, and the existing tests keep passing. A proto effective_user_id field was rejected as more rework. The fix stays blocking until confirmed because the proposal claimed \"agent unchanged\" and did not answer it.\n\nThe adversary's cheap hardening is adopted:\n- a shared ledger owner helper instead of a verbatim copy\n- trading error-code pass-through in place of a mislabelled PERMISSION_DENIED\n- a proto field comment plus a ledger invariant for the fail-open default\n- the order:<id> NULL-row limitation recorded\n\nThese are non-blocking because the remaining work is spec and docs. Business-rule CHANGE kinds:\n- AC-2, AC-4 and AC-5 are covered by the operator's 2026-10-22 decisions.\n- The @feature-196 field-semantics change is covered by that same bind decision but still needs an explicit context.md entry.\n- AC-1 stays EXTEND without explicit operator text.\n\nThere are no Floor breaches."
  },
  "floor_breaches": []
}
```
