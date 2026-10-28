# Context Log: fix-ibkr-request-signing

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-19-trading-ibkr-oauth-signature-omits-query-defect.md`
  (Issues disabled). Source: `services/xstockstrat-trading/docs/context-constitution-findings.md` § Open questions row 1.
- Severity: SEV-2. Impact type: broker-auth-failure. Environment: dev (main-dev) @ 1302e6d. Config-only: no.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..3), context.md.
- Affected services (from report): xstockstrat-trading. Triage grep adds possible xstockstrat-ui
  (`src/components/trader/accountShared.tsx`) and xstockstrat-agent (`app/tools.py`), which carry the IBKR
  credential fields, if the LST handshake needs new key material.
- Root cause hypothesis: `signRequest` (`internal/broker/ibkr.go:580`) is generic OAuth 1.0a — query params never
  merged into the base string; HMAC key `"&" + accessTokenSecret`; no LST handshake; no `realm`.
- Confirmation evidence (report): scratch test `zz_sigrepro_test.go` captured `GetOrder`'s header for query
  `orderId=42`: client sig `fVi5RZ…MQ3I=` matches the reference with query OMITTED; the RFC 5849 §3.4.1.3 reference
  with query INCLUDED is `41mcn4…8G0=` (no match); `realm present in header: false`. The LST/`realm` requirement
  comes from the ibind reference client and IBKR docs; a live 401 has not been observed against a real account.
  Existing tests (`TestSubmitOrder_IBKRResolvesConid`, `TestGetOrder_IBKRAvgPrice`, `TestIBKRListOrders_*`,
  `TestReplaceOrder_IBKR`) check paths/query values or header presence only.
- Scope widened at confirmation: the query-param omission is the narrow bug; the missing LST handshake and `realm`
  mean every IBKR call (including no-query `ValidateCredentials`) is expected to 401.
- **C-11 tension (unresolved, for design):** the query-param fix is a bug fix. The LST handshake (RSA-SHA256 request
  signing, Diffie-Hellman exchange, LST derivation/caching/refresh, new encrypted credential fields) is arguably new
  capability that original IBKR feature 001 (`docs/roadmap/features/001-add-ikbr-account-support/`, launched
  2026-05-12, archived) never built — 001 chose the IBKR Web API over Client Portal Gateway for unattended use
  (001 context.md Archive Synthesis) but shipped plain OAuth 1.0a. Design must decide, with operator sign-off,
  whether the LST work stays in this bug track (as completing 001's intended contract) or splits to `/sdd-story`
  per C-11. Record that decision here.
- Recommended design depth: full → `/sdd-design fix-ibkr-request-signing` (rationale: SEV-2; the C-11 scope fork
  above; possible credential-shape change spanning trading/UI/agent plus the `trading.proto:267` shape comment;
  Security review of new key material; LST lifecycle/caching under the IBKR client pool).
- Development branch: feature/fix-ibkr-request-signing

## Session 2026-10-20 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria: PASS WITH WARNINGS (0 fails, 0 floor breaches).
  Overlap: WARN (file-level only, rebase-only).
- Warnings (14). [x] = resolved in product-spec.md / acceptance.feature this session, [ ] = carried to /sdd-design:
  - [x] W1 C-15: no FR-N, ACs tagged `@regression` only. Added `## Functional Requirements` FR-1..FR-4 and tagged
    AC-1 `@FR-3`, AC-2 `@FR-2`, AC-3 `@FR-1`. `@regression` kept. Upstream: the Track C template
    (`.claude/skills/sdd-triage/reference/track-c-sdd.md:99-163`) emits no FR section, which contradicts criteria 2/8. Not fixed here.
  - [x] W2 C-14: Consumer Surface(s). Already present at b3d5f199, so the reviewer read pre-fix text. This session
    states that key material is required, so the UI/agent rows are expected. Existing 4-field accounts cannot
    handshake until `UpdateBrokerAccountCredentials` runs.
  - [x] W3 crit 9: Fix Scope checkboxes resolved and the template line removed. The C-11 fork is now recorded as
    resolved in the spec's Open Questions, per the operator decisions below.
  - [x] W4 crit 5: proto comment-only, non-breaking. Named the `buf lint`/`buf breaking` gate (C-09), `buf-gen.sh`
    proto-freshness, and one `packages/proto` owner.
  - [x] W5 crit 1: added a "Who is blocked" persona line.
  - [x] W6 C-01: impact made precise. Only `ValidateCredentials` yields INVALID (`trading.go:2528`, `:2575`, `:2690`).
    Repro step 3 corrected. Added a Confidence caveat (LST/realm comes from ibind and IBKR docs, not a live 401).
    feature.md Summary corrected to match.
  - [x] W7 stale ref `trading.go:3009-3015`. Already `3084-3097` at b3d5f199.
  - [x] W8a C-15 scenario quality. AC-1/AC-2 now assert independent reference-signer vectors over a fixed
    LST/nonce/timestamp instead of a self-recomputation. AC-3 Given is concrete ("credentials the test IBKR server
    accepts") and its Then asserts OK. Added AC-4 `@FR-4`: LST handshake 401/403 gives INVALID, 503/timeout gives
    UNKNOWN (TRADING-3, `credentialStatusFromError` `trading.go:2951-2960`).
  - [ ] W8b C-15. Still to add at design, as Open Questions in the spec: LST expiry/refresh, concurrent pollers
    sharing one LST, the existing 4-field account, and query-value encoding (`BRK B`). The encoding rule is not
    asserted in the spec: RFC 5849 §3.6 gives `%20` and `url.QueryEscape` gives `+`, and IBKR/ibind behavior is
    unverified, so design confirms the rule before adding a vector.
  - [x] W9 trading C-2: Alpaca (`default` branch, `trading.go:3098-3110`, `alpaca.go` untouched) and OFFLINE
    (no client, `trading.go:256`) are stated unaffected. The prior "separate branches" wording was imprecise.
  - [x] W10 trading C-3: the `httptest` fake plus RFC 5849/ibind vectors is the primary proof. The dev smoke covers
    trading startup and Alpaca/offline. An IBKR paper smoke is secondary.
  - [x] W11 trading C-5: order types, status mapping and PARTIALLY_FILLED/FILLED fill handling are stated unchanged.
  - [x] W12 trading C-1: not triggered. Fix Scope says to re-check C-1/C-05 if key material moves to env/config.
  - [ ] W13 scope sufficiency, carried to design as Open Questions: (a) `/iserver/auth/ssodh/init` and `/tickle`
    brokerage session/keepalive; (b) LST TTL, refresh margin and handshake timeout via `WatchConfig` (C-05/F-07);
    (c) the handshake round trips against `validateAndRecordCredential`'s hardcoded 5s (`trading.go:2603`),
    `IBKRRequestTimeout` (`ibkr.go:46`) and the `trading.order_intent.stale_multiplier` floor.
  - [x] W14 crit 3: Out of Scope now names Alpaca/offline and the IBKR timeout defect
    (`docs/reports/2026-10-19-trading-ibkr-timeout-hardcoded-defect.md`). The brokerage session is pending design (W13a).
- Overlap findings (WARN, no FAIL; no config-key, proto field-number or migration collision):
  - `trading.go` vs 240-offline-account-full-pnl (code-completed): disjoint regions (240: `:49-55`, `:224`,
    ConfirmOrder `:890-943`, `:947-1041`; 249: `ibkrCreds` `:87-92`, decode `:3087`). Textual rebase only.
  - `trading.proto` vs 240: 249 is a comment-only edit in `RegisterBrokerAccountRequest` (`:260-271`); 240 adds
    `ConfirmOrderRequest.fees = 6` and `Order.fees = 23`. Both touch `gen/`, so the second merger re-runs
    `./scripts/buf-gen.sh`.
  - Low-risk context, no collision: agent `tools.py` (249 touches only `manage_account`; 240/241/247 use other
    functions), UI `accountShared.tsx` (no peer), 251/241/250 on other trading.go regions, 084 deploy-level
    credential provisioning (coordinate only if it changes how the IBKR blob is written).
  - Migrations: none. The trading tip is `011` (240); any future 249 migration takes `012`.
  - merge-order.md: no 249 row and none required. Optional soft row: 240 lands first, then 249 rebases. Not written
    (shared file; operator call).
- Operator decisions (as supplied by the workflow orchestrator's task text, recorded verbatim):

  OPERATOR DECISIONS (binding, recorded 2026-10-20):
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Scope = 'IBKR auth never worked' as one defect: sign query params in the base string, implement the Live Session Token (LST) handshake, sign regular requests with the LST, add realm. Operator explicit C-11 override recorded: the LST handshake is in scope of this bug fix, no separate /sdd-story.
  - No live IBKR account is available: verification uses RFC 5849 / ibind reference vectors and an httptest server.

- C-11 tension from the /sdd-triage session: resolved by the decision above. The LST handshake stays in this track.
- Next: `/sdd-design fix-ibkr-request-signing` (full).

## Session 2026-10-21 — sdd-design

- Phase 0 Recon: wrote recon.md (4d9b1022; services: xstockstrat-trading, xstockstrat-agent, xstockstrat-ui;
  key reuse patterns: the single status writer `credentialStatusFromError`/`validateAndRecordCredential`
  (`trading.go:2951`, `:2602`), the `cfgW.GetInt(key, default)` config read (`trading.go:3109`), and
  `singleflight` precedent `marketdata_service.go:15,60`).
- Phase 1 Grilling: 3 rounds (full). Rounds 1-3 ran from scratchpad checkpoints (not committed); design.md is
  their durable record. Termination: auto-approved by the orchestrator under the operator standing
  authorization (rounds 3 >= 2, no F-* breach, no blocking objection, no @AC CHANGE).
- Chosen approach: `authorize(req, sess)` signer (query params in base string, LST-keyed HMAC-SHA256, `realm`
  first) + one `c.do` seam + `singleflight.DoChan` LST handshake incl. `ssodh/init {publish:true, compete:false}`
  + generation-guarded retry-once on 401 (bracket legs excluded) + `reconcileTick` `ErrInvalidCredentials` skip on
  `ListOrders` and `GetPositions` + three `trading.ibkr.*` config keys + key material in the existing encrypted
  blob. Full detail: design.md.
- Rejected: `compete=true` (logs out the account holder's own sessions), transient (UNKNOWN) for deterministic
  failures (feeds systemicCount), resending bracket legs without `cOID`, deterministic leg `cOID` (no resize
  generation exists), tying timing to `IBKRRequestTimeout`, env/config key-material homes. Full list: design.md.
- Constitution rules touched: C-11 (operator override), C-05/F-07, F-08, F-04/P-03, P-01/P-02, C-10, C-13, C-14,
  C-15, C-16, C-17, C-18, C-09, TRADING-3 (widened), TRADING-5. Floor breaches: none.
- Operator decisions (as supplied by the workflow orchestrator's task text, recorded verbatim):

  OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Scope = 'IBKR auth never worked' as one defect: sign query params in the base string, implement the Live Session Token (LST) handshake, sign regular requests with the LST, add realm. Operator explicit C-11 override recorded: the LST handshake is in scope of this bug fix, no separate /sdd-story.
  - No live IBKR account is available: verification uses RFC 5849 / ibind reference vectors and an httptest server.

- Spec amendment in this commit (in-feature, not a durable @AC, so not a C-16 CHANGE):
  - FR-4 (`product-spec.md:43-49`) now names the deterministic INVALID cases: missing/unparseable key material,
    decrypt failure, LST-signature mismatch, init not authenticated. Rationale: deterministic, never heal, and
    UNKNOWN accounts are not skipped by reconciliation (`trading.go:2964-2966`), so UNKNOWN would feed
    systemicCount and can escalate the platform to REDUCE_ONLY.
  - acceptance.feature: AC-4 gains five rows (existing four unchanged, table re-aligned only); AC-5..AC-10 added.
  - TRADING-3 row (`services/xstockstrat-trading/docs/context-constitution.md:21`) and the `broker.go:8` comment
    are edited in the implementation PR (outside this feature dir).
- Decision delegated to design.md: bracket legs are excluded from the 401 resend (no `cOID` at `ibkr.go:261-274`,
  no resize generation in `BracketLegsRequest`); a final 401 takes the alerted FAILED-bracket path
  (`trading.go:3416`, `:3458-3461`).
- Tracked caveat — guessed external contract (`fails.md:481-484`). Unverified, no live account; the replay fake
  only echoes these guesses back:
  - `ssodh/init` body `{publish, compete}` and reply fields `authenticated`/`competing`/`connected`;
  - K serialization (Java `toByteArray` leading-zero rule) and PKCS1v15 vs OAEP for `access_token_secret`;
  - RFC 5849 §3.6 encoding for query values (`BRK B`, `+`, `/`, `~`, `=`);
  - IBKR's reply on a lapsed brokerage session (401 or not).
  The adversary's recollection of ibind (`compete=True`, those reply fields) is unverified and not a source. The
  `/sdd-spec` vector step pins the ibind SHA, date checked and generator command before it can merge.
- Assumption — `compete=false` self-competition cases: (a) DO rolling-deploy overlap of old and new trading
  containers; (b) the ~24h LST refresh re-running init while the prior brokerage session is live. Each may read
  INVALID until the next health poll (default 300000ms), with a badge that suggests rotating keys. Covered by the
  AC-4 `competing:true` row and AC-10 heal.
- Open Threads (from design.md § Open Risks):
  - [ ] Pin ibind SHA/date/generator; pin lapsed-session reply; paper smoke if an account appears — /sdd-spec vector step (step 1).
  - [ ] Non-401 lapsed-session reply → `c.do` re-init trigger, else documented REDUCE_ONLY exception (`trading.go:1991-1994`, `:2153-2154`) — step 3; AC-6 row.
  - [ ] `compete=false` self-competition (deploy overlap, LST refresh) — step 2 fake row; AC-4/AC-10.
  - [ ] Uncertain-resend rule at both classifiers (`trading.go:684`, `:1521`); bracket-leg no-resend — step 3; AC-6.
  - [ ] `/tickle` keepalive follow-up `ibkr-session-keepalive`, blocked by 249; NNN assigned at `/sdd-story` (253 is taken by `253-fix-edgar-companyfacts-decode`) — file after this design.
  - [ ] Fleet-wide INVALID alert: ship one aggregate WARN/notify when every IBKR account reads INVALID in a reconcile tick, or file follow-up `ibkr-fleet-invalid-alert` — /sdd-spec decides.
  - [ ] gitleaks: scoped allowlist (unique-substring regex in the `"line"` table, or `[[allowlists]]` paths AND regex if gitleaks-action@v3 bundles >= 8.21, `ci.yml:754`); local `gitleaks detect` — step 1.
  - [ ] Boot budget: handshake + init + `ListOrders` vs 5s `brokerCallTimeout` on first tick — step 2 test.
  - [ ] Config keys `trading.ibkr.{lst_refresh_margin_ms,handshake_timeout_ms,reauth_min_interval_ms}` need owner + config-team approval — step 5.
  - [ ] Private keys in UI textareas — Security review, step 7.
  - [ ] Re-grep feature-102/206 suites: no durable @AC asserts a credential-rejected `ListOrders`/`GetPositions` is systemic — /sdd-spec.
  - [ ] Accepted: a 403 permission error on an `/iserver` order call also skips the systemic count for that tick.
- Status: spec-ready → design-approved.

## Session 2026-10-21 — sdd-spec

- Generated implementation-spec.md with 17 steps. Status: design-approved → implementation-ready.
- Prior progress check (user asked "What happened to the prior progress?"): nothing was lost. Story, review, recon
  and design are all on `origin/feature/fix-ibkr-request-signing` (b3d5f199, 280ae4d9, 4d9b1022, bae5e125,
  df13ed8a). No implementation-spec.md existed before this session.
- Key codebase findings:
  - All 11 `signRequest` call sites and the `ibkr.go:580-627` internals re-verified unchanged. `ibkrCreds` is at
    `trading.go:86-92`.
  - The register IBKR validation slot is `trading.go:2496`→`:2500`. The update slot is after the offline guard
    `:2549`, before `:2552`; the broker type is known only after `GetBrokerAccount`.
  - Only two uncertain classifiers exist (`trading.go:684`, `:1521`). The spec extracts `isUncertainBrokerOutcome`
    and adds `broker.ErrOutcomeUncertain` for the post-401 uncertain-resend rule.
  - reconcileTick systemic increments are at `:1991-1994` and `:2076-2079`. Re-grep result: no durable suite
    asserts a credential-rejected call is systemic, and no feature-102 suite exists (closes the design Open Thread).
  - Service fake to extend: `fakeAccountRepo` (`trading_bracket_test.go:471`, has `listActiveFn` for
    `LoadBrokerPool`). Config test seam: `config.NewSnapshotWatcher` (`config.go:249`).
  - The trading config keys follow feature 102's unseeded consumed-with-default pattern
    (`config-governance.md:610-622`). No config-service change.
- Spec-time reference pins from ibind @ `759ec3a127accfb03e76bcd54856d1421d986e6a` (master, 2026-10-06), read
  2026-10-21. These settle design.md's delegated pins (implementation-spec.md § Execution Summary):
  - Encoding is `quote_plus` once over the raw joined `k=v` string, which equals Go `url.QueryEscape`. This
    corrects design.md §1's "RFC 5849 §3.6 oauthEncode / QueryEscape removed" wording; §1's "pinned by ibind
    vectors" clause governs.
  - No `oauth_version`. The header is `realm` first, then pairs sorted by key; the signature value is
    `quote_plus`-encoded.
  - PKCS#1 v1.5 decrypt; the `to_byte_array` leading-zero rule; the LST-signature check is
    `hex(HMAC-SHA1(LST, consumer_key))`.
  - The `ssodh/init` body is `{publish, compete}`. ibind defaults to `compete=True`; this feature keeps `false`.
  - The lapsed brokerage session is HTTP 400 `no bridge` (`ibkr_client.py:139-143`), now a `c.do` re-init
    trigger (AC-6 row 7). This closes the "pin lapsed-session reply" thread.
- Decisions:
  - D-spec-1: fleet-wide INVALID alert → tracked follow-up `ibkr-fleet-invalid-alert` (C-18/YAGNI), not in scope.
  - D-spec-2: gitleaks takes a unique key-body substring regex in the existing `"line"` table. The fallback is an
    `[[allowlists]]` AND block, only after confirming the version bundled by `gitleaks-action@v3`.
  - D-spec-3: AC-8 and AC-6 row 5 are verified via an extracted `isUncertainBrokerOutcome` predicate. A full
    `PlaceOrder` harness is blocked by the concrete `s.repo`.
- Open Threads (new):
  - [ ] **Operator ruling needed before the integration PR merges.** ibind signs regular requests WITHOUT query
    params: `_get_headers` passes no `request_params` (`ibkr_client.py:146-158`), and the URL excludes them
    (`rest_client.py:226-231`). FR-3 and the binding operator scope require including them, and the spec follows
    FR-3. If IBKR mirrors ibind, every GET with a query 401s. The inclusion is isolated in `buildBaseString`
    (Step 2). A paper smoke decides.
  - [ ] File follow-up `ibkr-fleet-invalid-alert` via `/sdd-story` (alongside `ibkr-session-keepalive`).
  - [ ] Possible staticcheck SA1019 on `rsa.DecryptPKCS1v15` → scoped `//nolint` stating the protocol constraint
    (Step 4).
- Operator decisions (as supplied by the workflow orchestrator's task text, recorded verbatim):

  OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Scope = 'IBKR auth never worked' as one defect: sign query params in the base string, implement the Live Session Token (LST) handshake, sign regular requests with the LST, add realm. Operator explicit C-11 override recorded: the LST handshake is in scope of this bug fix, no separate /sdd-story.
  - No live IBKR account is available: verification uses RFC 5849 / ibind reference vectors and an httptest server.

## Session 2026-10-21 — sdd-review impl-spec (advisory)

- Result: criteria FAIL (2 fails, 9 warnings, 0 floor breaches); overlap WARN. Advisory; lifecycle unchanged
  (`implementation-ready`). Findings verified against `origin/feature/fix-ibkr-request-signing` @ aad0d1e9.
- Prior progress (user asked "What happened to the prior progress?"): nothing lost. The reviewer read a stale
  worktree, `/home/user/xs-feat/249-fix-ibkr-request-signing`, at 4d9b1022 (`status.md` = `spec-ready`, recon only).
  The branch holds design (bae5e125, df13ed8a) and the spec (aad0d1e9). Its `acceptance.feature` has `@AC-1..@AC-10`
  (each `@FR-N`), AC-4 has 9 rows and AC-6 has 7, and `design.md` is present.
- Addressed in implementation-spec.md:
  - [x] FAIL C-15/C-01 (AC-5..AC-10, AC-4 9 rows, AC-6 7 rows, design.md): cleared, stale input. No edit needed.
    The branch `acceptance.feature:7-123` matches the Scenario Coverage table.
  - [x] FAIL B2 Step 12 directory in **Files**: listed the 5 generated paths
    (`grep -rl access_token_secret packages/proto/gen/`). No Python stub carries comments. Staging is limited to
    those paths (F-08), and verification diffs `--name-only`.
  - [x] WARN Step 6 session-error classification: the flatten moved inside `do`. A non-sentinel `ensureSession`,
    re-ensure or `reinit` error becomes `%v` there; `ErrInvalidCredentials` stays `%w`. Callers wrap `%w` unchanged.
    The dangling "step 5" cross-reference is gone. Safety: `credentialStatusFromError` (`trading.go:2951-2960`)
    checks the sentinel only, and the only deadline classifiers are `:684` and `:1521`.
  - [x] WARN Step Dependencies: added "Steps 7 and 9 require Step 5" (`IBKRAuthHandler`).
  - [x] WARN Step 9 coverage: added the COVERPKGS ≥ 40% command (`ci.yml:256-257`).
  - [x] WARN Step 17 `docs/ibkr.md` evidence: two sections (`:5-16`, `:18-22`). The new section is appended after `:22`.
  - [x] WARN C-18 joiner re-call rule: confirmed in design.md §2 (`:59-61`) and C-18 (`:301-302`). Step 4 cites
    both and says why it is not redundant (transient-only, versus the sentinel-only negative cache and throttle).
  - [x] WARN FR-3 vs ibind, partly addressed: the spec now says the AC-1 vectors prove self-consistency only, moves the
    operator gate to the Step 2 checkpoint (an explicit deferral to merge is allowed and must be recorded), and says
    how the paper smoke decides (query `GetOrder` versus no-query `ValidateCredentials`).
  - [x] WARN Step 1 gitleaks: both gitleaks commands are now mandatory. The `regexTarget = "line"` vs multi-line
    `private-key` uncertainty is stated (`.gitleaks.toml:34`).
  - [x] Overlap `config-governance.md`: Step 10 notes 240 (same top slot) and 243 (Author-sentinel `:93-103`), with a
    re-read at execute time.
  - No action needed (reviewer-confirmed): broker symmetry note; code-grounded anchors.
- Still open, carried into execution (`/sdd-execute` announces these at each checkpoint, C-02/P-03):
  - [ ] Step 2: **operator ruling** on FR-3 (include query params) vs ibind (exclude). Due at the Step 2 checkpoint,
    or an explicit recorded deferral to the integration-PR merge. No live account exists, so tests cannot decide it.
  - [ ] Step 1: 7 files, over the advisory 5-file limit. Kept whole (the gitleaks scope exists only for these PEMs);
    the executor may split gitleaks + PEMs from the generator + loader. Advisory, operator's call.
  - [ ] Overlap, rebase-only: `trading.go` and `trading.proto`/gen vs 240 (whichever merges second re-runs
    `./scripts/buf-gen.sh`); trading `CLAUDE.md` vs 240 (other sections); `tools.py`/`mcp-tools.md` vs 215 (other
    regions); `config-governance.md` vs 240/243 (Step 10 note).
- Overlap findings: WARN, file-level only. No migration, proto field-number or config-key collision.

## Session 2026-10-28 — re-spec (sdd-batch-execute pre-flight)

- Merged `origin/main-dev` into the feature branch (`-X ours`, 40de843c). Re-spec of step bodies 1, 4, 6, 7, 15 only;
  line drift, substance unchanged. Commit `respec(fix-ibkr-request-signing): align steps 1,4,6,7,15 with current codebase`.
  - Step 1: `gitleaks-action@v3` now `ci.yml:767`; trufflehog `:750`, `--only-verified` `extra_args` `:762`.
    gitleaks is installed at `~/go/bin/gitleaks`, so the two mandatory gitleaks commands can run on this host.
    `.gitleaks.toml:33-40` unchanged; `internal/testdata/` unchanged; `ibkr/` fixtures still absent.
  - Step 4: PEM-parse precedent is now `load()` at `internal/mtls/mtls.go:22-41`. Other anchors verified.
  - Step 6: the `DeadlineExceeded\|Timeout()` grep also hits `trading.go:1973`, `:2377`, `:2440`
    (`brokerCallTimeout()`) and `alpaca.go:67`; only `:684`/`:1521` classify errors, so the conclusion holds.
  - Step 7: `TestReplaceOrder_IBKR`'s header assertion is `if gotAuth == ""` at `ibkr_test.go:323` (`:285` is the
    func declaration).
  - Step 15: `tools.py` anchors shifted ~+14: `manage_account` `:2153`, IBKR docstring `:2175-2177`,
    update_credentials sentence `:2179-2181`, non-empty checks `:2191-2214`; runbook row `mcp-tools.md:1392`.

## Session 2026-10-28 — sdd-execute sequential (sdd-batch-execute)

- Status: `implementation-ready` → `in-progress`. Mode: sequential (one commit per step on
  `feature/fix-ibkr-request-signing`, single integration PR at the end). Severity SEV-2.
- Up-front confirmation: the operator approved the up-front plan by standing authorization (operator chat 2026-10-28,
  session_01NpS3HShZK6pSnogA7CFo2f: "Start executing features 241-276" via batch-execute). Answers: unattended
  checkpoints (checkpoints = `report`); C-16 promotion auto-confirmed unless it changes an existing `@AC` rule;
  merge-train authorized; 255/275 deferred. Operator-only DB/prod steps: open the PR, hold the merge.
- Branch setup (§5.3): `origin/main-dev` merged with `-X ours` (40de843c); step bodies 1, 4, 6, 7, 15 re-spec'd
  (session entry above).
- Still owed (carried): the FR-3 operator ruling at the Step 2 checkpoint, or a recorded deferral to the
  integration-PR merge.
