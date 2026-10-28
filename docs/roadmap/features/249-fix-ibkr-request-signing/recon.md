# Recon: fix-ibkr-request-signing

**Created**: 2026-10-20
**From**: product-spec.md
**Affected services**: xstockstrat-trading, xstockstrat-agent, xstockstrat-ui
**Type / Severity**: bug (Track C) / SEV-2
**Design mode**: full (operator standing authorization, `context.md` § Operator decisions). Scope is the whole
"IBKR auth never worked" defect: query params in the base string, the LST handshake, LST-keyed signing and
`realm`. The operator's explicit C-11 override keeps the LST work in this track. Verification has no live
IBKR account, so it uses RFC 5849 / ibind reference vectors plus an `httptest` server.

---

## Objective

Make the IBKR broker client produce requests IBKR accepts. The client must get a Live Session Token through
the RSA-SHA256 / Diffie-Hellman OAuth 1.0a handshake (FR-1). It must sign every regular request with
HMAC-SHA256 keyed by the base64-decoded LST and send `realm="limited_poa"` (FR-2). The base string must include
every query param actually sent, with the base URI excluding the query (FR-3). Handshake failures must follow
TRADING-3: 401/403 means INVALID, everything else means UNKNOWN (FR-4). Today every IBKR call is expected to
401, so no IBKR account can trade, sync or read `CREDENTIAL_STATUS_OK`.

## Codebase Map

- **`xstockstrat-trading`** (Go 1.27)
  - Entry point: `services/xstockstrat-trading/cmd/server/main.go:30` (`main`). `svc.LoadBrokerPool` runs at
    `:97` and `go svc.StartCredentialHealthPoller` at `:113`.
  - Handler/servicer: `services/xstockstrat-trading/internal/service/trading.go`.
    - `RegisterBrokerAccount` `:2472`, `UpdateBrokerAccountCredentials` `:2536`
    - `validateAndRecordCredential` `:2602` (5s `valCtx` `:2603`, `credentialStatusFromError(b.ValidateCredentials(valCtx))` `:2606`)
    - `StartCredentialHealthPoller` `:2647`, `checkCredentialHealth` `:2669`
    - `credentialStatusFromError` `:2951-2960`, `credentialsKnownInvalid` `:2964`
    - `instantiateBrokerLocked` `:3084`, IBKR branch `:3086-3097`
  - Fix site: `services/xstockstrat-trading/internal/broker/ibkr.go`.
    - `IBKRConfig` `:24-31` has no key-material and no timeout field. `IBKRClient` `:34-42` holds `baseURL`,
      `consumerKey`, `accessToken`, `accessTokenSecret`, `ibkrAccountID`, `isPaper` and `httpClient`.
    - `const IBKRRequestTimeout = 10 * time.Second` `:46`, applied at `:61`. The default base
      `https://api.ibkr.com/v1/api` is at `:51`.
    - `signRequest(method, rawURL string)` `:580-627`:
      - nonce `rand.Read` `:581-583`, timestamp `time.Now().Unix()` `:584`
      - oauth param map `:586-593`, `url.QueryEscape` param string `:604`
      - base string `:609-611`, HMAC key `"&" + url.QueryEscape(c.accessTokenSecret)` `:614`
      - header built by ranging over a Go map `:622-626`, returning `"OAuth " + …` `:626`
    - 11 `signRequest` call sites, each passing the pre-query `endpoint` string:
      - `confirmReply` `:127`, `resolveConid` `:168`, `SubmitOrder` `:234`, `SubmitBracketLegs` `:285`
      - `CancelOrder` `:313`, `ReplaceOrder` `:359`, `GetOrder` `:389`, `ListOrders` `:428`
      - `GetPositions` `:468`, `GetAccount` `:522`, `ValidateCredentials` `:561`
    - `ValidateCredentials` `:555-577` (`GET /portfolio/accounts`, 401/403 → `ErrInvalidCredentials` `:571-572`).
  - `services/xstockstrat-trading/internal/broker/broker.go`: `ErrInvalidCredentials` `:10`, `Broker` interface `:59`.
  - Credential shape: `ibkrCreds` `trading.go:87-92` (`consumer_key`, `access_token`, `access_token_secret`,
    `ibkr_account_id`). The only shape validation is `json.Valid` at `:2496` (register) and `:2537` (update).
  - Broker pool: `brokerPoolEntry` `trading.go:72`.
    - Filled at boot (`:271`), on register (`:2524`) and on update (`:2573`). Offline accounts get a nil client
      (`:257`, `:2491`).
    - A missing entry makes `resolveAccount` return NotFound "not found in pool" (`:313-314`).
  - Last migration: `011_offline_fees_snapshot_headers.up.sql` (`services/xstockstrat-trading/migrations/`). The
    next number would be `012`, but none is needed.
  - Config-read pattern: `trading.go:3109` `TimeoutMs: int(s.cfgW.GetInt("trading.broker.timeout_ms", 5000))`
    is read at client construction (Alpaca branch). The `broker` package has no config access.
  - Encryption: `EncryptCredentials` `internal/repository/account_repo.go:212`, `DecryptCredentials` `:234`
    (AES-256-GCM). The key is `BROKER_ACCOUNTS_ENCRYPTION_KEY` (`internal/config/config.go:48`, validated
    `cmd/server/main.go:50-56`). `UpdateCredentialStatus` is on the repo interface `account_repo.go:51`.
  - Local invariants: TRADING-3 (`services/xstockstrat-trading/docs/context-constitution.md:21`) and TRADING-5
    (`:23`). TRADING-7 (`:25`) is not touched. Findings: `docs/context-constitution-findings.md:28` (timeout
    defect, separate), `:44` (the open question this bug closes), `:66-67`.
- **`xstockstrat-agent`** (Python 3.13)
  - Handler: `services/xstockstrat-agent/app/tools.py:2140` `manage_account`. The IBKR shape in its docstring is
    at `:2162-2163`, and it only checks for non-empty values (`:2140-2148`, `:2184-2197`). `_grpc_error_message`
    is at `:223-240`.
  - Client: `services/xstockstrat-agent/app/client.py`.
    - `_BROKER_TYPE = {"alpaca": 1, "ibkr": 2}` `:2163`
    - `_account_to_dict` `:2171-2182` (`MessageToDict`, so `credential_status` is emitted as its enum name)
    - `register_broker_account` `:2392-2417`, `update_broker_account_credentials` `:2420-2440` (verbatim passthrough)
  - Last migration: N/A (no DB). Config-read pattern: none for broker accounts.
  - Runbook copy of the shape: `docs/runbooks/mcp-tools.md:1391` (`manage_account` section `:1375-1411`).
- **`xstockstrat-ui`** (Next.js)
  - Entry point: `services/xstockstrat-ui/src/app/trader/accounts/page.tsx:3,9` renders `AccountsModule`
    (`src/components/trader/AccountsModule.tsx:20`). `AccountManagementPanel.tsx` also hosts the forms.
  - Credential form, `src/components/trader/accountShared.tsx`:
    - `CredentialState` `:27-34`, `EMPTY_CREDENTIALS` `:36-43`
    - `buildCredentialsJson` `:46-57` (shape comment `:45`), `credentialSchema` `:61-91`
    - IBKR inputs `:110-141` (placeholders at `:115`, `:122`, `:129`, `:135`)
    - Edit form: `useWatch` `:187-197`, `setValue` `:201-208`, `updateBrokerAccountCredentials` `:213-216`, creds map `:233-240`
    - `addAccountSchema` `:396-403`
    - Add form: `useWatch` `:433-443`, `setValue` `:450-457`, `registerBrokerAccount` `:464-468`, creds map `:518-525`
    - `FieldError` is wired only for `displayName` (`:482-490`).
  - BFF: `src/lib/traderBff.ts:54-57` forwards the request without inspecting it.
  - Badge: `src/components/trader/CredentialStatusBadge.tsx:13-46` (switch at `:22`, `:29`, `:36`). It is rendered
    at `accountShared.tsx:315` and `AccountSelector.tsx:59`. The gear flag is `AccountSelector.tsx:21-26` and the
    filters are `AccountsModule.tsx:38-40`.
  - Last migration: N/A. Config-read: none relevant (only `ui.performance.*`).
- **Proto** (`packages/proto/trading/v1/trading.proto`)
  - `CredentialStatus` `:209-214` (UNSPECIFIED/OK/INVALID/UNKNOWN = 0..3)
  - `BrokerAccount` `:238-258` (`credential_status = 7` `:247`, no credential field)
  - `RegisterBrokerAccountRequest` shape comment `:267-269`, `credentials_json = 4` `:270`
  - `UpdateBrokerAccountCredentialsRequest.credentials_json = 2` `:279-281` ("same shape")

## Patterns to REUSE

- **Handshake error classification (FR-4)**: reuse the `ValidateCredentials` status switch (`ibkr.go:568-576`):
  401/403 return `ErrInvalidCredentials` (`broker.go:10`), anything else returns a wrapped `fmt.Errorf`.
  `credentialStatusFromError` (`trading.go:2951-2960`) then maps the result to INVALID or UNKNOWN unchanged. Do
  not add a new sentinel or a second classifier (TRADING-3).
- **Status recording**: reuse `validateAndRecordCredential` (`trading.go:2602-2625`). Its `credStatus` cache gates
  the write and rolls back on persist failure (TRADING-5). Add no second status writer. Keep its mechanic of
  releasing the mutex before any network or DB round trip, so the LST lock is never held across a DB write
  (`docs/roadmap/ledger/insights.md:548-560`).
- **Config into the broker constructor**: reuse the Alpaca `TimeoutMs` pattern (`trading.go:3109`). Read any new
  `trading.<category>.<key>` in `instantiateBrokerLocked` and pass it through an `IBKRConfig` field. Prefer
  hoisting the value as a typed param over an interface seam (`insights.md:1575-1578`).
- **Coalescing concurrent LST fetches**: the precedent is a `singleflight.Group` in
  `services/xstockstrat-marketdata/internal/service/marketdata_service.go:15,60` (`insights.md:2983-2996`). In
  trading, `golang.org/x/sync` is only `// indirect` (`services/xstockstrat-trading/go.mod:34`), so using it means
  promoting it to a direct dependency. The alternative is a plain mutex on the client, like `credStatusMu`.
- **Key-material home**: reuse the encrypted blob (`account_repo.go:212`, `:234`, `credentials_enc` from
  `migrations/002_broker_accounts.up.sql`). `BROKER_ACCOUNTS_ENCRYPTION_KEY` is already wired in
  `docker-compose.yml:466`, `.do/app.dev.yaml:92` and `.do/app.yaml:92`. This needs no new env var, no migration
  and no deploy-file change.
- **Parsing PEM strings, fail-closed**: `internal/mtls/mtls.go:21-37` parses env PEM via `tls.X509KeyPair` and
  wraps errors without echoing the material. This is only a weak precedent: it parses TLS pairs, not a bare
  RSA private key.
- **IBKR `httptest` fakes**: extend `ibkrOrdersServer` (`internal/broker/ibkr_reply_test.go:17`) and
  `newPromptServer` (`:50`) into a fake that can handshake, and keep the `NewIBKRClient(IBKRConfig{BaseURL:
  srv.URL})` construction (`ibkr_test.go:53` et al.). Do not build a parallel harness.
- **Service-level credential-status test**: reuse `newTestReconciliationService`
  (`internal/service/trading_reconciliation_test.go:167`, which sets up a `credStatus` map and an `accountRepo`
  param). Extend one existing fake repo to capture `UpdateCredentialStatus` instead of adding a new one (C-13,
  second-consumer rule). Candidates are `noopAccountRepo` (`:248`), `offlineAccountRepo`
  (`trading_offline_test.go:53`) and `fakeAccountRepo` (`trading_bracket_test.go:471`).
- **Go fixture home**: `services/xstockstrat-trading/internal/testdata/` (`order_rows.go`, `offline_history.go`).
  IBKR vectors and test keys move there only once a second consumer exists (C-13).
- **UI multiline key input**: `Textarea` (`services/xstockstrat-ui/src/components/ui/textarea.tsx`, used at
  `src/components/insights/RuleEditor.tsx:241`). Reuse it before adding any primitive (C-17).
- **UI field errors**: `FieldError` from `ui/field` (`accountShared.tsx:18`, used at `:488`).
- **UI test data (C-12)**:
  - extend `BROKER_ACCOUNT_IBKR` (`e2e/fixtures/accounts.ts:24-31`) and the catalog row at `e2e/fixtures/INVENTORY.md:15`
  - mock handlers are at `e2e/mock-backend.ts:324-332`; `updateBrokerAccountCredentials` returns ALPACA today
  - the e2e template is `e2e/trader/account-selector.spec.ts:66-164` (Alpaca register and edit, `page.route` intercepts)
- **Agent passthrough**: keep `client.py:2392-2440` forwarding `credentials_json` verbatim, so trading stays the
  only validator. `_account_to_dict` (`:2171-2182`) projects `BrokerAccount`, which has no credential field, so
  new key names cannot be echoed. Tests to reuse:
  - client layer, `tests/test_broker_account_client.py`:
    - `test_register_broker_account_binds_ibkr` (`:78-98`)
    - `test_update_broker_account_credentials_forwards_and_hides` (`:118`)
    - `_assert_no_credentials` (`:36-40`)
  - tool layer: `tests/test_account_tools.py` (`AsyncMock` patching, `conftest.py` `ADMIN`/`TRADER`/`_ctx`).
- **Proto field-parity guard**: `test_account_to_dict_covers_every_broker_account_field`
  (`test_broker_account_client.py:250-280`) is untouched by a comment-only proto edit.

## Existing Business Rules (preserve / extend)

Folded from the scenario-recon digest (C-16). **No CHANGE identified.** No existing `@AC-*` asserts IBKR
signing, LST, a successful 4-field IBKR registration, or `ValidateCredentials` classification. A legacy 4-field
account reading UNKNOWN or INVALID alters no durable guarantee; that is a coverage gap, not a CHANGE. This
feature's `@AC-1..4` would be the first durable IBKR credential and signing rules once promoted.

- **PRESERVE** `@AC-3 @FR-3 @feature-202` "A broker-unsupported TIF is rejected before broker submission" (`services/xstockstrat-trading/acceptance/order-time-in-force-enum.feature`): the IBKR unsupported-TIF InvalidArgument must fire before any broker I/O, including the LST handshake.
- **PRESERVE** `@AC-1 @regression @feature-206` "A broker position explained by the platform's own filled orders does not halt" (`services/xstockstrat-trading/acceptance/fix-reconciliation-false-halt.feature`): `reconcileTick` runs via `Broker.ListOrders`/`GetPositions`, and IBKR `ListOrders` is a fix site.
- **PRESERVE** `@AC-2 @regression @feature-206` "A genuinely foreign broker position still halts" (`services/xstockstrat-trading/acceptance/fix-reconciliation-false-halt.feature`): it must still halt once IBKR `ListOrders` returns real data.
- **PRESERVE** `@AC-3 @regression @feature-206` "A net-filled-qty lookup error never causes a false halt" (`services/xstockstrat-trading/acceptance/fix-reconciliation-false-halt.feature`): a handshake or sign failure must surface as a broker-call error, never a mismatch finding.
- **PRESERVE** `@AC-8 @FR-7 @feature-157` "Broker pollers skip offline accounts" (`services/xstockstrat-trading/acceptance/offline-account-portfolios.feature`): offline accounts never get a broker client or an LST handshake.
- **PRESERVE** `@AC-1 @FR-1 @feature-157` "Create an offline account with no broker credentials" (`services/xstockstrat-trading/acceptance/offline-account-portfolios.feature`): offline `credential_status` stays UNSPECIFIED and is never evaluated.
- **PRESERVE** `@AC-2 @FR-1 @feature-157` "Registering an offline account does not require credentials" (`services/xstockstrat-trading/acceptance/offline-account-portfolios.feature`): new IBKR required-field validation must not apply to offline accounts.
- **EXTEND** `@AC-3 @regression @feature-192` "a trading.* risk key set in config is applied, not silently defaulted" (`services/xstockstrat-trading/acceptance/fix-trading-config-key-mismatch.feature`): any LST TTL, refresh or handshake-timeout key the design adds must use the same full-dotted read path. This applies only if such a key is added.
- **PRESERVE** `@AC-1 @FR-1 @feature-164` "Register an Alpaca broker account" (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`): the Alpaca register passthrough is unchanged and credentials are never echoed.
- **PRESERVE** `@AC-2 @FR-1 @feature-164` "Register rejects a missing broker type" (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`): `manage_account register` validation still names 'alpaca'/'ibkr'.
- **EXTEND** `@AC-4 @FR-2 @feature-164` "Rotate a broker account's credentials" (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`): IBKR key-material rotation is added alongside, and the new fields must never be echoed either. The tool name, params and return shape stay unchanged; if the design changes any of them, this becomes a CHANGE that needs sign-off in `context.md`.
- **PRESERVE** `@AC-6 @FR-4 @feature-164` "List all of the caller's accounts, broker and offline together" (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`): the `list_accounts` contract and its `credential_status` field are unchanged.
- **PRESERVE** `@AC-7 @FR-5 @feature-164` "A caller cannot act on an account they do not own" (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`): the ownership gate also covers IBKR `update_credentials` (trading `trading.go:2544-2546`).
- **PRESERVE** `@AC-1 @FR-2 @feature-179` "Halt indicator shown on the account-management surface without placing an order" (`services/xstockstrat-ui/acceptance/ui-resume-halted-account.feature`): it lives in the same file as the credential-form edit (`accountShared.tsx:316-322`).
- **PRESERVE** `@AC-2 @FR-3 @feature-179` "Resume control appears only for a halted account" (`services/xstockstrat-ui/acceptance/ui-resume-halted-account.feature`): same file (`accountShared.tsx:338-342`).
- **PRESERVE** `@AC-3 @FR-1 @FR-4 @feature-179` "Resume clears the halt from the UI" (`services/xstockstrat-ui/acceptance/ui-resume-halted-account.feature`): same file (`handleResume`, `accountShared.tsx:293-297`).
- **PRESERVE** `@AC-5 @FR-5 @feature-179` "A non-admin caller cannot resume" (`services/xstockstrat-ui/acceptance/ui-resume-halted-account.feature`): same file (`accountShared.tsx:338`).
- **PRESERVE** `@AC-6 @FR-3 @feature-179` "Resume requires confirmation surfacing the halt reason" (`services/xstockstrat-ui/acceptance/ui-resume-halted-account.feature`): same file (`accountShared.tsx:348`).
- **PRESERVE** `@AC-1 @regression @feature-218` "A defaults-mode setup produces a .env that docker compose accepts" (`docs/sdd/business-rules/platform.feature`): `BROKER_ACCOUNTS_ENCRYPTION_KEY` stays 64-hex. A new env var would also need `setup-env`/compose wiring, which would make this an EXTEND.
- **PRESERVE** `@AC-35 @FR-14 @feature-224 @feature-225` "Two users with the same mcp_client slug use their own credentials" (`docs/sdd/business-rules/platform.feature`): conditional. It applies only if LST key material moves to config, in which case secrets stay redacted on `GetConfig`/`ListKeys`/`WatchConfig`.

Not impacted (screened; reasons in the scenario-recon digest):
- trading suites:
  - `order-time-in-force-enum` `@AC-1/2/4`
  - `resume-halted-account` `@AC-1..4,6,7`
  - `offline-account-portfolios` `@AC-4/5/9`
  - `snapshot-offline-positions`
  - `wire-signal-confidence-to-position-sizing` `@AC-2`
  - `fix-trading-config-key-mismatch` `@AC-1/2`
- agent suites:
  - `agent-broker-account-tools` `@AC-3/5/8`
  - `resume-halted-account` `@AC-5`
  - `offline-account-portfolios` `@AC-6`
  - `mcp-list-correlation-prompts`
  - `config-secrets-and-scoping` (the agent's own OAuth txn, not IBKR)
- UI suites:
  - `offline-account-portfolios` `@AC-3/13`
  - `fix-offline-account-ui-gaps` `@AC-1..4`
  - `fix-insights-offline-ticket` `@AC-1`
  - `order-time-in-force-enum` `@AC-5`
  - `ui-resume-halted-account` `@AC-4`
  - `ui-auth-improvements` (login-form credentials)
- platform scenarios:
  - `@feature-210` `@AC-1..6` (mTLS: IBKR is outbound HTTPS, not a gRPC hop)
  - `@AC-32 @feature-224` and `@AC-5 @feature-149` (`mcp-tools.md` parity; the `:1391` edit must not touch those sections)
  - `@feature-196` `@AC-3/5/9` (comment-only proto edit)
  - all remaining platform scenarios

Guard gaps and conditionals:
- **UI offline branches**: no UI suite guards the offline branches of `accountShared.tsx`: the empty blob
  (`:47-48`), no secret inputs (`:105-106`), and "Edit keys" hidden (`:276-277`). Only trading `@AC-1/2/8
  @feature-157` cover them, at the backend. New IBKR validation in `buildCredentialsJson`/`credentialSchema` must
  leave those branches intact.
- **Prose-only, not suite guarantees**: TRADING-3, the credential-health poller, `pollFills` mapping, REDUCE_ONLY
  escalation, the IBKR replace matrix, bracket submission and order-intent staleness. Design reads these directly.
- **Conditional rows**: the rows for `@AC-3 @feature-192`, `@AC-1 @feature-218` and `@AC-35` reduce to PRESERVE
  or N/A if the design adds no config key, no env var, and keeps key material out of config.
- **Coverage**:
  - read in full (107 scenarios): all 7 trading suites (29), 3 agent suites (10), 5 UI suites (14) and
    `platform.feature` (54)
  - keyword-screened only: the other 21 agent and 39 UI suites. A scenario that names none of the screened terms
    could be missed.

## Dependencies

- **Proto/RPC**: comment-only edit of the IBKR shape at `packages/proto/trading/v1/trading.proto:267-269`. No field,
  number or type changes (`credentials_json = 4` `:270`, `= 2` `:281`). `RegisterBrokerAccount`,
  `UpdateBrokerAccountCredentials` and `ListBrokerAccounts` are unchanged. The `buf lint`/`buf breaking` gate still
  runs (C-09), `./scripts/buf-gen.sh` regenerates `gen/`, and one `packages/proto` owner approves. Feature 240 also
  touches `trading.proto`/`gen/`, so whichever merges second re-runs `buf-gen.sh` (`context.md` overlap note).
- **Migration**: none. The blob is `credentials_enc` (`002_broker_accounts.up.sql`). The next free number would be
  `012`.
- **Config keys**: none exist for LST TTL, refresh margin or handshake timeout. If the design adds any, they are
  `trading.<category>.<key>` read via `WatchConfig` at `instantiateBrokerLocked` (C-05, F-07), registered in the
  `services/xstockstrat-trading/CLAUDE.md` Config Keys table and `docs/patterns/config-governance.md`, and they
  trigger the EXTEND of `@AC-3 @feature-192`. The existing `trading.broker.timeout_ms` (5000, Alpaca-only) is
  unchanged, since the IBKR timeout is out of scope.
- **Inter-service edges**: none new. Outbound HTTPS goes trading → `api.ibkr.com` (`ibkr.go:51`). Agent → trading
  and UI BFF → trading gRPC are unchanged (`client.py:2392-2440`, `traderBff.ts:54-57`).
- **New env vars / ports**: none if key material lives in the blob. If it moves to env, the wiring spans
  `setup-env`/compose/`.do/app*.yaml` plus every deploy file that carries a sibling credential
  (`docs/roadmap/ledger/fails.md:1095-1126`), and platform `@AC-1 @feature-218` becomes EXTEND.

## Risks / Not-found

Not found (carried from discovery; never guessed, F-04/P-03):
- Code for LST, `realm`, `limited_poa`, Diffie-Hellman, `crypto/rsa`, `ssodh` or `tickle` anywhere in
  `services/xstockstrat-trading`. `math/big`/`crypto/x509` appear only in mTLS code and tests.
- Any IBKR signing, LST or credential-blob logic in the agent or the UI (the UI grep finds only `accountShared.tsx`).
- A nonce or clock injection seam in `IBKRClient` (`ibkr.go:581-584`), and an `export_test.go` or other in-package
  test seam in `internal/broker/`. All broker tests are `package broker_test` (external) and cannot reach
  `signRequest`.
- Any test of `ValidateCredentials` or `validateAndRecordCredential`. `ValidateCredentials` appears only as
  `return nil` stubs (`trading_reconciliation_test.go:115`, `trading_bracket_test.go:74`). No fake captures
  `UpdateCredentialStatus`.
- RSA test-key helpers. The mTLS tests generate ECDSA keys only (`internal/mtls/mtls_test.go:34`).
- In-repo known-answer vectors. `zz_sigrepro_test.go` exists only at the session scratchpad path cited in the
  defect report (ephemeral, outside the repo), so the AC-1/AC-2 reference vectors do not exist in-repo yet.
- Any IBKR fixture under `internal/testdata/`, and any IBKR credential-status UI fixture (INVALID/UNKNOWN). Any
  IBKR-specific e2e or vitest test.
- An agent test that sends a full 4-field IBKR blob (the existing one sends `{"consumer_key":"ck"}`), and an agent
  acceptance scenario that exercises IBKR `credential_status`.
- Required-field validation of IBKR creds at register/update (only `json.Valid`). The behavior of an existing
  4-field account under the new scheme is undefined in code.
- A proto field or UI affordance that marks an account "key material missing". Only `credential_status` exists.
- Live IBKR API evidence in the repo. This covers the LST endpoint path, DH parameters, the `realm` value, the
  header and encoding rules, and whether `/iserver/*` needs `/iserver/auth/ssodh/init` plus a `/tickle`
  keepalive. The only sources are the ibind `oauth1a.py` notes in the defect report (`:78-85`).

Risks and design forks:
1. **Unverified external contract** (`fails.md:481-484`; `insights.md:1581-1583`). A hand-rolled `httptest` fake
   built from the same guesses as the client cannot catch a wrong guess. Known-answer vectors must come from an
   independent reference (ibind / RFC 5849), never from the client's own signer. The caveat must be promoted
   into `context.md`, not left only in the impl spec.
2. **Header order is nondeterministic.** `signRequest` builds the header by ranging over a map (`ibkr.go:622-626`).
   AC-2 requires the header to start with `OAuth realm="limited_poa"`, so header assembly needs an explicit order.
3. **Encoding.** `url.QueryEscape` emits `+` for a space (`ibkr.go:604`, `:609-611`, `:624`), while RFC 5849 §3.6
   requires `%20`. IBKR's and ibind's rule is unconfirmed (spec Open Question; the `BRK B` vector).
4. **Legacy 4-field accounts.** This is a design decision, and such an account must never read OK.
   - `json.Unmarshal` tolerates the 4-field blob (`trading.go:3087-3089`).
   - If `instantiateBrokerLocked` starts rejecting it:
     - `LoadBrokerPool` skips the account (`trading.go:266-269`): no pool entry, no `credStatus` hydration, and the
       poller never checks it. `PlaceOrder` then returns NotFound "not found in pool" (`:313-314`).
     - register/update leave the status UNSPECIFIED (`:2519-2521`, `:2568-2570`), which the badge renders as
       nothing (`CredentialStatusBadge.tsx` default branch).
   - If instantiate stays tolerant and validation fails without an HTTP call, `credentialStatusFromError` maps that
     to UNKNOWN unless it returns `ErrInvalidCredentials`. TRADING-3 limits that sentinel to 401/403, so either
     choice touches TRADING-3's wording.
5. **Concurrency.** The fill poller, sync, reconciliation and the credential poller share one client per account;
   the credential poller alone runs 8 checks in parallel (`trading.go:2642`, `:2682`). Without a mutex or
   single-flight, an LST cache invites a handshake storm. Register and update swap in a fresh client
   (`:2524`, `:2573`), which discards the cache, while the old client may still be mid-request.
6. **Timeout budget.**
   - The handshake adds round trips inside `validateAndRecordCredential`'s hardcoded 5s (`trading.go:2603`) and
     the 10s `IBKRRequestTimeout` (`ibkr.go:46`, `:61`). That constant also floors the staleness formula
     (`order_intent.go:102`, asserted `order_intent_test.go:175-176`).
   - `syncPositions` bounds each call with `trading.broker.timeout_ms` (`services/xstockstrat-trading/CLAUDE.md`
     note under the Config Keys table).
   - The timeout defect itself is out of scope. AC-4's "no response before the timeout" row needs a deadline the
     test controls.
7. **Test churn.** Every existing IBKR test builds clients with empty creds and has no handshake path:
   `ibkr_test.go` at lines 53, 102, 151, 220, 247, 270, 306, 352, 373 and 397, and `ibkr_reply_test.go` at lines
   80, 102, 116, 126, 139 and 163. A mandatory LST breaks all of them unless the fake handshakes or a seam
   pre-seeds an LST. `TestReplaceOrder_IBKR` asserts only `gotAuth != ""` (`ibkr_test.go:323-325`).
8. **Security.** The blob gains private RSA keys and possibly a DH prime (product-spec Fix Scope). Instantiate
   failures are logged with `err` (`trading.go:268`, `:2521`, `:2570`), so PEM/RSA parse errors must not embed key
   material. Security review is required. If any material leaves the blob, re-check trading C-1 and C-05.
9. **Brokerage session.** The `/iserver/*` calls (`ibkr.go:127`, `:168`, `:234`, `:285`, `:313`, `:359`, `:389`,
   `:428`) may need `ssodh/init` plus `/tickle` beyond the LST. No code or evidence exists, so the design must
   either scope it or name it in Out of Scope with a follow-up feature.
10. **UI DRY and input fidelity.**
    - The 6-field credential list is repeated in about 8 places (`accountShared.tsx:27-43`, `:187-208`,
      `:233-240`, `:433-457`, `:518-525`), so new fields multiply edits.
    - A multiline PEM in a single-line `type="password"` `Input` loses its newlines.
    - `FieldError` is not wired for credential fields, so zod `requiredMsg` never renders.
    - Whether a `'use client'` component file imports cleanly into the node-env vitest (`vitest.config.ts:19-20`)
      is untested.
    - The fixture constant `CREDENTIAL_STATUS_VALID` (`accounts.ts:13`) differs in name from the proto
      `CREDENTIAL_STATUS_OK` (cosmetic).
11. **C-10 shape copies.** The IBKR shape exists in five places that must move together: `trading.go:87-92`,
    `trading.proto:269`, `accountShared.tsx:49-55`, `tools.py:2162-2163` and `mcp-tools.md:1391`. C-14 surfaces are
    named in the product spec.
12. **Overlap.** Feature 240 touches disjoint `trading.go` regions and `trading.proto`/`gen/`, so it needs a rebase
    only (`context.md` § sdd-review). The agent `fails.md:2068-2085` tool-count traps are not triggered, because
    the tool count is unchanged.
13. **Stale doc anchors.** TRADING-3 (`services/xstockstrat-trading/docs/context-constitution.md:21`) cites
    `credentialStatusFromError (~L2873)`; the actual line is `:2951`. The findings `:28` hint says `~L3027` and the
    actual line is `:3084`. The teardown refresh owes these.

## Recommended Scope

Advisory only; input to the grilling and `/sdd-spec`, not binding.

1. **trading / broker: signer.**
   - `signRequest` signs the built `*http.Request`: query params merged into the base string, base URI without
     the query, the confirmed encoding rule, and a deterministic header with `realm` first.
   - Add an unexported nonce/clock seam.
   - Known-answer tests from the independent reference (AC-1, AC-2). Update all 11 call sites.
2. **trading / broker: LST handshake.**
   - RSA-SHA256 LST request with a DH challenge, then derive the LST.
   - Cache the LST per client with a concurrency guard.
   - 401/403 returns `ErrInvalidCredentials`, everything else a wrapped error.
   - A handshake-capable `httptest` fake. Migrate the existing IBKR tests (AC-3 and AC-4, broker half).
3. **trading / service: credentials.**
   - Add the `ibkrCreds` and `IBKRConfig` key-material fields and plumb them in `instantiateBrokerLocked`.
   - Legacy 4-field behavior as decided in design. Read any new config key there.
   - A service-level `validateAndRecordCredential` test with a real `IBKRClient` against `httptest` and a fake
     repo that captures the written status (AC-3, AC-4 status half).
4. **proto**: update the comment at `trading.proto:267-269` and run `buf-gen.sh`.
5. **ui**:
   - Add the key-material inputs (`Textarea`), schema and builder. Keep the offline branches intact. Never render
     stored values back.
   - IBKR register/edit e2e from `account-selector.spec.ts`, plus fixtures and `INVENTORY.md` (C-12, C-17).
6. **agent**: update the `manage_account` docstring and `mcp-tools.md:1391`. Add an IBKR update no-echo test
   (EXTEND `@AC-4 @feature-164`).
7. **docs**:
   - `services/xstockstrat-trading/docs/ibkr.md` and the `CLAUDE.md` credential-health paragraph
   - close findings `:44` and re-stamp the TRADING-3 hints
   - run the teardown context audit
