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

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: wrote recon.md. Services: xstockstrat-ui, xstockstrat-ledger, xstockstrat-agent and
  xstockstrat-config. Key reuse patterns: the `exportEvents` owner derivation (`ledgerServiceImpl.ts:301-311`) and the
  `setConfig` header bind (`userIdFrom` + `hasAdminAccessScope`).
- Phase 1 Grilling: 2 rounds (full). The operator approved at the design gate (r2), "APPROVED as synthesized,
  including the agent echo fix". This closes the last blocking objection: the echo is kept, not dropped.
- Chosen approach:
  - D-31: a config-side `boundReadUserId` on `getConfig`/`listKeys`. A non-admin's foreign body id is bound to the
    header caller. Admins and header-less callers keep the body id.
  - Agent: `client.py:2059`/`:2080` echo the effective id, using the same rule via `_CALLER` and `scopes._ADMIN`,
    pinned by a test.
  - D-25: the trader BFF uses one `backendHeaders` call per request.
    - `copilot:` keys are rewritten to the caller's own key.
    - An `account:<id>` key is checked with `ListBrokerAccounts`. Unowned or empty → PERMISSION_DENIED; a trading
      error has its code passed through; an owned key is forwarded unfiltered.
    - Any other key forces `ownerOnly`, a new additive field `owner_only = 7`, enforced by a ledger predicate shared
      with `exportEvents`.
- Rejected:
  - an agent-only ctx bind
  - BFF `userId` pins
  - refuse-with-PERMISSION_DENIED (operator override)
  - a proto `effective_user_id` field
  - a ledger filter keyed on whether `x-user-id` is present
  - a `user_id` filter on `account:` streams
  - header or peer-SAN gates
  - BFF post-filtering
  - a `ListBrokerAccounts` cache
- Constitution rules touched: C-03, C-09, C-10, C-11, C-13, C-15, C-16, C-18, P-02, P-03, PLAT-4/PLAT-5/PLAT-13.
  Floor breaches: none.
- **C-16 CHANGE sign-off:** `@AC-9 @FR-5 @regression @feature-196` covers body `user_id` semantics for non-admin
  callers that send a header. A non-admin's foreign `user_id` on GetConfig/ListKeys is now replaced by the caller's
  verified `x-user-id`. Authorised by the operator decision of 2026-10-22 (bind, not refuse; OPERATOR DECISIONS
  above) and the design-gate approval of 2026-10-22.
- Other CHANGE kinds and their decisions:
  - `@AC-2 @feature-263`: covered by the 2026-10-22 decision that NULL-user_id rows are never returned (FR-2).
  - `@AC-4` and `@AC-5 @feature-263`: covered by the 2026-10-22 bind override.
  - `@AC-1 @feature-263` is EXTEND (net-new BFF ownership check).
- Assumption, stated explicitly: a non-admin who picks user X in config-ui `useConfigKeys` is shown their own rows. A
  UI hint for this case is out of scope.
- Ledger: no line added. The echo/label trap and the opt-in proto flag are specific to this feature; the
  "overwrite client ownership fields server-side" pattern is already in `insights.md:602-604`.
- Status: spec-ready → design-approved.

### Open Threads (as of design approval; supersedes the round-2 halt list above)

- [ ] **Overlap with feature 257.** `ledgerServiceImpl.ts` `queryEvents` (:124-176) and a possible collision on
  `QueryEventsRequest` field 7. Record it in 257 context.md and in merge-order.md. Target: the /sdd-spec proto step
  and the merge-order record.
- [ ] **Overlap with feature 241.** `configServiceImpl.ts` (setConfig). Target: the config step and merge-order.md.
- [ ] **Overlap with features 247/273.** `client.py:2034-2080`. Target: the agent step and merge-order.md.
- [ ] **`owner_only` fails open by default.** Covered by the proto comment, the ledger CLAUDE.md invariant and the
  BFF/e2e tests. Target: the proto, ledger and docs steps.
- [ ] **The bind applies to every header-carrying non-admin caller.** Covered by a regression test and config
  invariant #5 text. Target: the config step.
- [ ] **Paths the bind does not cover.** It does not fire for header-less callers (agent stdio, empty-claims paths) or
  for WatchConfig's body `user_id`, and `streamEvents`/`getEvent` remain unscoped. The `order:<id>` NULL-owned
  `order_intent.*` rows are hidden under branch 3. All are covered by a P-03 findings entry. Target: the docs step.
- [ ] **Extra trading RPC on each `account:` poll.** Accepted, no cache. Target: the BFF step (note).
- [ ] **C-09 approval for proto field 7.** The fallback is the unverified peer-SAN gate. Target: the proto step.
- [ ] **AC-7 evidence.** It must come from the SQL-capture test plus the e2e mock, not a live smoke test
  (`usePositionLineage.ts:18` literal). Target: the ledger and BFF test steps.
- [ ] **Owed before spec:** the acceptance.feature AC-4/AC-5 bind amendment, new AC-7 and AC-8, product-spec FR-1/FR-2
  owned-account exception wording, and the Fix Scope "No proto changes anticipated" line. Target: /sdd-spec entry.

## Session 2026-10-22 — sdd-spec

- Generated implementation-spec.md with 12 steps. Status: design-approved → implementation-ready.
- Owed-before-spec items closed at entry:
  - product-spec FR-1 now carries the owned-account unfiltered exception (other non-empty keys fall under
    FR-2).
  - The Fix Scope proto line is corrected to `bool owner_only = 7`.
  - The `account:<id>` ownership Open Question is resolved (per-call `ListBrokerAccounts`, no cache,
    error pass-through).
  - acceptance.feature already carried the AC-4/AC-5 bind amendment and AC-7/AC-8, so it was unchanged.
- Key codebase findings:
  - **Ledger vacuous-green trap applies** (`fails.md:1941-1956`). `LedgerServiceImpl` uses TS parameter
    properties (`ledgerServiceImpl.ts:20-24`), so `pnpm run test:coverage` (`--experimental-strip-types`)
    skips every impl case silently. Step 4 therefore takes its RED/GREEN evidence from
    `pnpm run build && node --test dist/__tests__/ledgerServiceImpl.test.js`. Config's runner already
    compiles first (`tsc && node --test dist`).
  - `QueryEventsRequest` fields 1–6 are in use (`ledger.proto:60-67`), so field 7 is free. Feature 257's
    product spec (main-dev, spec-ready) anticipates no proto change.
  - A trader BFF unit test is feasible with no test-only export: drive `dispatchConnect`
    (`traderBff.ts:153`) with mocked `@/lib/connectClients` and `@/lib/auth`, mirroring
    `src/lib/__tests__/insightsBff.test.ts`. Coverage excludes `src/lib/*Bff.ts` (`vitest.config.ts`).
  - Agent `client.py` can import `_ADMIN` from `app/scopes.py` with no cycle (scopes imports only `os`).
    `GetConfig` returns `ConfigSnapshot` (`config.proto:23`).
  - The e2e mock's `listBrokerAccounts` returns `alpaca-default` / `ibkr-001` (`accounts.ts:75`), so
    `positions-reconciliation.spec.ts` (`account:alpaca-default`) stays owned under the new check.
- **Spec-time deviation from design.md text (recorded per P-03):** design.md asks for the 241 / 247 / 273
  collisions to be recorded in `merge-order.md`. That file's coverage note lists only hard constraints and
  excludes textual overlap, so the spec records only the 257 row there (proto field 7 plus the same
  `queryEvents` WHERE builder). The textual overlaps are recorded here:
  - 241: `configServiceImpl.ts` `setConfig` vs the Step 8 `getConfig`/`listKeys` hunks
  - 247/273: `client.py:2034-2080` vs Step 10
  - 242: `traderBff.ts` and `authz.ts`
  - 248: the same ledger file, in a non-overlapping band
  257's `context.md` is not on this branch, so its side reaches it via merge-order.md and `/sdd-sync`.
- **Confirm at `/sdd-review impl-spec`:** the merge-order direction (257 waits for 263). It is proposed
  because 263 is SEV-2 security and owns field 7, but the operator has not decided it.

### Open Threads (as of implementation-ready; supersedes the design-approval list)

- [ ] C-09 approval for proto field 7 (Step 1). The fallback is the unverified peer-SAN gate, as an
  escalation only.
- [ ] Merge-order direction 257 → 263 (Step 12), to be confirmed at impl-spec review.
- [ ] Rebase hygiene vs 241 / 242 / 247 / 248 / 257 / 273 at integration.
- [ ] AC-7 evidence comes from Step 4 (SQL capture) plus Step 7 (e2e mock) only, never from a dev smoke
  test.

## Session 2026-10-22 — sdd-review impl-spec (advisory)

- Result: 0 failures, 9 warnings; overlap WARN (no FAIL involves 263). Advisory, did not block.
  Lifecycle unchanged (`implementation-ready`).
- Addressed in implementation-spec.md (commit e89dff5b):
  - [x] Step 2 Files now lists the expected ledger stub paths (Go, Python, TS, `gen/ts/dist/`), with a
    stated generated-output exception (B2 Files).
  - [x] Coverage thresholds named: Step 4 (c8 `--lines 40`, ledger `package.json:14`), Step 6 (vitest
    40% over `src/lib/**`, Bff excluded), Step 7 (Playwright, none), Step 9 (c8 `--lines 40`, config
    `package.json:13`) (B2 test-step).
  - [x] Step 4: the strip-types `test:coverage` number does not count as evidence; only the compiled
    `node --test dist/...` run does (fails.md:1941).
  - [x] Step 1 `buf breaking` is copy-runnable: `$(git rev-parse --path-format=absolute --git-common-dir)`,
    against `origin/main-dev` like `ci.yml:125`, with `subdir=` (PLAT-10).
  - [x] Step 12 Files (F-08): adds `services/xstockstrat-ui/CLAUDE.md` (Copilot rail paragraph `:164-170`,
    new item 7) and lists the likely teardown targets (root and per-module constitution/findings files),
    with any touch recorded in the Deviation Log.
  - [x] Step 12 item 6 and the Step Dependencies 257 bullet are now gated on operator confirmation.
  - [x] Overlap correction: feature 242's spec edits no `traderBff.ts` and only reads config
    `authz.ts:135-142` as a copy source (`242-.../implementation-spec.md:183`). The triage-time 242
    overlap claim is dropped from the spec. It supersedes the 242 line in the sdd-spec session above.
  - [x] Step 5 notes an advisory dev smoke check of the `account:` poll latency. This is not acceptance
    evidence.
- Unresolved, carried into execution (C-02 / P-03; announce at each /sdd-execute checkpoint):
  - [ ] **Operator decision: merge-order direction (257 waits for 263).** Step 12 item 6 must not write
    the `merge-order.md` row until it is confirmed. 257 rebases its keyset predicate onto the owner
    condition in the same `queryEvents` WHERE builder (`ledgerServiceImpl.ts:124-176`). 257's
    `context.md` is not on this branch.
  - [ ] Residual SEV-2 gaps, accepted in design and logged in the Step 12 findings row: `owner_only`
    fails open by default; ledger `streamEvents`/`getEvent` are unscoped; `WatchConfig` and `GetSecret`
    are unbound; header-less agent paths are unbound; `order:<id>` NULL-owned rows are hidden by branch 3.
  - [ ] Step 10 hand-mirrors config `boundReadUserId` in `_effective_config_user_id`. Drift risk is
    mitigated by the "must change with it" comment (C-18). Note only.
- Overlap findings (rebase hygiene, textual only): `ledgerServiceImpl.ts` vs 248 (disjoint hunks) and
  257 (same `queryEvents` body); config `authz.ts`/`configServiceImpl.ts` vs 241 (confirm 241's `:513`
  hunk is outside `listKeys` `:525-534`) and 244 (comments only); agent `client.py` vs 247/241/215;
  `tools.py`, `mcp-tools.md` and `test_config_tools.py` vs 241/242/245/246/249/215 (disjoint sections);
  UI `e2e/mock-backend.ts` / `INVENTORY.md` vs 215/240/245/249 (INVENTORY is append-only). Proto field 7,
  migrations and config keys are clean. Peer-only FAIL (not 263): config migration 032 claimed by both
  244 and 248.

## Session 2026-10-22 (operator decision — merge order vs 257)

- **Decided:** 263 merges **first**. `257-fix-ledger-query-pagination` rebases onto 263's ledger `QueryEvents` owner filter, builds its page token on top of it, and takes the next free `QueryEventsRequest` field number (no field-7 collision). This resolves the impl-spec Open Thread "merge-order direction (257 waits for 263)". Step 12 item 6 may now write the `merge-order.md` row `263 → 257`.

## Session 2026-10-28 — sdd-execute re-spec (sdd-batch-execute)

- Branch setup (§5.3): `git merge -X ours origin/main-dev` into a detached checkout of
  `origin/feature/fix-edge-owner-scope` (merge commit `e664e030`, pushed).
- Re-spec of Steps 2, 5, 6, 7, 8, 9, 10, 11 and 12 (Instructions / Codebase Evidence / Files /
  Verification only). No step's scope, order or acceptance mapping changed.
  - Step 2: `scripts/buf-gen.sh` needs `grpcio-tools` (`python3 -m grpc_tools.protoc`), which is not on
    the host. Added an install-if-missing instruction (PyPI is reachable). Not a blocker.
  - Steps 5–11: line drift only (`dispatchConnect` `traderBff.ts:151`; mock default branch `:449-469`;
    config `requestUserId` `:78`, invariant text `:40`; agent `client.py` `:2035/:2060/:2065/:2081`,
    `tools.py` `:1601-1605/:1629-1633`; `TestSetConfigRequestParity` `:261`).
  - Step 12: line drift (findings `:29`/`:46`, mcp-tools `:1052/:1059/:1077/:1085`). Item 6 is now
    **verify-only**: the "257 waits for 263" row is already at `merge-order.md:78` (via main-dev), so no
    duplicate is added. The 257 directory now exists on this branch (`implementation-ready`), and its
    spec already rebases onto `owner_only = 7`. This resolves the Open Thread on merge-order direction.
- Hook note: `core.hooksPath` points at `/home/user/xstockstrat/.husky/_`, which does not exist, and the
  main worktree has no `node_modules` to symlink, so the husky pre-commit hook cannot run on this host.
  No `--no-verify` was used.

## Session 2026-10-28 — sdd-execute sequential (sdd-batch-execute)

- Status `implementation-ready` → `in-progress`.
- Up-front confirmation: the operator approved the up-front plan by standing authorization (operator
  chat 2026-10-28, session_01NpS3HShZK6pSnogA7CFo2f: "Start executing features 241-276" via
  batch-execute; then "start batch 2 in parallel too"). Answers recorded:
  - checkpoints are unattended and set to "report"
  - C-16 promotion is auto-confirmed unless it changes an existing @AC rule
  - merge-train is authorized; 255 and 275 are deferred
  - operator-only DB/prod steps: open the PR and hold the merge
- Execution mode: one commit per step on `feature/fix-edge-owner-scope`, detached worktree, pushed
  after each commit; a step's commit is made only after its verification passes.

### Step 1 — proto: add `owner_only` to `QueryEventsRequest` (2026-10-28)

- Added `bool owner_only = 7;` to `QueryEventsRequest` (`packages/proto/ledger/v1/ledger.proto:69`) with the
  spec's 2-line constraint comment. TDD: N/A (proto contract; behaviour is tested in Steps 4/6/7).
- Verification: `buf lint` passed; `buf breaking --against "<git-common-dir>#branch=origin/main-dev,subdir=packages/proto"`
  passed (additive field); `grep -n "owner_only = 7"` returns one line.
- Stubs are not regenerated in this commit, so the `proto-freshness` gate stays red until Step 2. This is expected.
- The C-09 proto approval gate (Proto Reviewer plus the ledger and ui owners) is still open. It goes in the integration PR description.
- Hook: `node_modules` is symlinked from the main worktree. `core.hooksPath` points at
  `/home/user/xstockstrat/.husky/_`, which does not exist (`.husky/` holds only `pre-commit`), so the husky
  pre-commit hook does not run. No `--no-verify` was used.

### Step 2 — proto-gen: regenerate stubs (2026-10-28)

- Ran `./scripts/buf-gen.sh` host-native (buf 1.72.0, grpcio-tools 1.80.0, Node 24.20.0 TS plugins;
  `pnpm install --frozen-lockfile --filter @xstockstrat/proto` for `tsc`). TDD: N/A (generated code).
- Pin drift found: the `~/go/bin` Go plugins are at the CI versions but were built with go1.24.7, and
  their gofmt pass re-indented comments in `gen/go/analysis/v1/analysis.pb.go`. Reverted that file and
  rebuilt the three plugins with go1.27.0 (CI `setup-go`) into a session-local `GOBIN`; the re-run touched
  ledger files only (DEV-1). Future codegen on this host must use go1.27-built plugins or it will
  produce the same non-ledger diff.
- Verification: changed files are `ledger.pb.go`, `ledger_pb2.py`, `ledger.ts`, `ledger_pb.ts` and the
  four `dist/ledger/v1/ledger{,_pb}.{js,d.ts}`; `buf lint` and `buf breaking` (against local `main-dev`)
  passed inside the script; a second run left `git diff --stat packages/proto/gen/` identical (fresh).
- Hook: `core.hooksPath` still points at the missing `/home/user/xstockstrat/.husky/_`, and the main
  worktree has no `node_modules` to symlink, so the pre-commit hook does not run. No `--no-verify`.

### Step 3 — service: ledger shared caller-owner helper + opt-in `queryEvents` owner predicate (2026-10-28)

- Added exported `callerUserId(call)` beside `toValidDate` (carries the empty-caller/NULL-row constraint
  comment); `exportEvents` now uses it (no behaviour change); `queryEvents` appends
  `user_id = $n` bound to the caller only when `req.ownerOnly` — flag absent leaves SQL/params unchanged.
  `streamEvents`/`getEvent` untouched.
- Tooling setup (step 3): node ✓ 24.20.0 · pnpm ✓ 9.15.9 · workspace deps ⬇ `pnpm install --frozen-lockfile`.
- TDD (AC-2/AC-7, scratch test vs `dist/`, DEV-2): red — 4/5 fail (`callerUserId` undefined; params
  `[101]` lacked `''`/`'u-a'`; SQL lacked `AND user_id = $2`), baseline flag-absent case passed →
  green — 5/5 pass. Existing `ledgerServiceImpl.test.ts` re-run against `dist/`: 29/29 pass
  (exportEvents cases guard the helper extraction).
- Verification: `pnpm run build` ok; `test:coverage` ok (in-repo run is vacuous for the impl, fails.md
  feature 021); `lint` 0 errors; `grep callerUserId` → definition + one use each in `queryEvents` and
  `exportEvents`.
- Open for Step 4: `dist/__tests__/` is not emitted by `tsconfig.json`, so its verification command
  needs adjusting (DEV-2).
- Hook: ran via `git -c core.hooksPath=.husky/_` (worktree-local husky dir); shared config still points
  at the missing main-worktree path. No `--no-verify`.

## Session 2026-10-29 (sdd-execute sequential (sdd-batch-execute) — re-spec)

- Up-front confirmation: operator standing authorization (operator chat 2026-10-28/29,
  session_01NpS3HShZK6pSnogA7CFo2f): "Start executing features 241-276" via batch-execute; unattended
  checkpoints ("report"), C-16 promotion auto-confirmed unless it changes an existing @AC rule,
  merge-train authorized, 255/275 deferred; operator-only DB/prod steps: open PR, hold merge; blocker
  decisions 2026-10-29 recorded per feature. Status already `in-progress` (no transition).
- Branch setup: `git merge -X ours origin/main-dev` (brought in 241 and 252) — merge commit `cbf94534`.
- Re-spec (line drift only, every Files path unchanged):
  - Step 7: mock `queryEvents` `:394-471`, default `order.filled` return `:450-470`; INVENTORY policy cite
    is `:73` (not `:22-23`); noted the unrelated second `listBrokerAccounts` at `mock-backend.ts:1354` and
    that no existing spec depends on the default AAPL `mock-order-001` row.
  - Step 8: UI `ADMIN_SCOPE` at `auth.ts:79`; after the 241 merge config `listKeys` moved to `:527`
    (`requestUserId` `:529`, SQL `:536`); `setConfig` header read at `:376`.
  - Step 10: `_Caller`/`_CALLER` at `client.py:35-38`.
  - Step 12: findings evidence now `ledgerServiceImpl.ts:186` / `:266` (post Step 3), `client.py:35-38`,
    `trading.go:2246` / `:2277`.

### Step 4 — test: ledger owner-predicate SQL capture (2026-10-29)

- Added `captureQuery` (inline single-consumer capturing pool, C-13) beside `makeImpl`, and four
  `describe('queryEvents')` cases reusing `makeStreamCall` for `x-user-id` (no re-declaration): (a)
  `ownerOnly` + `u-a` → `WHERE user_id = $1 … LIMIT $2`, params `['u-a', 101]`; (b) `ownerOnly` with no
  caller binds `''`; (c) flag absent is byte-identical to the pre-change `stream_key = $1 AND
  event_type = $2 … LIMIT $3` with no `user_id`; (d) `ownerOnly` + `eventType` → `event_type = $1 AND
  user_id = $2 … LIMIT $3`.
- Tooling setup (step 4): node ✓ 24.20.0 · pnpm ✓ 9.15.9 · workspace deps ⬇ `pnpm install --frozen-lockfile
  --filter xstockstrat-ledger...`; husky hooks installed with `pnpm exec husky` (worktree `.husky/_`).
- TDD (AC-2/AC-7): red — against the pre-Step-3 impl (`5d81b32e`, restored temporarily, DEV-3) cases
  a/b/d failed (`SELECT * FROM ledger.events  ORDER BY recorded_at ASC LIMIT $1` lacked `WHERE user_id = $1`;
  `event_type = $1` lacked `AND user_id = $2`), case c passed as the baseline pin → green — 34/34 pass on
  the compiled `node --test dist/__tests__/ledgerServiceImpl.test.js`.
- Verification: `pnpm run build` ok; `test:coverage` 51/51 pass, 74.52% lines (≥40%), non-vacuous since
  feature 252; `lint` 0 errors (warnings only); one `makeStreamCall` declaration.
- Prettier: the pre-existing file is not prettier-clean; only the added hunks were formatted, the rest
  left untouched (surgical diff).

### Step 5 — service: trader BFF `queryEvents` three-branch owner scoping [done] (2026-10-29)

- `queryEvents` builds `backendHeaders(claims, ctx)` once and takes the first matching branch: `copilot:`
  → rewritten to `copilotStreamKey(user)`, `ownerOnly: false`; `account:<id>` → empty id or an id not in
  trading `listBrokerAccounts` (same headers, errors uncaught) is `PERMISSION_DENIED`, an owned id forwards
  unchanged with `ownerOnly: false`; anything else (incl. no key) → `ownerOnly: true`. Added the
  `ConnectError`/`Code` import and module-local `ACCOUNT_STREAM_PREFIX`; handler comment replaced (2 lines).
- Files modified: `services/xstockstrat-ui/src/lib/traderBff.ts`
- Tooling setup (step 5): node ✓ 24.20.0 · pnpm ✓ 9.15.9 · workspace deps ⬇ `pnpm install --frozen-lockfile
  --filter xstockstrat-ui... --filter .` (worktree-local `node_modules`, husky installed by `prepare`).
- TDD (AC-1/AC-2/AC-7, uncommitted Step 6 draft test, DEV-4): red — 7/9 fail (`expected undefined to be
  'permission_denied'` for foreign/empty `account:`; `expected undefined to be 'unavailable'`; `ownerOnly`
  `expected false to be true` for no key / `portfolio:u-b` / browser override; C-03 no trading call), AC-3
  account + copilot passed as baselines → green — 9/9 pass.
- Verification: `grep backendHeaders(claims, ctx)` → one call in `queryEvents` (`:123`), shared by
  `listBrokerAccounts` and both `queryEvents` calls; `pnpm run lint` 0 errors (pre-existing warnings only);
  `tsc --noEmit` only the pre-existing `e2e/insights/backfills.spec.ts:135-136` errors (identical without
  this change, DEV-4); `test:unit` 48 files / 247 tests pass.
- Deviations: DEV-4 (RED/GREEN via uncommitted draft of the Step 6 test; pre-existing `tsc` error noted).

### Step 6 — test: trader BFF `queryEvents` unit test (vitest) [done] (2026-10-29)

- Created `src/lib/__tests__/traderBff.test.ts`: 9 cases driven through the real `dispatchConnect`
  (`/trader/api/xstockstrat.ledger.v1.LedgerService/QueryEvents`, JSON body + `access_token` cookie), with
  `@/lib/auth` mocked (`u-a`, `['trader']`, fixed `generateTraceId`) and `@/lib/connectClients` mocked
  (`listBrokerAccounts`/`queryEvents` `vi.fn`s, other clients `{}`). Covers AC-1 (foreign + empty `account:`
  id), trading `Unavailable` pass-through, AC-3 (owned account, copilot via `copilotStreamKey('u-a')`),
  AC-2/AC-7 (no key, `portfolio:u-b`), browser `ownerOnly:false` override, and C-03 (same `HEADER_USER_ID` /
  `HEADER_TRACE_ID` on trading + ledger calls). C-12: inputs are scenario one-offs, kept inline.
- Files modified: `services/xstockstrat-ui/src/lib/__tests__/traderBff.test.ts`
- Tooling setup (step 6): node ✓ 24.20.0 · pnpm ✓ 9.15.9 · workspace deps ⬇ `pnpm install --frozen-lockfile
  --filter xstockstrat-ui... --filter .` (worktree-local `node_modules`, husky installed by `prepare`).
- TDD (AC-1/AC-2/AC-7, DEV-5): red — against the pre-Step-5 `traderBff.ts` (`54ef1a73~1`, restored
  temporarily) 7/9 fail (`expected 200 to be greater than or equal to 400` foreign `account:`; `expected
  undefined to be 'permission_denied'` empty id; `expected undefined to be 'unavailable'`; `ownerOnly`
  `expected false to be true` for no key / `portfolio:u-b` / override; C-03 no trading call), AC-3 account +
  copilot pass as baselines → green — 9/9 pass on the committed Step 5 code.
- Verification: `vitest run src/lib/__tests__/traderBff.test.ts` 9/9; `test:coverage` 48 files / 247 tests
  pass, `src/lib/**` 73.36% lines (≥40%, `*Bff.ts` excluded so unchanged); `lint` exit 0 (pre-existing
  warnings only, none in the new file); prettier clean; `tsc --noEmit` only the pre-existing
  `e2e/insights/backfills.spec.ts:135-136` errors (DEV-4).
- Deviations: DEV-5 (RED via temporary restore of the pre-Step-5 handler, since Step 5 landed first).


### Step 7 — test: trader BFF owner scoping end to end (e2e mock + fixtures + spec) [done] (2026-10-29)

- Fixtures (`e2e/fixtures/ledgerEvents.ts`): added `OWNER_SCOPE_ORDER_FILLED_EVENTS`. It has three
  `order.filled` `LedgerExportFixtureRow`s: the own `TEST_USER_ID` MSFT row, a foreign
  `OWNER_SCOPE_FOREIGN_USER_ID` (= `TEST_USER_B_ID`) AAPL row, and a NULL-owned TSLA row on
  `account:acct-legacy`. Also added `OWNER_SCOPE_FOREIGN_ACCOUNT_ID` (`acct-b`), the own and legacy
  symbols, and the own and foreign copilot note texts.
- `INVENTORY.md`: added a catalog row for these fixtures. The "Not yet centralized" ledger row no longer
  lists the `order.filled` branch.
- Mock (`e2e/mock-backend.ts`): the default `order.filled` branch now maps the fixture. It keeps only
  `TEST_USER_ID` rows when `req.ownerOnly`, and no longer filters on `sourceService`. The
  `copilotThreads` store is seeded with a foreign note under
  `copilotStreamKey(OWNER_SCOPE_FOREIGN_USER_ID)`. The `account:` and copilot branches are unchanged.
- Spec (`e2e/trader/ledger-owner-scope.spec.ts`): 4 tests use the api-smoke browser-`fetch` pattern
  with `addAuthCookie`:
  - AC-1: a foreign `account:` returns non-200 with `permission_denied`
  - AC-2/AC-7: no foreign, NULL-owned or TSLA rows come back, and the own MSFT row does
  - AC-3: an owned `account:alpaca-default` returns the reconciliation event
  - AC-3 copilot: `AppendEvent`, then `QueryEvents` with the foreign copilot key, resolves to the
    caller's thread; the appended note is present and the foreign note is absent
- Files modified: `services/xstockstrat-ui/e2e/fixtures/ledgerEvents.ts`,
  `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`, `services/xstockstrat-ui/e2e/mock-backend.ts`,
  `services/xstockstrat-ui/e2e/trader/ledger-owner-scope.spec.ts`
- Tooling setup (step 7):
  - node ✓ 24.20.0 · pnpm ✓ 9.15.9
  - workspace deps ⬇ `pnpm install --frozen-lockfile --filter xstockstrat-ui... --filter .`
    (worktree-local)
  - Chromium pre-provisioned at `/opt/pw-browsers` (no `playwright install`)
- TDD (AC-1/AC-2/AC-7, DEV-6):
  - Red, against the pre-Step-5 `traderBff.ts` (`54ef1a73~1`, restored temporarily): 2/4 fail.
    - AC-1: `expect(result.status).not.toBe(200)` got 200.
    - AC-2: `events.some(userId === OWNER_SCOPE_FOREIGN_USER_ID)` expected false, got true.
    - Both AC-3 cases pass as baselines.
  - Green: 4/4 pass.
- Verification:
  - `playwright test ledger-owner-scope + positions-reconciliation + api-smoke` (`--project=chromium
    --no-deps --timeout=120000`): 14/14 pass.
  - Extra regression check: `copilot.spec.ts` + `trader/positions.spec.ts` 9/9 pass.
  - The import grep shows `../helpers/auth`, `../fixtures` and `../fixtures/ledgerEvents`, and
    `INVENTORY.md` lists `OWNER_SCOPE_ORDER_FILLED_EVENTS`.
  - `pnpm run lint` exits 0.
  - `tsc --noEmit` reports only the pre-existing `e2e/insights/backfills.spec.ts:135-136` errors (DEV-4).
- Deviations: DEV-6:
  - RED came from a temporary restore of the pre-Step-5 handler.
  - `u-b` is the canonical `TEST_USER_B_ID`.
  - The copilot foreign seed lives in the mock store, and the spec asserts "present", not "exactly one".
  - The harness ran with `--no-deps`.
  - `lint-staged` reformats the existing `CLOSED_POSITION_ROWS` rows (whitespace only).
- Correction (2026-10-29, after commit `1ad6b0bd`): the `lint-staged` pass did **not** reformat the
  `CLOSED_POSITION_ROWS` rows. A standalone `prettier --check` flags them, but that is pre-existing, and
  the step diff contains only the added lines. DEV-6 has been amended to match.

### Step 8 — service: config `boundReadUserId` on `GetConfig` / `ListKeys` (2026-10-29)

- Files: `services/xstockstrat-config/src/grpc/authz.ts` (new exported `boundReadUserId` after
  `userIdFrom`), `services/xstockstrat-config/src/grpc/configServiceImpl.ts` (import + the `getConfig`
  and `listKeys` call sites). `watchConfig`, `getSecret`, `setConfig` and `resolveOverlayValues` are
  unchanged, and still call `requestUserId` directly.
- Tooling setup (step 8): node ✓ 24.20.0 · pnpm ✓ 9.15.9 · workspace deps ⬇
  `pnpm install --frozen-lockfile --filter xstockstrat-config... --filter .` (worktree-local).
- TDD (DEV-7): a draft of the Step 9 test, kept out of the commit.
  - Red, on the pre-Step-8 tree: 2/5 fail. AC-4 `getConfig` and AC-5 `listKeys` bind `'u-b'` where
    `'u-a'` is expected.
  - Green: 5/5.
- Verification:
  - `pnpm run test:coverage`: 182/182 pass, 86.71% lines (threshold 40).
  - `pnpm run lint`: 0 errors.
  - The spec grep finds one definition and two call sites (`getConfig:318`, `listKeys:530`).
- Bind-not-refuse (operator decision of 2026-10-22): a non-admin's foreign body id is rebound to the
  header caller, with no error. Admin callers, header-less callers and an empty body id are passed through.

## Session 2026-10-29 (sdd-execute sequential (sdd-batch-execute) — re-spec, second merge)

- Up-front confirmation: operator standing authorization (operator chat 2026-10-28/29,
  session_01NpS3HShZK6pSnogA7CFo2f): "Start executing features 241-276" via batch-execute; unattended
  checkpoints ("report"), C-16 promotion auto-confirmed unless it changes an existing @AC rule,
  merge-train authorized, 255/275 deferred; operator-only DB/prod steps: open PR, hold merge; blocker
  decisions 2026-10-29 recorded per feature. Status already `in-progress` (no transition).
- Branch setup: plain `git merge --no-edit origin/main-dev` (no conflicts) — merge commit `1ae2437b`;
  `ledger-guard --own-slug fix-edge-owner-scope --base origin/main-dev --fix` reported clean.
- Re-spec (line drift only, every Files path unchanged):
  - Step 9: `md(pairs)` builder at `setConfigAuthz.test.ts:43`.
  - Step 10: `_Caller`/`_CALLER` at `client.py:39-42`; `get_config` `:2040` echo `:2065`;
    `list_config_keys` `:2070` echo `:2086`; docstring `user_id` lines `tools.py:1603-1604`/`:1631-1632`.
  - Step 11: `TestSetConfigRequestParity` at `test_config_tools.py:255` (patches `:277-278`);
    `set_caller` `client.py:45`, `reset_caller` `:53`; conftest ADMIN/TRADER `:14-15`; conftest import
    already at `test_config_tools.py:22`.
  - Step 12: agent CLAUDE.md scope-selector text `:29-30`; findings `## Open questions` `:45`;
    `watchConfig` `requestUserId` `configServiceImpl.ts:284`; accepted-gap cite `client.py:39-42`.

### Step 9 — test: config read-binding matrix (2026-10-29)

- Files: `services/xstockstrat-config/src/__tests__/readUserBinding.test.ts` (create) — a `boundReadUserId`
  unit matrix (6 cases, inline `md()` builder) plus 8 cases over the real-server harness copied from
  `scopeResolution.test.ts`, with a pool that captures the `getConfig` overlay params and the `listKeys`
  `DISTINCT ON (key)` params and returns per-user rows keyed by `params[2]` (`u-a` 450 + one secret row,
  `u-b` 900).
- Tooling setup (step 9): node ✓ 24.20.0 · pnpm ✓ 9.15.9 · workspace deps ⬇
  `pnpm install --frozen-lockfile --filter xstockstrat-config... --filter .` (worktree-local).
- TDD (DEV-8): AC-4 red: overlay param `'u-b'` where `'u-a'` expected (also AC-5, the bound-overlay secret
  case and the regression pin) against the pre-Step-8 call sites → green: 14/14.
- Verification:
  - `pnpm run test:coverage`: 196/196 pass, 86.94% lines (threshold 40); `scopeResolution`, `listKeys*`,
    `secretsAndScope` and `perUserSecrets` still green.
  - `pnpm run lint`: 0 errors.
  - `grep "__tests__/fixtures"` → none: `md()` stays an inline single-file helper (C-13 verdict in the spec).

### Step 10 — service: agent echoes the effective `user_id`; docstrings state the bind (2026-10-29)

- Files: `services/xstockstrat-agent/app/client.py` — imports `_ADMIN` from `app.scopes`; new private
  `_effective_config_user_id(user_id)` (mirrors config `boundReadUserId`: a non-admin bound caller's foreign
  non-empty id echoes as the caller's id); `get_config` / `list_config_keys` echo it. The request `user_id`
  and `_metadata()` sent to config are unchanged. `services/xstockstrat-agent/app/tools.py` — both tools'
  `user_id:` docstring lines state the bind (two lines each).
- Discovery: Step 8's `boundReadUserId` is at `authz.ts:33` (the discovery digest's "not implemented" was stale).
- Tooling setup (step 10): `uv sync --extra dev` (worktree-local, from `uv.lock`).
- TDD (DEV-9): AC-4/AC-5 red: echo `'u-b'` where `'u-2'` expected (uncommitted Step 11 draft) → green: 10/10.
- Verification: `uv run pytest --cov=app --cov-fail-under=40` 530 passed, 81.20%; `ruff check .` clean;
  `ruff format --check .` clean; `grep _effective_config_user_id app/client.py` → 1 definition + 2 uses.

### Step 11 — test: agent effective `user_id` echo (2026-10-29)

- Files: `services/xstockstrat-agent/tests/test_config_tools.py` — new `TestConfigReadEchoesEffectiveUserId`
  (stub-capture harness mirrored from `TestSetConfigRequestParity`; `GetConfig`→`ConfigSnapshot`,
  `ListKeys`→`ListKeysResponse`), parametrized over `get_config`/`list_config_keys` × non-admin foreign (AC-4/AC-5),
  own (AC-6), admin foreign (AC-8), no caller bound, empty id; each asserts the echo and that the wire `user_id`
  is unchanged. Reuses `TRADER`/`ADMIN` from `tests.conftest` (C-13).
- TDD (DEV-10): red 2/10 against the pre-Step-10 client (`cff6d631~1`; echo `'u-b'`, expected `'u-2'`) → green 10/10.
- Verification: `pytest tests/test_config_tools.py` 42 passed; `pytest --cov=app --cov-fail-under=40` 540 passed,
  82.07%; `ruff check .` clean; `ruff format --check .` clean; conftest import grep → `:22`.

### Step 12 — docs: same-PR contract docs, findings, merge order (2026-10-29)

- Files:
  - `services/xstockstrat-ledger/CLAUDE.md`: Critical Invariant #5 (`QueryEvents.owner_only`: scoped to
    `x-user-id`, NULL rows excluded, edges MUST set it, fails open by default); Stream Key rows
    `account:{account_id}` (trading, reconciliation rows NULL-owned) and `copilot:{user_id}:default` (UI BFF).
  - `services/xstockstrat-config/CLAUDE.md`: invariant #5 gains the bound-read paragraph (`boundReadUserId` on
    `GetConfig`/`ListKeys`; admins and header-less callers keep the body id; `WatchConfig`/`GetSecret` unbound;
    internal readers must not forward a user's `x-user-id` while asking about another user).
  - `services/xstockstrat-agent/CLAUDE.md`: body-`user_id` sentence and the `get_config`/`list_config_keys`
    rows say "bound to the caller for non-admins", echo = scope read.
  - `docs/runbooks/mcp-tools.md`: both `user_id` rows and Returns lines, same semantics; tool count, names and
    parameters unchanged.
  - `docs/context-constitution-findings.md`: one `## Latent bugs` row for the gaps 263 accepts (P-03).
  - `services/xstockstrat-ui/CLAUDE.md`: Copilot rail paragraph — `account:` keys are checked via trading
    `ListBrokerAccounts`, every other key gets `owner_only` server-side.
  - `docs/roadmap/features/merge-order.md`: verified only — one `fix-edge-owner-scope` row (`:78`).
- TDD: N/A (docs). Baseline: verification greps 1, 2, 4, 6 returned nothing → after: all six return lines.
- Teardown: context-constitution refresh skill unavailable; manual reconciliation found no drift (DEV-11).
  Open item for the integration PR body: state the plugin was unavailable and the manual reconciliation done.

## Session 2026-10-29 (sdd-batch-execute promotion plan (awaiting operator confirm))

C-16 promotion plan for launch, produced by sdd-batch-execute. Nothing is written to a durable suite until
the operator confirms.

```sdd-batch-promotion-plan
## Promotion plan — fix-edge-owner-scope (feature 263)

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| AC-1 | /home/user/xstockstrat/services/xstockstrat-ui/acceptance/fix-edge-owner-scope.feature | CREATE | NEW | trader BFF QueryEvents foreign stream |
| AC-2 | same ui file | CREATE | NEW | no stream_key leaks no foreign or NULL-owner events |
| AC-3 | same ui file | CREATE | NEW | own account and copilot streams still work |
| AC-7 | same ui file | CREATE | NEW | own position lineage with no stream_key |
| AC-4 | /home/user/xstockstrat/services/xstockstrat-config/acceptance/fix-edge-owner-scope.feature | CREATE | NEW | non-admin get_config bound to caller |
| AC-5 | same config file | CREATE | NEW | non-admin list_config_keys bound to caller |
| AC-6 | same config file | CREATE | NEW | own per-user overlay still readable |
| AC-8 | same config file | CREATE | NEW | admin override preserved |

### Ready-to-write blocks

--- /home/user/xstockstrat/services/xstockstrat-ui/acceptance/fix-edge-owner-scope.feature (CREATE) ---
# Promoted from docs/roadmap/features/263-fix-edge-owner-scope/acceptance.feature on launch
# (C-16). Scenarios are verbatim; each carries its source `@AC-*` and a `@feature-263` tag.
# Durable business rule xstockstrat-ui guarantees: the trader BFF LedgerService.QueryEvents never returns
# another user's (or an unowned) event, while a trader still reads their own streams. A rule enters only by promotion.
Feature: fix-edge-owner-scope (bug fix)
  Regression guard for docs/reports/2026-10-21-edge-owner-scope-defect.md:
  trader BFF ledger queryEvents and agent get_config / list_config_keys read other users' data (debt-radar D-25, D-31).

  Background:
    Given user "u-a" owns broker account "acct-a" and user "u-b" owns broker account "acct-b"
    And the ledger holds an "order.filled" event on stream "account:acct-b" for user "u-b" symbol "AAPL"
    And the ledger holds an "order.filled" event on stream "account:acct-legacy" with a NULL user_id symbol "TSLA"

  @AC-1 @FR-1 @regression @feature-263
  Scenario: A trader cannot read another user's account stream through the trader BFF
    Given user "u-a" is signed in to /trader
    When "u-a" calls trader BFF LedgerService.QueryEvents with stream_key "account:acct-b"
    Then the call fails with PERMISSION_DENIED
    And no event from stream "account:acct-b" is returned

  @AC-2 @FR-2 @regression @feature-263
  Scenario: A trader BFF query with no stream key returns no other user's events
    Given user "u-a" is signed in to /trader
    When "u-a" calls trader BFF LedgerService.QueryEvents with event_type "order.filled" and no stream_key
    Then the response contains no event belonging to user "u-b"
    And the response contains no event whose user_id is NULL
    And the "order.filled" event on "account:acct-legacy" symbol "TSLA" is not returned

  @AC-3 @FR-1 @FR-5 @regression @feature-263
  Scenario: A trader still reads their own account and copilot streams
    Given user "u-a" is signed in to /trader
    And the ledger holds a "reconciliation.tick" event on stream "account:acct-a"
    And the ledger holds a "copilot.message" event "note-a" on stream "copilot:u-a:default" for user "u-a"
    And the ledger holds a "copilot.message" event "note-b" on stream "copilot:u-b:default" for user "u-b"
    When "u-a" calls trader BFF LedgerService.QueryEvents with stream_key "account:acct-a"
    Then the "reconciliation.tick" event on "account:acct-a" is returned
    And a QueryEvents with stream_key "copilot:anything" returns exactly the "note-a" event
    And the "note-b" event is not returned

  @AC-7 @FR-2 @FR-5 @regression @feature-263
  Scenario: A trader still reads their own position lineage with no stream key
    Given user "u-a" is signed in to /trader
    And the ledger holds an "order.filled" event on stream "account:acct-a" for user "u-a" symbol "MSFT"
    When "u-a" calls trader BFF LedgerService.QueryEvents with event_type "order.filled" and no stream_key
    Then the "order.filled" event for user "u-a" symbol "MSFT" is returned

--- /home/user/xstockstrat/services/xstockstrat-config/acceptance/fix-edge-owner-scope.feature (CREATE) ---
# Promoted from docs/roadmap/features/263-fix-edge-owner-scope/acceptance.feature on launch
# (C-16). Scenarios are verbatim; each carries its source `@AC-*` and a `@feature-263` tag.
# Durable business rule xstockstrat-config guarantees: GetConfig/ListKeys bind a non-admin caller's per-user
# scope to the verified caller (admin may read any user). A rule enters only by promotion.
Feature: fix-edge-owner-scope (bug fix)
  Regression guard for docs/reports/2026-10-21-edge-owner-scope-defect.md:
  trader BFF ledger queryEvents and agent get_config / list_config_keys read other users' data (debt-radar D-25, D-31).

  @AC-4 @FR-3 @regression @feature-263
  Scenario: A non-admin MCP get_config with a foreign user_id is bound to the caller
    Given user "u-b" has a per-user config row "analysis.backtest.max_duration_seconds" = 900 in the agent's environment scope
    And user "u-a" has a per-user config row "analysis.backtest.max_duration_seconds" = 450 in the agent's environment scope
    And non-admin user "u-a" is the verified MCP caller
    When "u-a" calls get_config with namespace "analysis" and user_id "u-b"
    Then the returned "analysis.backtest.max_duration_seconds" value is 450
    And the value 900 is not returned

  @AC-5 @FR-4 @regression @feature-263
  Scenario: A non-admin MCP list_config_keys with a foreign user_id is bound to the caller
    Given user "u-b" has a per-user config row "analysis.backtest.max_duration_seconds" = 900 in the agent's environment scope
    And user "u-a" has no per-user config rows in namespace "analysis"
    And non-admin user "u-a" is the verified MCP caller
    When "u-a" calls list_config_keys with namespace "analysis" and user_id "u-b"
    Then "analysis.backtest.max_duration_seconds" is not reported as a per-user override
    And no key overridden by "u-b" is revealed

  @AC-6 @FR-5 @regression @feature-263
  Scenario: An MCP caller still reads their own per-user config overlay
    Given user "u-a" has a per-user override "analysis.backtest.max_duration_seconds" = 450
    And non-admin user "u-a" is the verified MCP caller
    When "u-a" calls get_config with namespace "analysis" and user_id "u-a"
    Then the returned "analysis.backtest.max_duration_seconds" value is 450

  @AC-8 @FR-6 @regression @feature-263
  Scenario: An admin MCP caller can still read another user's per-user config overlay
    Given user "u-b" has a per-user config row "analysis.backtest.max_duration_seconds" = 900 in the agent's environment scope
    And admin user "u-admin" is the verified MCP caller
    When "u-admin" calls get_config with namespace "analysis" and user_id "u-b"
    Then the returned "analysis.backtest.max_duration_seconds" value is 900

### Notes / ambiguities / conflicts
- Attribution: AC-1/2/3/7 assert on the trader BFF response, so they go to xstockstrat-ui. AC-4/5/6/8 are phrased via MCP tools, but the fix and the Then outcome live in config (design.md D-31: boundReadUserId in config authz.ts, applied at getConfig and listKeys). They are routed to xstockstrat-config rather than xstockstrat-agent. The agent echo fix is secondary. If the owner prefers an agent copy, that would be a second target. I did not duplicate.
- The Background block is included only in the ui file, where all four scenarios use it. The config scenarios don't reference it, so it was dropped from that file. Scenario text is verbatim.
- Possible tension, not a conflict: /home/user/xstockstrat/services/xstockstrat-config/acceptance/config-ui-usability.feature:11-14 and :27-28 call ListKeys with user_id "u-123" without naming the caller. Feature 263 binds non-admin callers to their own x-user-id. Those scenarios stay valid if the caller is u-123 or an admin. A human may want to confirm the caller identity assumption. No standing @AC-* is contradicted.
- No OVERLAP: grep of every ui/config/agent/ledger suite and docs/sdd/business-rules/platform.feature found no existing QueryEvents-owner or get_config/list_config_keys user_id-binding rule. fix-config-audit-author-spoof (@feature-?, SetConfig author/x-user-id) covers writes only. config-secrets-and-scoping covers the overlay and WatchConfig, not caller binding.
- The ledger suite is not a target: the ledger fix is an owner_only predicate, but no 263 scenario asserts ledger-level behavior.

### Coverage check
- Source scenarios: 8 (AC-1..AC-8). Planned: 8 NEW, 0 DUP, 0 OVERLAP, 0 CONFLICT. All accounted for, none skipped.
```
