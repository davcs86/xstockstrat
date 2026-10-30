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

## Session 2026-10-29 — sdd-execute sequential, Step 1

- Step 1 done: `internal/testdata/ibkr/` (two committed 2048-bit RSA test keys, RFC 3526 group-14 `dhparam.pem`,
  `gen_vectors.py`, generated `vectors.json`) and `internal/testdata/ibkr.go` (`IBKRSignatureKeyPEM`,
  `IBKREncryptionKeyPEM`, `IBKRDHParamPEM`, `MustIBKRVectors()`). TDD N/A (fixture data).
- Operator decision (2026-10-29, session question tool, "Yes, run both"): Option A, the `.gitleaks.toml`
  `[allowlist]` gains a `paths` entry for exactly `.../testdata/ibkr/vectors.json`; the comment block names it as
  generated test data with no real secrets. Recorded in the spec's Deviation Log.
- Verification: `go vet`/`go test ./internal/testdata/` pass; a throwaway test confirmed `MustIBKRVectors()`
  decodes (14 request vectors, 2 DH cases, non-empty PEMs). `gitleaks dir .../ibkr` → no leaks found; a fresh key
  is still detected both standalone and when dropped inside `ibkr/` (exit 1). Regeneration with pycryptodome 4.2.0
  from ibind `759ec3a1` is byte-identical.
- The root `.gitignore:55` ignores `*.pem`; the three fixture PEMs are force-added (`git add -f`), `.gitignore`
  unchanged (Deviation Log).
- Carried to Step 4: pycryptodome 4.2.0 returns empty bytes for a wrong-key PKCS#1 v1.5 decrypt, so the Go decrypt
  must fail closed on an empty plaintext.
- Still owed: the FR-3 operator ruling at the Step 2 checkpoint (or a recorded deferral to the integration-PR merge).

## Session 2026-10-29 — sdd-execute sequential, Steps 2 + 3

- Steps 2 and 3 done in **one commit** by operator decision (session question tool, 2026-10-29: "A: Steps 2+3
  together (Recommended)"). Recorded in the spec's Deviation Log.
- `ibkr.go`: `IBKRConfig` gains the `Now`/`Nonce`/`DHRandom` seams, with defaults set in `NewIBKRClient` (16-char
  alnum nonce and 256-bit DH random, both from `crypto/rand`). It also gains `ibkrRealm = "limited_poa"`,
  `oauthEncode` (`url.QueryEscape`), `oauthParams`, `buildBaseString`, `authorizeHeader`, `authorize` (HMAC-SHA256
  keyed by the LST) and `authorizeLST` (RSA-SHA256 PKCS#1 v1.5 over `prepend + baseString`). `signRequest` and its 11
  call sites are untouched; Step 6 deletes them.
- `ibkr_sign_internal_test.go` (package `broker`): `TestIBKRAuthorize_GETQueryParamsSigned` (AC-1),
  `_LSTKeyedAndRealm` (AC-2), `_EncodingPinned` (`BRK B` and the `%2B`/`%2F`/`%3D` signature) and
  `TestIBKRAuthorizeLST_RSAVector`. All fixtures come from `testdata.MustIBKRVectors()`. RED: compile failure; GREEN:
  pass.
- **FR-3 operator ruling (closes the "Still owed" item):** operator, 2026-10-29: "Include params (FR-3)". This is
  the final ruling and it does not hold the integration-PR merge. Query params stay in the signature base string,
  which deviates from ibind. The single inclusion point is `buildBaseString`.
- Verification: `go build ./...` and `go vet ./...` clean. golangci-lint v2.14.0 reports 0 issues; it was rebuilt
  with go1.27, because the provisioned binary was built with go1.26 and rejects the `go 1.27.0` module (Deviation
  Log). `go test ./... -race` passes with COVERPKGS total coverage 73.1%. `oauth_version` appears only in
  `signRequest`. No vector nonce literal appears in any `_test.go`.
- Carried to Step 4: the Go decrypt must fail closed on an empty plaintext (from Step 1).

## Session 2026-10-29 — sdd-execute sequential, Steps 4 + 5

- Steps 4 and 5 done in **one commit** under the standing operator rule (session question tool, 2026-10-29: "Merge
  pairs + standing rule"). Step 4's unexported session symbols have no consumer before Step 5's tests. Recorded in
  the spec's Deviation Log.
- `ibkr.go`: `IBKRConfig` gains `SignatureKey`, `EncryptionKey`, `DHPrime` (PEM) and `Timing func() IBKRTiming`.
  `NewIBKRClient` parses them once (PKCS#1 then PKCS#8 RSA; a `DH PARAMETERS` block via `asn1`) and retains
  `credErr` naming the field only. The constructor signature is unchanged.
- `ibkr_session.go` holds `IBKRTiming` (nil `Timing` defaults to 60s/10s/30s), the embedded `ibkrSessionState`,
  and these functions:
  - `ensureSession` uses `singleflight.DoChan("lst")` with a detached leader ctx, a negative cache and the joiner
    re-call rule;
  - `handshake`, `mintLST` (PKCS#1 v1.5 decrypt with a scoped `//nolint:staticcheck`; an empty plaintext fails
    closed) and `computeLST` (Java `toByteArray`);
  - `initBrokerage` (`{"publish":true,"compete":false}`), `invalidate(gen)` and `reinit(ctx, gen)` (flight key
    `"init"`).
  `golang.org/x/sync` is now a direct requirement.
- `internal/testdata/ibkr.go` adds `IBKRAuthHandler` (vector replay, `Strict`, `SetOverride`, `Requests`/`Count`,
  `Next`), plus `IBKRLSTPath`/`IBKRInitPath`, `IBKRLSTReplyJSON`, `IBKRInitReplyJSON` and `IBKRHeaderParam`.
- `ibkr_session_internal_test.go` covers all eight Step 5 tests plus `TestInvalidate_GenerationGuardAndThrottle` and
  `TestReinit_RerunsInitOnly`. AC-3 red: compile failure (`ensureSession` undefined); green: the strict LST header
  equals vector (a) and the LST equals vector (b). AC-4, AC-5 and AC-10 red: compile failure; green: all rows pass.
- Verification: `go build`/`go vet` clean; golangci-lint v2.14.0 (rebuilt with go1.27) reports 0 issues. `go test
  ./... -race` passes with COVERPKGS total 76.1%, and the session tests are stable at `-count=20`. The `x/sync`
  grep shows no `// indirect`. `compete` appears only as `compete:false` and `limited_poa` only as the realm
  constant. The PEM-interpolation grep and the inline-fake grep both find nothing.
- Open item for Step 7: the strict handler matches signatures over the vector base URL. `package broker_test`
  cannot swap `httpClient`, so Step 7 needs a way to route `https://api.ibkr.com/v1/api` to the test server, for
  example an exported transport seam. Decide at Step 6/7.

## Session 2026-10-29 — sdd-execute sequential, Steps 6 + 7

### Steps 6 + 7 — `c.do` send seam + wire-level/retry tests [done]
- One commit under the standing operator rule ("Merge pairs + standing rule"). Step 6's RED test is Step 7's, and
  Step 6 breaks the existing IBKR fakes that Step 7 migrates. Recorded in the spec's Deviation Log.
- `broker.go`: reworded the `ErrInvalidCredentials` doc and added `ErrOutcomeUncertain`.
- `ibkr_session.go` adds `do(req, op, noResend)`:
  - session errors are flattened `%v` in one closure, and only the sentinel keeps `%w`;
  - a 401 is final when the session was just minted or `noResend` is set;
  - otherwise a stale generation resends with the current session, and a successful `invalidate` re-handshakes and
    resends once with a rebuilt body (`GetBody`);
  - a 400 `no bridge` on `/iserver/` runs `reinit` and resends once;
  - a failed resend of a POST/DELETE after a 401 is `ErrOutcomeUncertain`;
  - a final 401/403 is the wrapped sentinel.
  `do` uses the new helpers `currentSession`, `sendSigned` and `ibkrFinalAuthErr`.
- `ibkr.go`: all 11 sign+Do pairs are now `c.do`, with `noResend=true` only for `SubmitBracketLegs`.
  `ValidateCredentials` is `c.do` plus a 200 check. `signRequest` (and with it the `"&"+secret` key) is deleted.
- Tests:
  - `ibkr_do_test.go` adds AC-1 strict `GetOrder`, AC-2 strict GET/POST/DELETE, the AC-6 7-row matrix plus the
    generation-guard and throttle subtests, and AC-8 (LST 503 and blocked past `HandshakeTimeout`: no order POST,
    not a timeout, not uncertain).
  - `ibkr_test.go`/`ibkr_reply_test.go` now run every server behind `testdata.IBKRAuthHandler{Next: …}` with
    `ibkrTestConfig`. `TestReplaceOrder_IBKR` asserts the realm prefix, and `TestGetOrder_IBKRPartialFill` was
    added.
- TDD:
  - AC-1 red: `GetOrder: status 401` (strict handler rejects the legacy signature) → green: header equals vector.
  - AC-2 red: realm missing → green.
  - AC-6 red: every row fails, since a 401 was never retried and there was no `ErrOutcomeUncertain` → green.
  - AC-8 red: `order POSTs = 1, want none` → green.
  - RED was taken with a temporary uncommitted shim declaring only `ErrOutcomeUncertain`, after a plain compile
    failure.
- Verification:
  - `go build`/`go vet` are clean, and golangci-lint v2.14.0 (rebuilt with go1.27, `GOWORK=off`) reports 0 issues.
  - `go test ./... -race` passes, with COVERPKGS total 78.3%, and the broker package is stable at `-count=10`.
  - The greps show no `signRequest`, `c.do(` × 11, `session: %v` only inside `do`, no `TRADING_MODE`, and one
    `IBKRAuthHandler` declaration.
- Files modified: `services/xstockstrat-trading/internal/broker/{broker.go,ibkr.go,ibkr_session.go,ibkr_test.go,
  ibkr_reply_test.go,ibkr_do_test.go}`.
- Deviations: steps merged (standing rule). There were also notes with no spec change: the strict tests swap
  `http.DefaultTransport`, which resolves the Steps 4+5 open item; some helpers are not named in the spec; and the
  literal readings of the 401-only uncertain rule and the 401-only `noResend`.
- Open items:
  - A 2xx reply that carries a duplicate-`cOID` error is not classified as uncertain, because the reply format is
    unpinned. Only a non-2xx resend is uncertain.
  - Steps 8/9 consume `ErrOutcomeUncertain` (`trading.go:684`/`:1521`).


## Session 2026-10-29 — sdd-execute sequential, Steps 8 + 9

### Steps 8 + 9 — trading plumbing + service-level tests [done]
- One commit under the standing operator rule ("Merge pairs + standing rule"). Step 8's RED test is Step 9's.
  Recorded in the spec's Deviation Log.
- `trading.go` changes:
  - `ibkrCreds` gains `signature_key`, `encryption_key` and `dh_prime`. `instantiateBrokerLocked` passes them, plus
    `Timing: s.ibkrTiming`, into `broker.IBKRConfig`. Instantiation stays tolerant.
  - `ibkrTiming` sits next to `brokerCallTimeout`. It reads `trading.ibkr.lst_refresh_margin_ms` (60000),
    `handshake_timeout_ms` (10000) and `reauth_min_interval_ms` (30000) live, with `≤0 → default`.
  - `validateIBKRCreds` returns `InvalidArgument` naming the missing fields and never echoes a value.
    `RegisterBrokerAccount` calls it only for IBKR (after `json.Valid`), and `UpdateBrokerAccountCredentials` calls it
    only for IBKR records (after the offline guard).
  - `isUncertainBrokerOutcome` (timeout, `net.Error` timeout, or `broker.ErrOutcomeUncertain`) replaces both
    inline classifiers, in `SubmitOrder` and `ReplaceOrder`.
  - `reconcileTick` skips an account whose `ListOrders`/`GetPositions` returns `ErrInvalidCredentials`. It logs a
    WARN with `call` and does not count the account as systemic.
- `credentialStatusFromError`, `validateAndRecordCredential` and the paper/live gate are unchanged.
- Tests:
  - `trading_ibkr_auth_test.go` (new) covers AC-3 (strict), AC-4 (9 rows), AC-5, AC-7 (register + update × 3
    fields), `TestIsUncertainBrokerOutcome` (AC-8 / AC-6 row 5), AC-9 (2 rows) and AC-10.
  - `fakeAccountRepo` gains `statusWrites` through `UpdateCredentialStatus`.
- TDD: RED was a compile failure, then behavioral failures (AC-7, AC-8, AC-9, AC-10, and a 5s `lst_timeout`) under
  a temporary, uncommitted shim. GREEN: all pass with `-race`.
- Verification:
  - `go build` and `go vet` are clean, and golangci-lint v2.14.0 (rebuilt with go1.27, `GOWORK=off`) reports
    0 issues.
  - `go test ./... -race` passes, with COVERPKGS total 78.7%.
  - The greps show three `trading.ibkr.*` `GetInt` reads, `isUncertainBrokerOutcome` defined once with 2 call sites,
    `environmentIsPaper` untouched, and one `statusWrites` declaration.
- Files modified: `services/xstockstrat-trading/internal/service/{trading.go,trading_bracket_test.go,
  trading_ibkr_auth_test.go}`.
- Open items:
  - The husky hook is not installed in this environment: `.husky/_` is absent and there is no root `node_modules`.
    The hook's only gating checks are scoped to the UI.
  - Step 10 must register the three `trading.ibkr.*` keys that Step 8 now reads.

## Session 2026-10-29 — sdd-execute sequential, Step 10

### Step 10 — config: register `trading.ibkr.*` keys [done]
- `services/xstockstrat-trading/CLAUDE.md`: three `int` rows after `trading.broker.timeout_ms` —
  `trading.ibkr.lst_refresh_margin_ms` (60000), `trading.ibkr.handshake_timeout_ms` (10000),
  `trading.ibkr.reauth_min_interval_ms` (30000); read live per handshake, `<= 0` reads as the default.
- `docs/patterns/config-governance.md`: `### feature 249 — fix-ibkr-request-signing (`xstockstrat-trading`)` prepended
  as the newest Per-Feature Registered Keys entry. On this branch the previous top entry is feature 240 (features 264
  and 248 have not merged here), so 249 sits directly above 240. Unseeded (feature 102 precedent), no
  `SCALAR_BOUNDS_REGISTRY` entry, not tied to `IBKRRequestTimeout`.
- Spec line refs had drifted (log header, feature 102 precedent now at `:610`); placement followed the spec's
  re-read instruction. No key-name collision.
- TDD: N/A (docs/config registration). Verification: the grep shows each key with the same default in `CLAUDE.md`,
  `config-governance.md` and `trading.go` (`ibkrTiming`, Step 8).
- Files modified: `services/xstockstrat-trading/CLAUDE.md`, `docs/patterns/config-governance.md`.
- Open item: when features 264/248 merge with this branch, keep the log newest-first (rebase only, append-only).

## Session 2026-10-29 — sdd-execute sequential, Step 11

### Step 11 — proto: comment-only IBKR `credentials_json` shape [done]
- `packages/proto/trading/v1/trading.proto`: the `RegisterBrokerAccountRequest` IBKR comment line now lists all
  7 keys (`consumer_key`, `access_token`, `access_token_secret`, `ibkr_account_id`, `signature_key` and
  `encryption_key` as PEM RSA private keys, `dh_prime` as PEM DH parameters). It wraps over three `//` lines. No field
  number, type or name changed (C-09). The `UpdateBrokerAccountCredentialsRequest` "same shape" comment needs no edit.
- TDD: N/A (proto comment). Verification: `buf lint` is clean, and `buf breaking` returns 0 against a `git archive`
  tarball of `origin/feature/fix-ibkr-request-signing:packages/proto` (`#subdir=packages/proto`). The worktree
  sandbox refuses the spec's `<repo-root>/.git#branch=…` form, so this fallback is in the Deviation Log.
- Files modified: `packages/proto/trading/v1/trading.proto`.
- Open item: the CI `proto-freshness` gate fails until Step 12 regenerates the 5 `gen/` stubs that carry this comment.

## Session 2026-10-29 — sdd-execute sequential, Step 12

### Step 12 — proto-gen: regenerate stubs [done]
- `./scripts/buf-gen.sh` regenerated the IBKR `credentials_json` comment into exactly the 5 listed stubs.
  `gen/go/trading/v1/trading.pb.go`, `gen/ts/trading/v1/trading_pb.ts`, `gen/ts/trading/v1/trading.ts`,
  `gen/ts/dist/trading/v1/trading_pb.d.ts` and `gen/ts/dist/trading/v1/trading.d.ts` changed. Every diff line is
  comment-only. Python stubs and descriptors are unchanged.
- Toolchain: the host `~/go/bin` Go plugins were built with go1.24.7 and reflowed a comment in
  `gen/go/analysis/v1/analysis.pb.go`. That is unrelated churn, so it was discarded. The pinned plugins were rebuilt
  with go1.27.0 (the CI `proto-freshness` Go) into a scratch `GOBIN`. `pnpm install --frozen-lockfile` supplied the
  pinned `tsc`. This is recorded in the Deviation Log (CI-equivalent fallback). No repo pin changed.
- TDD: N/A (codegen). Verification: `git diff --name-only packages/proto/gen/` lists exactly the 5 paths, and the
  non-comment changed-line grep is empty.
- Files modified: the 5 `gen/` stubs above.
- Open item (for the host, not the repo): rebuild `~/go/bin` protoc plugins with Go 1.27, or later regenerations will
  reintroduce the `analysis.pb.go` comment drift.


## Session 2026-10-29 — sdd-execute sequential, Steps 13 + 14

### Steps 13 + 14 — `/trader` IBKR credential form + e2e [done, one commit]
- Merged under the standing operator rule ("Merge pairs + standing rule"): Step 13's RED test is Step 14's e2e.
  Operator decision 2026-10-30, in their own words: "B: Keep native" — the PEM `Textarea`s keep native `required`
  (no `noValidate`), so Step 14 instruction 3 now asserts the `Encryption key (PEM)` textarea is `:invalid` with a
  non-empty `validationMessage`, the dialog stays open and no `RegisterBrokerAccount` request is sent. `FieldError`
  is wired under every credential input but not e2e-asserted (it cannot render while native validation blocks).
- `accountShared.tsx`: `CredentialState`/`EMPTY_CREDENTIALS` gain `signatureKey`/`encryptionKey`/`dhPrime`;
  `CREDENTIAL_KEYS` drives both forms' `useWatch`, `handleCredsChange` and (via `credsFromWatch`) creds maps;
  IBKR `credentials_json` carries 7 keys; the IBKR schema requires the 3 new fields; `CredentialFields` renders from
  `IBKR_INPUTS`/`ALPACA_INPUTS` (PEM rows are `Textarea` with `autoComplete="off"`, `spellCheck={false}`,
  `required`, `rows={4}`), each in `Field` + `FieldError`, with an optional `errors` prop fed `formState.errors` by
  both forms. Edit-form copy adds the IBKR seven-values sentence. Offline branches unchanged in behaviour.
- e2e: `IBKR_TEST_CREDENTIALS_INPUT` fixture (PEM-shaped `-----BEGIN TEST-----` placeholders, no gitleaks rule) +
  INVENTORY row; `account-selector.spec.ts` adds AC-7 register (exact 7-key blob, PEM newlines), AC-7 blocked submit,
  IBKR Edit keys no-echo + 7-key save, and the Add-form Offline guard. Placeholders use `exact: true`.
- TDD: RED (pre-Step-13 build) — the 3 IBKR tests fail waiting for `Signature key (PEM)`; GREEN — 20 passed across
  `account-selector.spec.ts` and `offline-accounts.spec.ts` (`CI=1`, `--retries=0`).
- Verification: `pnpm run lint` no errors; `lint:dup` 0 clones; color-literal grep empty; vitest 237/237;
  `tsc --noEmit` clean for changed files (two pre-existing errors in untouched `e2e/insights/backfills.spec.ts:135-136`).
- Files modified: `services/xstockstrat-ui/src/components/trader/accountShared.tsx`,
  `services/xstockstrat-ui/e2e/trader/account-selector.spec.ts`, `services/xstockstrat-ui/e2e/fixtures/accounts.ts`,
  `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`.
- Open items: `backfills.spec.ts` tsc errors pre-exist (not this feature); local `pnpm dev` first-hit compile times
  out the 10s warm-up in this sandbox, so e2e ran on the `CI=1` production build.


## Session 2026-10-29 — sdd-execute sequential, Steps 15 + 16

### Steps 15 + 16 — agent `manage_account` IBKR shape + tests [done, one commit]
- Merged under the standing operator rule ("Merge pairs + standing rule"): Step 15's RED test is Step 16's docstring
  assertion.
- `tools.py` `manage_account` docstring: the IBKR blob lists 7 keys (the last three are PEM strings), and
  update_credentials names the incomplete-IBKR `INVALID_ARGUMENT`. Validation, parameters and return shape are
  unchanged; trading stays the only validator (C-10). `mcp-tools.md:1392` row carries the same shape.
- Tests: `_assert_no_credentials` also rejects `consumer_key`/`access_token`/`signature_key`/`encryption_key`/
  `dh_prime`/`BEGIN`; new `test_update_broker_account_credentials_ibkr_seven_fields_forwarded_and_hidden`,
  `test_update_credentials_ibkr_incomplete_maps_invalid_argument` (@AC-7) and
  `test_manage_account_docstring_lists_ibkr_key_material`.
- TDD: AC-7 red: `'signature_key' in description` failed → green: 520 passed, coverage 81.23%.
- Verification: `ruff check .` and `ruff format --check .` clean; `grep signature_key` hits both files.
- Files modified: `services/xstockstrat-agent/app/tools.py`, `docs/runbooks/mcp-tools.md`,
  `services/xstockstrat-agent/tests/test_broker_account_client.py`,
  `services/xstockstrat-agent/tests/test_account_tools.py`.
- Open item: the runbook's `update_credentials` bullet and `**Errors:**` line do not yet mention the incomplete-IBKR
  `INVALID_ARGUMENT` (Step 15 instruction 3 limits the edit to the row). Step 17 or a later pass may add it.

## Session 2026-10-29 — sdd-execute sequential, Step 17

### Step 17 — docs: IBKR auth docs, TRADING-3 widening, findings closure, teardown [done]
- `services/xstockstrat-trading/docs/ibkr.md` gains the section `### IBKR: OAuth 1.0a + Live Session Token (feature 249)`.
  It covers:
  - the 7-field blob and the legacy 4-field INVALID behaviour;
  - the handshake order (LST, then `ssodh/init` with `compete=false`) and the negative cache;
  - LST-keyed HMAC-SHA256 with `realm="limited_poa"` and the ibind-pinned `QueryEscape` encoding;
  - the 401/no-bridge retry rule, the bracket-leg `noResend` and `ErrOutcomeUncertain`;
  - the three `trading.ibkr.*` keys;
  - the unverified-contract caveat (ibind @ `759ec3a1…`) and the FR-3 ruling ("Include params (FR-3)");
  - the follow-ups `ibkr-session-keepalive` and `ibkr-fleet-invalid-alert`.
  The two existing sections are unchanged.
- Trading `CLAUDE.md` credential-health paragraph: for IBKR, the LST handshake and `ssodh/init` now run before
  `GET /portfolio/accounts`, and a legacy 4-field account reads INVALID until it is updated.
- TRADING-3 is widened: HTTP 401/403, or deterministically unusable credentials, from any IBKR call. The Why gains
  the converse risk, and the anchors are re-stamped (`credentialStatusFromError` ~L3020, the IBKR sentinel sites in
  `ibkr_session.go`, and the `reconcileTick` skip).
- Findings:
  - The `signRequest` query-param open question is removed from Open questions and recorded under Resolved
    (feature 249). It cites `do` ~L362, `authorize` ~L644 and `buildBaseString` ~L600.
  - The stale `instantiateBrokerLocked (~L3027)` anchors in the IBKR timeout and accessor-mismatch rows are fixed.
- Teardown: the context-forge `context-constitution` refresh skill is unavailable. A manual reconciliation of the
  Steps 10/15/17 context files against the code found no further drift (details in the spec's Deviation Log). **The
  integration PR body must state both that the plugin was unavailable and what manual reconciliation was done.**
- TDD: N/A (docs). Verification: all three greps hit (`ibkr.md` lines 30-47; the TRADING-3 count is 1; findings
  `:50`).
- Files modified: `services/xstockstrat-trading/{docs/ibkr.md,CLAUDE.md,docs/context-constitution.md,
  docs/context-constitution-findings.md}`.
- Open items:
  - The paper smoke against a real IBKR account (FR-3 vs ibind; unverified contract).
  - The `mcp-tools.md` `update_credentials`/Errors lines (from Steps 15+16).
  - Defect report sidecar resolution at launch.

