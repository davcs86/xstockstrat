# Design: fix-edge-owner-scope

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved — operator approval at the design gate, Floor clear)
**Approved by**: operator @ 2026-10-22 (design gate r2, "APPROVED as synthesized, including the agent echo fix")
**Grounded in**: recon.md

---

## Chosen Approach

Two independent fixes ship in one feature: D-25 (trader BFF to ledger `QueryEvents`) and D-31 (config reads that
trust the body `user_id`). Both reach their consumer surfaces directly:

- D-25 reaches the trader segment's copilot rail, position lineage and reconciliation status hooks
  (recon.md:40-44).
- D-31 reaches the agent tools `get_config` / `list_config_keys`, and the trader, insights and config-ui
  `getConfig` / `listKeys` forwards (recon.md:60-96).

### D-31: bind at config, plus an agent echo fix

**Config helper.** Add `boundReadUserId(call)` to `services/xstockstrat-config/src/grpc/authz.ts`, next to
`hasAdminAccessScope` (:20) and `userIdFrom` (:27) (recon.md:85-90). It returns the header caller
`userIdFrom(call.metadata)` only when all three conditions hold:

1. the header caller is non-empty
2. `!hasAdminAccessScope(call.metadata)` is true
3. the body `userId` is non-empty and differs from the header caller

In every other case it returns the body `userId` unchanged. There is no refusal path, per the operator decision of
2026-10-22. This reuses the header-derived bind pattern that `setConfig` already uses (recon.md:83-84, :109-110).

**Config call sites.**

- `getConfig`: `configServiceImpl.ts:317`
- `listKeys`: `configServiceImpl.ts:527` (recon.md:80-81). Its SQL `(user_id IS NULL OR user_id = $3)` then reads
  only global rows plus the caller's own rows.

`watchConfig` (:283) and `getSecret` (:343) are untouched (recon.md:79, :82). That keeps three things intact:
invariant #5 (open reads for unauthenticated boot `WatchConfig`, recon.md:94-95, :235-240), `@AC-13 @feature-147`,
and NC-B.

**Callers without a header** (backend boot or internal readers) keep the body `user_id`, because condition 1 fails.

**The config-ui admin view stays exempt.** `configUiBff.ts:33` forwards through `backendHeaders`
(`bffShared.ts:38`, recon.md:29). `backendHeaders` derives `x-access-scope` from `rolesToAccessScope`, and the admin
role sets 0x04 (ui `auth.ts:79/:89`). Config tests the same `ADMIN_SCOPE` bit (`authz.ts:8`, recon.md:86).

**One site closes four edges.** The trader `getConfig` forward (`traderBff.ts:146`), the insights forward
(`insightsBff.ts:162`), the non-admin config-ui `listKeys` path and the agent are all closed at config. No BFF edits
are needed.

**Config-ui non-admin case (stated explicitly).** A non-admin who picks user X in `useConfigKeys` is shown their own
rows. A UI hint for this case is out of scope.

**Agent echo fix.** This fix is required, not optional. Today `services/xstockstrat-agent/app/client.py`
`get_config` (:2034) and `list_config_keys` (:2064) echo the *requested* `user_id` (:2059, :2080; recon.md:71-73).
Under the bind, that would label a non-admin's result with the foreign user's id.

- The fix: both wrappers echo the effective user_id, computed by the same rule from the existing `_CALLER`
  contextvar (`client.py:34-36`). If a caller is bound, its `user_id` is non-empty, `not (access_scope & _ADMIN)`,
  and the requested `user_id` is non-empty and differs from it, echo the caller's `user_id`. Otherwise echo the
  request.
- It reuses `_ADMIN = 0x04` from `app/scopes.py:35` (recon.md:70) rather than a new literal.
- It is one small private helper and needs no `ctx`. The ctx-less tests at `tests/test_config_tools.py:78/:320/:328`
  (recon.md:229-231) keep passing, because with no caller bound the echo is unchanged.
- One new unit test pins it: bind a non-admin caller, request a foreign `user_id`, and assert that the echoed
  `user_id` is the caller's.
- Agent tool docstrings (`tools.py:1595-1596`, `:1623-1624`) state the bind.

### D-25: trader BFF branches plus an opt-in ledger owner predicate

**Trader BFF.** `traderBff.ts:118-127` `queryEvents` (recon.md:23-25) builds
`headers = backendHeaders(claims, ctx)` once and reuses it for every outbound call in the request. One `x-trace-id`
therefore covers the request (C-03). The handler then takes one of three branches:

1. **`copilot:` key.** Rewrite it to `copilotStreamKey(claims.user_id)` (`copilot.ts:9/:27`, recon.md:33-34). This
   is the existing behaviour, kept.
2. **`account:<id>` key.** The id is the exact remainder after the prefix. Call
   `tradingClient.listBrokerAccounts({}, {headers})`; the client is already imported (`traderBff.ts:9/:53`,
   recon.md:35-37). Ownership comes from trading's per-user scoping (`account_repo.go:84-92`). The call is unpaginated
   (`trading.proto:297-301`) and includes OFFLINE accounts.
   - Empty id, or id not owned: `PERMISSION_DENIED`.
   - `ListBrokerAccounts` errors: pass the trading error code through (UNAVAILABLE / DEADLINE_EXCEEDED). This still
     fails closed: no ledger call is made and the request does not fall through to branch 3.
   - Owned: forward unfiltered, so the owner still sees NULL-owned `reconciliation.*` rows (`trading.go:1930`,
     `:3669`; AC-3; recon.md:213-221).
3. **Empty key or any other key.** Always force `ownerOnly: true`. The browser can never supply this flag.

**Proto.** Add `bool owner_only = 7;` to `ledger.v1.QueryEventsRequest` (`ledger.proto:60-67`; fields 1–6 are in
use, recon.md:185-187). The field comment is at most 2 lines and says every user-facing edge MUST set it. Then run
buf lint, buf breaking and `./scripts/buf-gen.sh`. This corrects the product-spec Fix Scope line "No proto changes
anticipated".

**Ledger.**

- Extract the caller-owner derivation that `exportEvents` uses today (`ledgerServiceImpl.ts:301-302`,
  `call.metadata?.get?.('x-user-id')?.[0] ?? ''`) into one small helper (recon.md:51-54, :102-103). An empty caller
  matches nothing, and NULL-owned rows are excluded.
- Both `exportEvents` and `queryEvents` (:124, recon.md:47-49) use the helper.
- The predicate applies only when `req.ownerOnly` is set. The four internal Go `QueryEvents` callers never set the
  flag (portfolio `:534/:751/:796`, trading `:2222`; recon.md:203-212), so they are unaffected.
- A SQL-capture test proves that the SQL with the flag absent is byte-identical to today's.

### Tests

- **Ledger:** SQL and params capture. `makePool` ignores SQL, so the test captures `_sql` / `_params`, mirroring
  `describe('exportEvents')` (recon.md:117-119).
- **BFF unit test:**
  - branch 3 always sends `ownerOnly: true`
  - the account branch denies an unowned id and an empty id
  - a trading error code is passed through
- **e2e:** the mock at `e2e/mock-backend.ts:394` returns foreign and NULL rows when `ownerOnly` is unset, using
  fixtures in `e2e/fixtures/ledgerEvents.ts` catalogued in `INVENTORY.md` (C-13, recon.md:123-124).
- **Config:** a test matrix covering both RPCs:
  - non-admin with a foreign id: bound
  - admin with a foreign id: honoured
  - header-less caller: body id honoured
  - empty body: global
  - caller's own id: own overlay
  - secrets still redacted under a bound overlay
  - a regression test pinning bind-not-refuse for a header-carrying internal caller
- **Agent:** the echo test described above.

### Build order

1. Proto and buf-gen.
2. Ledger helper and predicate, with tests.
3. BFF branches, unit test, e2e mock and fixtures.
4. Config helper and test matrix.
5. Agent echo fix and test.
6. Docs (C-10), in the same PR:
   - ledger `CLAUDE.md`:
     - `owner_only` semantics
     - the rule that edges must set it
     - the Stream Key table, with `account:{id}` and `copilot:{user}:default`
   - config `CLAUDE.md` invariant #5:
     - reads stay open
     - a non-admin's body `user_id` is bound to the header
     - future internal readers must not rely on a foreign body id while forwarding a user header
   - agent `CLAUDE.md` rows and the "Body user_id is still sent…" paragraph (recon.md:241-245)
   - `docs/runbooks/mcp-tools.md`
   - product-spec FR-1/FR-2 exception text and the Fix Scope proto line
   - `acceptance.feature`: the AC-4/AC-5 bind amendment, plus new AC-7 and AC-8
   - a findings entry (P-03) for the accepted gaps listed under Open Risks
   - `merge-order.md` collision records

**Unchanged:** the insights BFF `queryEvents` (`insightsBff.ts:148-157`, recon.md:38-39), `ExportEvents` behaviour,
the four internal Go `QueryEvents` callers, and the agent-to-config wire format.

## Rejected Alternatives

- **Agent-tool-only bind via `ctx`** (recon option 1, recon.md:276-279). Rejected because it closes only the agent
  edge. It leaves `traderBff.ts:146`, `insightsBff.ts:162` and the non-admin path through `configUiBff.ts:33` open,
  and it breaks the ctx-less tests at `tests/test_config_tools.py:78/:320/:328`.
- **Minimal BFF `userId` pins, as `listOrders` does.** Rejected because it takes three edits instead of one, the
  agent edge still needs its own fix, and config-ui `listKeys` would become a follow-up.
- **Refusing a foreign `user_id` with `PERMISSION_DENIED`.** Rejected by the binding operator decision of 2026-10-22,
  and no Floor breach justifies reopening it.
- **Adding an `effective_user_id` field to the ConfigSnapshot / ListKeysResponse protos** to fix the echo label.
  Correct, but it needs a second proto change and another approval gate. The agent can compute the same rule
  locally from `_CALLER`.
- **Copying the `exportEvents` predicate verbatim into `queryEvents`.** Rejected because two copies of one rule would
  drift (C-18). A shared helper is used instead.
- **A ledger owner filter keyed on the mere presence of `x-user-id`, with no proto field.** Rejected because it would
  hide NULL-owned `order.filled` history from portfolio `GetPnL` (`portfolio_service.go:534/:751/:796`) and hide the
  reconciliation rows (`trading.go:1930`).
- **A ledger `user_id` filter on `account:<id>` streams.** Rejected because it would hide the owner's NULL-owned
  `reconciliation.mismatch_found` rows and break AC-3.
- **Gating on an `x-internal-caller` header or a peer-SAN check instead of a typed proto field.** The header is an
  untyped contract that is easy to drop. There is no evidence the ledger can read SAN identity. Both are kept as
  fallbacks only.
- **Owner-filtering in the BFF only, after the ledger responds.** Rejected because it produces short or empty pages,
  breaks the opaque `next_page_token`, and pulls other users' rows into BFF memory (recon.md:222-225).
- **Mapping a `ListBrokerAccounts` error to `PERMISSION_DENIED`.** Rejected because it reports a trading outage as
  "forbidden". Passing the original code through still fails closed.
- **An owned-order branch for NULL rows on `order:<id>` streams.** Rejected as YAGNI: there is no current consumer,
  so it is recorded as an accepted limitation.
- **Caching `ListBrokerAccounts` per poll.** Rejected as YAGNI because of the risk of a stale ownership set. The extra
  RPC per poll is accepted.

## Open Risks

- [ ] **Overlap with feature 257.** Rebase conflict on `ledgerServiceImpl.ts` `queryEvents` (:124-176), plus a
  possible collision on field number 7 of `QueryEventsRequest`. Record it in 263 and 257 `context.md` and in
  `merge-order.md`. To be addressed at /sdd-spec (proto step) and the merge-order record.
- [ ] **Overlap with feature 241.** The config bind collides with 241 in `configServiceImpl.ts` (setConfig). The
  hunks are not expected to overlap textually. To be addressed at the config step and in `merge-order.md`.
- [ ] **Overlap with features 247/273.** The agent echo fix touches `client.py:2034-2080`, which 247/273 also edit.
  To be addressed at the agent step and in `merge-order.md`.
- [ ] **`owner_only` defaults to false, so it fails open** for any future user-facing edge that forgets to set it.
  Mitigated by the proto comment, the ledger `CLAUDE.md` invariant and the BFF/e2e tests, but not prevented
  structurally. To be addressed at the proto, ledger and docs steps.
- [ ] **The bind applies to every non-admin caller that sends a header.** A future internal reader that forwards a
  user's `x-user-id` while asking about another user would be bound silently. Mitigated by a regression test and the
  config invariant #5 text. To be addressed at the config step.
- [ ] **Known paths the bind does not cover.** It does not fire for callers without `x-user-id` (agent stdio, or
  claims with an empty `user_id`), and it does not cover `WatchConfig`'s body `user_id`. Accepted, and recorded in the
  P-03 findings entry. To be addressed at the docs step.
- [ ] **Extra trading call per poll.** Each `account:` poll adds one `ListBrokerAccounts` RPC, which doubles BFF to
  backend fan-out per tick. Accepted, with no cache. To be addressed at the BFF step (note only).
- [ ] **C-09 approval gate.** The proto field needs it. If the gate stalls, the only fallback is the unverified
  peer-SAN gate. To be addressed at the proto step.
- [ ] **Still-unscoped ledger reads.** `streamEvents` (:182) and `getEvent` (:262) remain unscoped
  (recon.md:55-56). They are unreachable from the trader BFF today and are recorded as a follow-up finding only. To be
  addressed at the docs step.
- [ ] **Branch 3 hides some of the owner's own rows.** It hides the owner's NULL-owned `order_intent.*` rows on
  `order:<id>` streams (`trading.go:2247`, `:2278`). Accepted as a limitation. To be addressed in the findings entry
  at the docs step.
- [ ] **AC-7 cannot be proven live.** `usePositionLineage.ts:18` sends `sourceService 'trading'`, which nothing
  writes (recon.md:226-228). AC-7 must be evidenced by the ledger SQL-capture test plus the e2e mock, and must not be
  counted as a dev smoke-test pass. To be addressed at the BFF/e2e and ledger test steps.
- [ ] **acceptance.feature and FR text still owe changes before spec** (non-blocking for design): the AC-4/AC-5 bind
  amendment, new AC-7 (lineage) and AC-8 (admin exemption), and FR-1/FR-2 wording for the owned-account unfiltered
  exception. To be addressed at /sdd-spec entry.

## Constitution Rules Touched

- `C-03`: honored. Each request builds one `backendHeaders`, the trading error pass-through keeps `x-trace-id`, and
  the operator's no-waiver decision of 2026-10-21 applies.
- `C-09`: honored. The proto change is one additive field, checked by buf lint/breaking and the codegen freshness
  check. The approval gate is recorded as a risk.
- `C-10`: honored. The ledger, config and agent `CLAUDE.md` files, `mcp-tools.md` and the product-spec Fix Scope
  line all change in the same PR.
- `C-11`: honored. The design gate ran. The D-31 fix site was settled at config, the echo fix was adopted, and the
  D-25 fix site was chosen (a hybrid of BFF and opt-in ledger predicate).
- `C-13`: honored. The new e2e ledger fixtures are catalogued in `INVENTORY.md`.
- `C-15`: honored. The `acceptance.feature` amendments (AC-4/AC-5 bind, AC-7, AC-8) are owed before spec.
- `C-16`: honored. The durable rules of @feature-219, @feature-147 and @feature-021 are preserved. The @feature-196
  CHANGE is made under the operator sign-off recorded in `context.md`.
- `C-18` / DRY guard rail: honored. The ledger owner helper is shared, and the code reuses `scopes._ADMIN` and the
  `authz.ts` helpers instead of new literals.
- `P-02`: honored. The synthesis was mediated, and proposer and adversary never exchanged raw output.
- `P-03`: honored. No gap is silent: the agent mislabel is fixed, and the `WatchConfig`/stdio gaps, `streamEvents` /
  `getEvent`, and the `order:<id>` NULL rows are recorded.
- `PLAT-4/PLAT-5/PLAT-13`: honored. The cross-module seams are made explicit: the new UI to trading edge, the config
  read semantics, and the agent result contract.
- Floor (`F-*`): no breaches.

## Business Rules Touched (C-16)

- EXTEND `@AC-1 @feature-263`. New case: a foreign `account:<id>` is refused only after the `ListBrokerAccounts`
  ownership check, and an empty id is denied. This is net-new BFF behaviour with no prior suite (recon.md:178-180).
- CHANGE `@AC-2 @feature-263`. An empty or unrecognised key is now owner-scoped, and NULL-`user_id` rows are never
  returned. Signed off by the operator @ 2026-10-22 ("NULL-user_id ledger rows are never returned by trader-BFF
  reads", FR-2, ExportEvents parity; context.md OPERATOR DECISIONS).
- PRESERVE `@AC-3 @feature-263`. Own copilot thread and reconciliation are not regressed: the copilot rewrite is
  kept, and an owned `account:<id>` is forwarded unfiltered.
- CHANGE `@AC-4 @feature-263`. `get_config` with a foreign `user_id` is bound to the caller rather than refused.
  Signed off by the operator @ 2026-10-22 (bind-not-refuse override; context.md OPERATOR DECISIONS).
- CHANGE `@AC-5 @feature-263`. `list_config_keys` with a foreign `user_id` is bound to the caller rather than
  refused. Signed off by the operator @ 2026-10-22 (same decision).
- PRESERVE `@AC-6 @feature-263`. Reading the caller's own overlay is not regressed: the self id is returned unchanged.
- PRESERVE `@AC-7 @feature-263` (lineage under `ownerOnly`). Not regressed: the caller's own `order.filled` rows
  match the owner predicate. Evidenced by the SQL-capture test and the e2e mock, not by a live run.
- PRESERVE FR-6 / `@AC-8 @feature-263` (admin-scope exemption). Not regressed: `hasAdminAccessScope`
  short-circuits the bind. Confirmed by the operator @ 2026-10-22.
- PRESERVE `@AC-13 @feature-219` (empty `user_id` means global) and `@AC-6`/`@AC-7 @feature-219`. Not regressed:
  an empty body id is never bound.
- PRESERVE `@AC-8`/`@AC-9`/`@AC-12 @feature-219` (config-ui operator view). Not regressed: the admin role carries
  0x04 through `backendHeaders`.
- PRESERVE `@AC-3`/`@AC-11`/`@AC-13`/`@AC-14 @feature-147` and `@AC-4`/`@AC-5 @feature-147` (redaction and
  `GetSecret`). Not regressed: redaction runs after the bind, and `getSecret`/`watchConfig` are untouched.
- PRESERVE `@AC-35 @feature-224 @feature-225`. Not regressed: per-user secrets are never returned in plaintext, and
  `GetSecret` is untouched.
- PRESERVE `@AC-11`/`@AC-8 @feature-021` (ExportEvents owner scoping and row fields). Not regressed: the helper is
  extracted, the semantics are identical, and the existing export tests guard it.
- PRESERVE `@AC-7`/`@AC-9 @feature-183` (admin profile tools). Not regressed: the bind is not applied to them.
- PRESERVE `@AC-5 @feature-210` (header propagation under mTLS). Not regressed: `x-user-id` stays the trust anchor.
- CHANGE `@AC-9 @FR-5 @regression @feature-196` (body `user_id` semantics for non-admin callers that send a header).
  A non-admin's foreign body `user_id` is now replaced by the header caller. Signed off by the operator @ 2026-10-22
  (bind decision; explicit CHANGE entry in context.md, session 2026-10-22 sdd-design).

## Rounds

- **Round 1 (full):** the proposer offered an agent-side bind and a BFF/ledger hybrid. The adversary raised two
  blocking objections: (a) the config-ui admin view could regress if config binds, and (b) the gating of the ledger
  predicate for internal callers was unsettled. The synthesis moved the D-31 fix to config and settled D-25 on the
  opt-in `owner_only` field.
- **Round 2 (full):** the proposer answered both round-1 blockers with code evidence (`backendHeaders` carries 0x04;
  the internal Go callers never set the flag). The adversary raised a new blocking objection: the agent echo
  mislabels the user a result belongs to. The fix was adopted, along with non-blocking hardening: the shared ledger
  helper, the trading error pass-through, the proto comment and invariant, and the `order:<id>` limitation.
- **Termination:** approved. At the design gate (r2) on 2026-10-22, the operator approved the design as synthesized,
  including the agent echo fix: the echo is kept, not dropped, and is pinned by a test. That closes the last blocking
  objection. Floor clear.
