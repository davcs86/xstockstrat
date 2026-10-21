# Design: fix-ibkr-request-signing

**Created**: 2026-10-21
**Rounds**: 3 (full; termination: approved — auto-approved under operator standing authorization 2026-10-21)
**Approved by**: orchestrator under operator standing authorization @ 2026-10-21 (context.md § Operator decisions: full mode, rounds ≥ 2, no F-* breach, no blocking objection, no un-covered @AC CHANGE)
**Grounded in**: recon.md

Anchors outside recon.md (`trading.go:684`, `:1521`, `:1977`, `:1984`, `:1991-1994`, `:2076-2079`, `:2153-2154`,
`:2669-2693`, `:3371`, `:3416`, `:3458-3461`; `ibkr.go:122`, `:218-220`, `:229`, `:261-274`, `:280`, `:354`;
`alpaca.go:493-509`; `.gitleaks.toml:33-34`; `ci.yml:749`, `:754`) were spot-verified in the worktree during
round 3 (F-04).

---

## Chosen Approach

Scope is the whole "IBKR auth never worked" defect (operator C-11 override, context.md § Operator decisions):
query params in the base string, the Live Session Token (LST) handshake including brokerage-session init,
LST-keyed signing, and `realm`. Paths below are relative to `services/xstockstrat-trading/` unless stated.

### 1. Signer — `authorize(req, sess)` replaces `signRequest`

- `signRequest(method, rawURL)` (`internal/broker/ibkr.go:580-627`, recon.md:39-43) is replaced by
  `authorize(req *http.Request, sess)`, which signs the built request, so all 11 call sites (recon.md:44-47) stop
  passing the pre-query endpoint.
- Parameter string: the oauth params plus the decoded `req.URL.Query()`, encoded with one RFC 5849 §3.6
  `oauthEncode` helper and sorted (FR-3). Base URI is lowercased scheme+host plus path, without the query.
  `url.QueryEscape` (`+` for space, recon.md:273-274) is removed from the signer. The exact rule is pinned by
  ibind vectors for `BRK B` and for `+`, `/`, `~`, `=` in the nonce and signature.
- Regular requests: HMAC-SHA256 keyed by base64-decode(LST) (FR-2). The `"&" + accessTokenSecret` key
  (recon.md:42) is deleted.
- Header order is explicit: `OAuth realm="limited_poa"` first, then the sorted oauth params. This replaces the
  map range at `ibkr.go:622-626` (recon.md:43, :271-272).
- Test seams: exported optional `IBKRConfig` fields `Now`, `Nonce`, `DHRandom`, defaulting to `time.Now` and
  `crypto/rand`. No in-package seam exists today (recon.md:246-248).

### 2. Session — one coalesced handshake unit

- State: `session{gen, lst, exp}` under a mutex never held across I/O, a DB write or `credStatusMu`
  (recon.md:104-107). A cached LST is valid only while `now < exp − lst_refresh_margin`.
- `ensureSession` runs `singleflight.DoChan("lst", …)`. The leader runs under
  `context.WithTimeout(context.WithoutCancel(ctx), handshake_timeout)`, so a caller's 5s `valCtx` (recon.md:30)
  or the reconcile call bound cannot abort it. Each waiter selects on its own ctx. Precedent
  `services/xstockstrat-marketdata/internal/service/marketdata_service.go:15,60`; `golang.org/x/sync` is promoted
  from `// indirect` at `go.mod:34` (recon.md:111-114). This closes the handshake-storm risk (recon.md:285-288).
- One handshake, stored under one `gen++`:
  1. PKCS1v15-decrypt `access_token_secret` with the encryption key → prepend.
  2. `POST /oauth/live_session_token` with DH challenge `A = g^a mod p`, RSA-SHA256-signed over
     `prepend + baseString` (FR-1).
  3. `K = B^a mod p` with Java `toByteArray` serialization; `LST = base64(HMAC-SHA1(K, prepend))`.
  4. Verify `live_session_token_signature`.
  5. `POST /iserver/auth/ssodh/init {publish:true, compete:false}` (brokerage session; recon.md:304-306).
- `compete=false`: cannot log out the account holder's TWS, mobile or Client Portal sessions. A 2xx init reply
  without `authenticated:true` logs WARN `ibkr brokerage session not established` with `competing=<bool>` and
  returns `%w ErrInvalidCredentials`. It heals because `checkCredentialHealth` re-validates INVALID accounts each
  cycle (`trading.go:2669-2693`, recon.md:31). Init 5xx or network error is transient.
- `ValidateCredentials` goes through `c.do`, so it exercises the full handshake including init; a persistent init
  failure surfaces on the badge instead of hiding behind OK.
- Transient re-call: a caller re-calls `ensureSession` once only when it **joined** a flight that started before
  its own call. A caller that led the flight, or waited on the flight that produced generation G, counts as
  having minted G (no second handshake per 503/timeout; C-18).
- A handshake ending in `ErrInvalidCredentials` is negatively cached for `reauth_min_interval`: one LST request
  per interval per bad account, not one per poll call.

### 3. Error classification (TRADING-3 widened, FR-4 amended)

- `%w ErrInvalidCredentials`, no further HTTP call:
  - missing or unparseable signature key / encryption key / DH prime (checked locally; error text never embeds
    key material, recon.md:301-303) — this is the legacy 4-field blob path (§8);
  - PKCS1v15 decrypt failure (proven to mean a wrong key by a known-answer decrypt vector);
  - `live_session_token_signature` mismatch;
  - init 2xx not authenticated;
  - a 401/403 on the LST request, or a final 401/403 from `c.do`.
- Transient (UNKNOWN): 5xx, network error, timeout, a waiter's own ctx expiring.
- `credentialStatusFromError` and `validateAndRecordCredential` are unchanged (single status writer, TRADING-5;
  recon.md:32, :100-107). No new sentinel; `broker.go:8` doc comment is updated to say the sentinel can come from
  any IBKR call.
- Rationale for the three new INVALID cases: they are deterministic and never heal; UNKNOWN accounts are not
  skipped by reconciliation (`trading.go:2964-2966`, recon.md:32) and would feed the systemic count.

### 4. `c.do(req)` — single send seam, 401 handling

- One `c.do(req)` replaces the 11 `Header.Set(signRequest…)` + `Do` pairs; callers keep their own status
  switches. The duplicate 401/403 branch at `ibkr.go:568-576` (recon.md:48, :100-101) collapses.
- On a 401 signed with snapshot generation G:
  - this call minted G → final;
  - current gen ≠ G → re-sign with current session, resend once (no handshake);
  - current gen = G → `invalidate(G)` honoured only if the last 401-triggered invalidation is ≥
    `reauth_min_interval` ago; then re-ensure, re-sign with a new nonce, rebuild the body via `req.GetBody`
    (every POST body is a `bytes`/`strings` reader: `ibkr.go:122`, `:229`, `:280`, `:354`) and resend once.
    Otherwise final.
- Final 401/403 → `fmt.Errorf("ibkr %s %s: status %d: %w", …, ErrInvalidCredentials)`.
- Retry applies to every GET/DELETE and to the POSTs `SubmitOrder` (deduplicated by `cOID`, `ibkr.go:218-220`),
  `ReplaceOrder`, `CancelOrder` and `confirmReply`. Only a 401 is a resend trigger; 5xx/timeout/network on a
  POST/DELETE is never resent (IBKR may have processed it).
- **Uncertain-resend rule.** If the resend after a 401 fails for any reason other than a final 401 (including a
  `cOID` duplicate-order rejection, which means the first POST landed), `c.do` returns an uncertain outcome:
  `%w` on a deadline-class error (or an equivalent marker) that both timeout classifiers (`trading.go:684`
  SubmitOrder, `:1521` ReplaceOrder) treat as uncertain — never a definite REJECTED.
- **Bracket legs are excluded from the 401 resend (decision).** `SubmitBracketLegs` carries no `cOID`
  (`ibkr.go:261-274`), and `BracketLegsRequest` / its call sites (`trading.go:3411`, `:3453`) carry no resize
  generation to build a deterministic leg `cOID` from; IBKR leg-`cOID` dedup is also unverified. A final 401 on a
  leg POST goes to the existing bounded, alerted FAILED-bracket path (`trading.go:3416`, `:3458-3461`) instead
  of risking duplicate STP/LMT legs (over-sell). `c.do` takes a per-call no-resend flag used only by
  `SubmitBracketLegs`.
- **Lapsed brokerage session.** If IBKR answers `/iserver/*` on a lapsed brokerage session with a 401, the rule
  above re-inits. If `/sdd-spec` pins a non-401 "not authenticated" reply, `c.do` treats that reply as a re-init
  trigger exactly like a 401. Until pinned this is the one documented exception to "deterministic failures never
  reach REDUCE_ONLY" (Open Risks).

### 5. Error wrapping on the order paths

- Transient `ensureSession` errors are flattened with `%v`: nothing was sent, so a session failure before the POST
  is a definite REJECTED at both classifiers (`trading.go:684`, `:1521`). `resolveConid` runs before the POST.
- `ErrInvalidCredentials`, the real request's transport error and the resend's transport error keep `%w`.
- `/sdd-spec` greps for any other `DeadlineExceeded`/`Timeout()` classifier (today only these two).

### 6. Reconciliation — credential failures are not systemic

- `reconcileTick`: on `errors.Is(err, broker.ErrInvalidCredentials)` from `ListOrders` (`trading.go:1991-1994`)
  **and** from `GetPositions` (`trading.go:2076-2079`), log WARN and `continue` without `systemicCount++`. This
  closes the window before the INVALID status lands and the known-invalid skip (`trading.go:1977`) applies.
- IBKR-only in effect: Alpaca returns the sentinel only from `ValidateCredentials` (`alpaca.go:493-509`).
- Feature-206 own-fill, foreign-halt and lookup-error rules are untouched (recon.md:158-160).

### 7. Config — three WatchConfig keys via a getter (C-05/F-07)

- `IBKRConfig.Timing func() broker.IBKRTiming`, passed in by `instantiateBrokerLocked` (`trading.go:3084`,
  recon.md:33), defaults at the call site via `s.cfgW.GetInt(key, default)` (`trading.go:3109`, `:3371`;
  recon.md:58-59, :108-110):
  - `trading.ibkr.lst_refresh_margin_ms` = 60000
  - `trading.ibkr.handshake_timeout_ms` = 10000
  - `trading.ibkr.reauth_min_interval_ms` = 30000
- Registered in `services/xstockstrat-trading/CLAUDE.md` Config Keys table and the Per-Feature Registered Keys log
  in `docs/patterns/config-governance.md` (recon.md:229-233). Owner + config-team approval. No seed migration.
- Not tied to `IBKRRequestTimeout` (`ibkr.go:44-46`), itself a separate out-of-scope defect.
- `realm`, `compete=false` and endpoint paths are protocol constants, not config.

### 8. Credential shape and plumbing

- `ibkrCreds` (`trading.go:87-92`) and `IBKRConfig` (`ibkr.go:24-31`) gain `signature_key`, `encryption_key`
  (PEM RSA private keys) and `dh_prime` (PEM, `pem.Decode` + `asn1` into `{P, G}`, using the parsed G)
  (recon.md:35-36, :50-51). Stored in the existing AES-256-GCM blob (`account_repo.go:212`, `:234`; recon.md:60-62,
  :115-118): no env var, no migration, no deploy-file change.
- `NewIBKRClient` parses once and retains any parse error. `instantiateBrokerLocked` stays tolerant, so a legacy
  4-field account keeps its pool entry and reads INVALID locally with no HTTP call (recon.md:275-284).
- Backend validation: `InvalidArgument` for an incomplete IBKR blob, scoped to `BROKER_TYPE_IBKR`, next to the
  `json.Valid` checks at `trading.go:2496` and `:2537` (recon.md:51). Offline registration is unaffected.
- C-10: the five shape copies move together — `trading.go:87-92`, `trading.proto:267-269`,
  `accountShared.tsx:49-55`, `tools.py:2162-2163`, `mcp-tools.md:1391` (recon.md:316-318).

### 9. Consumer surfaces (C-14)

- `/trader` Accounts IBKR register/edit form (`services/xstockstrat-ui/src/components/trader/accountShared.tsx`,
  recon.md:79-86): three `Textarea` inputs (recon.md:132-133) with `autoComplete="off"`, `spellCheck={false}`,
  rotation copy, `FieldError` wired, stored values never rendered back; offline branches guarded by a test
  (recon.md:206-209, :307-315). E2E from `account-selector.spec.ts`, fixture `BROKER_ACCOUNT_IBKR` +
  `INVENTORY.md` (recon.md:135-138, C-12).
- `/trader` credential badge: no code change; a valid IBKR account reads `CREDENTIAL_STATUS_OK`.
- Agent `manage_account` register/update_credentials (`services/xstockstrat-agent/app/tools.py:2140`): docstring
  and `docs/runbooks/mcp-tools.md:1391` updated; tool name, params and return shape unchanged; trading stays the
  only validator, its new `InvalidArgument` surfaces through `_grpc_error_message` (recon.md:67-75, :139-146); new
  IBKR no-echo test.
- Proto: comment-only edit at `packages/proto/trading/v1/trading.proto:267-269`, then `./scripts/buf-gen.sh`
  (recon.md:92-96, :222-226).

### 10. Tests and fixtures

- `internal/testdata/` (recon.md:130-131; second consumer = broker + service tests, C-13): ibind known-answer
  vectors with pinned ibind SHA, date checked and generator command in the fixture header; two DH vectors (K high
  bit set / not set); encoding cases; a known-answer decrypt vector; a fixed test RSA key.
- `testdata.IBKRAuthHandler`: a replay fake (signature string equality) extending `ibkrOrdersServer` /
  `newPromptServer` (`ibkr_reply_test.go:17`, `:50`; recon.md:122-124). Existing IBKR tests migrate to it
  (recon.md:297-300).
- Service-level `validateAndRecordCredential` test with a real `IBKRClient` against `httptest` and an existing
  fake repo extended to capture `UpdateCredentialStatus` (recon.md:125-129).
- Fake rows: decrypt failure → INVALID; signature mismatch → INVALID; init not authenticated → INVALID; init
  self-competing → INVALID then heals; init 503 → UNKNOWN; injected 50ms handshake bound (handler unblocks on a
  `t.Cleanup` done channel); lapsed session; generation guard; stale-LST retry; fresh-session 401 final;
  post-401 resend failure → uncertain; bracket-leg 401 not resent; negative cache; boot budget.
- gitleaks: `.gitleaks.toml:33-34` is ONE `[allowlist]` table with `regexTarget = "line"`; do not flip it. Either
  add a regex for a unique key-body substring to that table, or add a separate `[[allowlists]]` block ANDing
  `paths` (the fixture) with that regex — the latter needs gitleaks ≥ 8.21 under `gitleaks/gitleaks-action@v3`
  (`ci.yml:754`), confirmed at `/sdd-spec`. Verify with a local `gitleaks detect`; list `.gitleaks.toml` in the
  step's Files. trufflehog runs `--only-verified` (`ci.yml:749`).

### Build order

1. Signer + vectors. 2. `ensureSession` (DoChan, init, negative cache) + replay fake. 3. `c.do` retry, 401
mapping, uncertain-resend rule, bracket-leg no-resend. 4. Service plumbing: Timing getter, IBKR-only
`InvalidArgument`, `reconcileTick` skips on `ListOrders` and `GetPositions`. 5. Config-key registration.
6. Proto comment + `buf-gen.sh`. 7. UI. 8. Agent. 9. Docs (`docs/ibkr.md`, trading `CLAUDE.md`, TRADING-3 row,
`broker.go:8`, findings `:44`, stale anchors recon.md:322-324), then teardown.

## Rejected Alternatives

- Tie refresh margin / handshake bound to `IBKRRequestTimeout` (r2) — conflicts with product-spec.md:116-117
  (C-05/F-07); that constant is itself a documented hardcoded-timeout defect (`ibkr.go:44-46`).
- Amend the product-spec config line instead of adding keys (r2 option a) — needs an operator sign-off the
  binding decisions do not cover.
- `ssodh/init` with `compete=true` — logs out the account holder's TWS/mobile/Client Portal sessions on
  real-money accounts; no operator decision covers it; its cited source (report:78-85) does not contain it.
- `competing:true` → UNKNOWN — better meaning, but UNKNOWN feeds `systemicCount` and would trigger platform-wide
  REDUCE_ONLY on every overlapping deploy.
- Decrypt failure / signature mismatch / persistent init failure as transient — none heals; UNKNOWN accounts are
  not skipped (`trading.go:2964-2966`), so one bad account can escalate the platform.
- Separate `brokerageReady` flag with path-based init branching (r2) — hid a persistent init failure behind OK.
- POST/DELETE no-retry on 401 (r1/r2) — a revoked cached LST would fail orders and drive bracket FAILED
  (`trading.go:3416`, `:3458`).
- Retry POST/DELETE on 5xx/timeout/network — IBKR may have processed the request.
- Resend bracket legs without `cOID` and record the residual (r3 as proposed) — trades a bounded, alerted FAILED
  bracket for unbounded double-submit exposure.
- Deterministic leg `cOID` from parent `cOID` + leg role + resize generation — no resize generation exists in
  `BracketLegsRequest` or its call sites (`trading.go:3411`, `:3453`), and IBKR leg-`cOID` dedup is unverified;
  adds payload and plumbing for an unproven guarantee. Exclusion is the minimum safe choice.
- No retry on order-creating POSTs at all — loses to cOID-protected `SubmitOrder` resend plus the uncertain-resend
  rule; kept only for bracket legs.
- Flip the single `.gitleaks.toml` `[allowlist]` to `regexTarget="match"` — re-tests the four existing literals
  against matched secret text; risks CI false positives.
- Whole-file gitleaks `paths` allowlist with no regex — would hide a real key pasted into the fixture.
- Runtime `rsa.GenerateKey` test keys — cannot reproduce ibind PKCS1v15/RSA-SHA256 known-answer vectors.
- Hand-rolled 1-slot semaphore + goroutine (r2) — `singleflight.DoChan` with a `WithoutCancel` leader ctx gives
  the same detachment with less machinery.
- Plain `singleflight.Group.Do` with the caller's ctx — hands a short-ctx `DeadlineExceeded` to every waiter.
- Boot LST warm-up after `LoadBrokerPool` — the detached holder caches its result, so the cost is at most one lost
  first tick; a warm-up fires N RSA handshakes at boot for no further gain.
- `/iserver/auth/status` poll loop after init — speculative; a transient `authenticated:false` heals next cycle.
- Full server-side DH/RSA fake with its own oracle — a second crypto implementation sharing our guesses
  (`fails.md:481-484`); replay of ibind vectors instead.
- Reject legacy 4-field blobs in `instantiateBrokerLocked` — drops the pool entry; `PlaceOrder` becomes NotFound
  (recon.md:277-281).
- Key material in env vars, config secret rows or a migration — the per-account AES-256-GCM blob already carries
  it (recon.md:115-118).
- New `CredentialStatus` value for "competing session" — proto + UI churn for a self-healing condition; WARN log
  with `competing=true` instead.

## Open Risks

- [ ] Unverified external contract, no live IBKR account: base-string encoding, oauth param set, K serialization,
  PKCS1v15 vs OAEP, `ssodh/init` body `{publish, compete}` and reply fields `authenticated`/`competing`/`connected`,
  the lapsed-session reply. All tests can pass while every real account reads INVALID; only a paper smoke can
  tell "IBKR rejected us" from "we guessed the shape wrong" (`fails.md:481-484`). The adversary's recollection of
  ibind (`compete=True`, those reply fields) is unverified and not a source. — `/sdd-spec` vector step pins ibind
  SHA, date and generator command before merge; paper smoke if an account appears.
- [ ] ibind vectors pinned to one SHA may drift from what IBKR accepts today. — fixture header records SHA, date,
  generator command (step 1).
- [ ] Lapsed brokerage session answered with a non-401 reply: `ListOrders`/`GetPositions` count as systemic; with
  one IBKR + one Alpaca account 1/2 meets the threshold and `escalateSystemic` fires (`trading.go:1991-1994`,
  `:2153-2154`); halted accounts polled at `haltedPollInterval` (`trading.go:1984`) are most exposed. Documented
  exception. — `/sdd-spec` pins the reply; if non-401, `c.do` treats it as a re-init trigger (step 3); AC-6 row.
- [ ] `compete=false` self-competition: DO rolling-deploy overlap of old/new trading containers, and the ~24h LST
  refresh re-running init while the prior session is live, may read INVALID for up to one health interval
  (default 300000ms) with a badge that wrongly suggests rotating keys. — fake row "self-competing → INVALID, then
  heals" (step 2); AC-4 row, AC-10.
- [ ] 401-after-processing on an order POST: `cOID` dedup + uncertain-resend bound it for `SubmitOrder`; bracket
  legs are excluded from the resend, so a revoked LST on a leg POST takes the alerted FAILED-bracket path. —
  step 3; AC-6.
- [ ] `/tickle` keepalive deferred to follow-up `ibkr-session-keepalive` (blocked by 249; NNN assigned at
  `/sdd-story` — 253 is taken by `253-fix-edgar-companyfacts-decode`). If 60s reconciliation traffic does not
  count as session activity, brokerage sessions may idle out between ticks. — file via `/sdd-story` after 249
  design.
- [ ] Signer regression after a deploy turns every IBKR account INVALID with only per-account WARNs
  (`trading.go:2977`), no page. — `/sdd-spec` either adds one aggregate WARN/notify alert when every IBKR account
  reads INVALID in a reconcile tick, or files tracked follow-up `ibkr-fleet-invalid-alert`.
- [ ] A 403 permission error on an `/iserver` order call now also skips the systemic count for that tick —
  accepted as an account-scoped refusal.
- [ ] gitleaks `[[allowlists]]` syntax depends on the version bundled in `gitleaks-action@v3` (`ci.yml:754`). — if
  unsupported, fall back to a unique-substring regex in the existing `"line"` table (step 1).
- [ ] Boot cost: handshake + init + `ListOrders` may exceed the 5s `brokerCallTimeout` on the first
  `reconcileTick` after restart; loss limited to one tick. — boot-budget test (step 2).
- [ ] UI shows private keys in plain textareas; `autoComplete`/`spellCheck` reduce but do not remove exposure. —
  Security review (step 7).
- [ ] Three new config keys need owner + config-team approval; until registered, call-site defaults apply. —
  step 5.
- [ ] `/sdd-spec` re-greps feature-102/206 suites to confirm no durable `@AC` asserts that a credential-rejected
  `ListOrders`/`GetPositions` counts as systemic. — `/sdd-spec`.

## Constitution Rules Touched

- `C-11` — honored by: operator explicit override puts the LST handshake (and `ssodh/init`) in this bug track, no
  separate `/sdd-story` (context.md § Operator decisions); full mode per the standing authorization.
- `C-05` / `F-07` — honored by: refresh margin, handshake bound and reauth interval are `trading.ibkr.*`
  WatchConfig reads with call-site defaults (`trading.go:3109`, `:3371`), registered in trading `CLAUDE.md` and
  `config-governance.md`. `realm`, `compete=false` and endpoint paths are protocol constants.
- `F-08` — honored by: the committed test PEM gets a scoped gitleaks allowlist (unique-substring regex, or
  `[[allowlists]]` paths AND regex), never a table-wide `regexTarget` flip.
- `F-04` / `P-03` — honored by: anchors spot-verified in round 3; overstated claims corrected (gitleaks
  consistency, "no guess fails toward REDUCE_ONLY", the FR-4 contradiction); unverified IBKR contract kept in
  Open Risks and context.md, not asserted.
- `P-01` / `P-02` — honored by: single writer; only the synthesized state was forwarded between proposer and
  adversary.
- `C-10` / `C-14` — honored by: trading stays the single validator (IBKR-only `InvalidArgument`); the five shape
  copies move together; consumer surfaces named in §9; `/tickle` deferral has a concrete follow-up slug.
- `C-13` — honored by: vectors and `testdata.IBKRAuthHandler` live in `internal/testdata/` with two consumers
  (broker + service tests).
- `C-15` — honored by: AC-5..AC-10 and the new AC-4 rows are written into `acceptance.feature` in this design
  commit, before `/sdd-spec`.
- `C-16` — honored by: every durable suite touched reads PRESERVE or EXTEND; no CHANGE.
- `C-17` — honored by: `Textarea` reuse, `autoComplete="off"`, `spellCheck={false}`, rotation copy, offline-branch
  guard test.
- `C-18` — honored by: `singleflight.DoChan` replaces the hand-rolled semaphore; transient re-call narrowed to
  joiners of an older flight.
- `TRADING-3` — widened to "401/403, or deterministic unusable credentials (missing/unparseable key material,
  decrypt failure, LST-signature mismatch, init not authenticated)". Row at
  `services/xstockstrat-trading/docs/context-constitution.md:21` and the `broker.go:8` comment edited in the
  implementation PR; FR-4 amended in this commit.
- `TRADING-5` — honored by: `credentialStatusFromError` / `validateAndRecordCredential` unchanged; session lock
  never held across I/O, `credStatusMu` or a DB write.
- Proto governance (`C-09`) — comment-only change at `trading.proto:267-269`, `buf-gen.sh`; `buf breaking`
  unaffected; one `packages/proto` owner.
- Approval flow — new config keys: owner + config team.
- Teardown — TRADING-3 row, trading `CLAUDE.md` config table, `config-governance.md`, `docs/ibkr.md`,
  `mcp-tools.md` are touched: run `/context-forge:context-constitution refresh` or reconcile by hand and record it
  in the PR body.

## Business Rules Touched (C-16)

No CHANGE to any existing durable `@AC`, so no operator CHANGE coverage is required. The FR-4 amendment and the
new AC-4 rows edit this feature's own, not-yet-promoted spec; the existing AC-4 rows are unchanged (EXTEND).

- PRESERVE `@AC-1 @FR-3` "A GET with query params is signed over those params" (feature 249) — implemented by §1.
- PRESERVE `@AC-2 @FR-2` "Every IBKR request is signed with the Live Session Token and carries realm" (feature
  249) — §1.
- PRESERVE `@AC-3 @FR-1` "The client obtains a Live Session Token before its first regular request" (feature 249)
  — §2; the handshake now also includes `ssodh/init` before `GET /portfolio/accounts`.
- EXTEND `@AC-4 @FR-4` "A failed Live Session Token handshake is classified per TRADING-3" (feature 249) — new
  rows: decrypt failure, signature mismatch, init not authenticated, init self-competing → INVALID; init 503 →
  UNKNOWN. Existing 401/403/503/timeout rows unchanged. FR-4 text amended in this commit.
- EXTEND `@AC-5` (feature 249, new) — legacy 4-field IBKR blob reads INVALID with no HTTP call.
- EXTEND `@AC-6` (feature 249, new) — generation-guarded retry-once on 401 for GET/POST/DELETE; no retry on a
  freshly minted session; a post-401 resend failure is uncertain, not REJECTED; bracket legs not resent; lapsed
  session re-inits.
- EXTEND `@AC-7` (feature 249, new) — incomplete IBKR blob returns `InvalidArgument`, IBKR-only.
- EXTEND `@AC-8` (feature 249, new) — submit-path session failure is a definite REJECTED, not PENDING.
- EXTEND `@AC-9` (feature 249, new) — credential-rejected IBKR `ListOrders`/`GetPositions` is not counted as
  systemic.
- EXTEND `@AC-10` (feature 249, new) — bad-credential handshake negatively cached (one LST request per
  `reauth_min_interval`), and the account heals on a later cycle once IBKR accepts.
- EXTEND `@AC-3 @regression @feature-192` "a trading.* risk key set in config is applied, not silently defaulted"
  (`services/xstockstrat-trading/acceptance/fix-trading-config-key-mismatch.feature`) — three new `trading.ibkr.*`
  keys read via the full-dotted `cfgW.GetInt` path.
- EXTEND `@AC-4 @FR-2 @feature-164` "Rotate a broker account's credentials"
  (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`) — IBKR key-material rotation; new
  `InvalidArgument` surfaces via `_grpc_error_message`; params and return shape unchanged; pinned by the no-echo
  test.
- PRESERVE `@AC-1 @FR-1 @feature-157` "Create an offline account with no broker credentials"
  (`services/xstockstrat-trading/acceptance/offline-account-portfolios.feature`) — offline `credential_status`
  stays UNSPECIFIED.
- PRESERVE `@AC-2 @FR-1 @feature-157` "Registering an offline account does not require credentials" — validation
  scoped to `BROKER_TYPE_IBKR`.
- PRESERVE `@AC-8 @FR-7 @feature-157` "Broker pollers skip offline accounts" — offline nil client, no handshake.
- PRESERVE `@AC-1..@AC-4 @feature-202` (`order-time-in-force-enum.feature`) — TIF validated before any broker I/O,
  including the handshake.
- PRESERVE `@AC-1..@AC-3 @regression @feature-206` (`fix-reconciliation-false-halt.feature`) — own-fill,
  foreign-halt and lookup-error rules untouched; the skip only removes deterministic `ErrInvalidCredentials`
  results from `systemicCount`; the lapsed-session exception is documented.
- PRESERVE `@AC-1 @regression @feature-218` (`docs/sdd/business-rules/platform.feature`) — no new env var.
- PRESERVE `@AC-35 @FR-14 @feature-224 @feature-225` (`docs/sdd/business-rules/platform.feature`) — key material
  stays out of config.
