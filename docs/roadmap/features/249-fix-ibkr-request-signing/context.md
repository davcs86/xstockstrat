# Context: fix-ibkr-request-signing  (archived 2026-11-04)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-04 — /sdd-archiver

**What**: Bug fix (SEV-2) that grew into "IBKR auth never worked". `IBKRClient` used generic OAuth 1.0a (query params
unsigned, HMAC key `"&"+access_token_secret`, no `realm`, no Live Session Token). It now runs the full IBKR flow in
`services/xstockstrat-trading/internal/broker/`: RSA-SHA256 LST handshake with a DH challenge, `ssodh/init
{publish:true, compete:false}`, LST-keyed HMAC-SHA256 signing with `realm="limited_poa"`, one `c.do` send seam
(`ibkr_session.go:362`) with a generation-guarded retry-once on 401, and a 7-field encrypted credential blob (adds
`signature_key`, `encryption_key`, `dh_prime`) carried through trading, `/trader` UI, agent `manage_account` and the
proto comment. Launched 2026-10-31 via PR #1387 (0cfaa489). Never exercised against a real IBKR account.

**Why (irrecoverable rationale)**:
- Scope: the operator explicitly overrode C-11 so the LST handshake stayed in the bug track rather than a separate
  `/sdd-story` (old context.md@1ed63958 sessions 2026-10-20 sdd-review and 2026-10-21 sdd-design, "OPERATOR DECISIONS"). The
  query-param omission alone would not have made any call succeed.
- Deterministic credential failures (decrypt failure, LST-signature mismatch, init 2xx not authenticated, missing or
  unparseable key material) return `ErrInvalidCredentials` rather than a transient error. UNKNOWN accounts are not
  skipped by reconciliation, so they would feed `systemicCount` and could escalate the whole platform to REDUCE_ONLY
  (design.md:78-79, :203-206).
- `compete=false` on `ssodh/init`: `compete=true` would log out the account holder's own TWS, mobile and Client
  Portal sessions on real-money accounts, and no operator decision covers that (design.md:201-202).
- `reconcileTick` skips (WARN, no `systemicCount++`) an account whose `ListOrders`/`GetPositions` returns
  `ErrInvalidCredentials`. This closes the window before the INVALID status lands (design.md:118-124; shipped in
  `trading.go` `reconcileTick`).
- The retry classifier splits on "was anything sent". A session failure before the POST is flattened with `%v` so it
  is a definite REJECTED. A resend that fails after a 401 returns `broker.ErrOutcomeUncertain`
  (`broker.go:12-14`), which `isUncertainBrokerOutcome` (`trading.go:2520`) treats like a timeout, never REJECTED,
  because the first POST may have landed (design.md:96-99, :111-116).
- Bracket legs (`SubmitBracketLegs`) are never resent after a 401. They carry no `cOID` (`ibkr.go` leg POST), and
  `BracketLegsRequest` carries no resize generation to derive a deterministic leg `cOID` from. A final 401 takes the
  existing bounded, alerted FAILED-bracket path rather than risking duplicate STP/LMT legs (design.md:100-105).

**Rejected alternatives** (all from design.md; deleted with it):
- Tie LST refresh margin and handshake bound to `IBKRRequestTimeout` — conflicts with product-spec C-05/F-07, and that
  constant is itself a documented hardcoded-timeout defect (design.md:197-198).
- Amend the product-spec config line instead of adding keys — needs an operator sign-off the binding decisions do not
  cover (design.md:199-200).
- `competing:true` -> UNKNOWN — a better meaning, but UNKNOWN feeds `systemicCount` and would trigger REDUCE_ONLY on
  every deploy overlap (design.md:203-204).
- Separate `brokerageReady` flag with path-based init branching — hid a persistent init failure behind OK
  (design.md:207).
- No 401 retry for POST/DELETE — a revoked cached LST would fail orders and drive brackets to FAILED (design.md:208-209).
  Its stricter form, "no retry on order-creating POSTs at all", lost to the cOID-protected `SubmitOrder` resend plus
  the uncertain-resend rule; it survives only for bracket legs (design.md:216-217).
- Retry POST/DELETE on 5xx/timeout/network — IBKR may have processed the request (design.md:210).
- Resend bracket legs without `cOID` — trades a bounded, alerted FAILED bracket for unbounded double-submit exposure
  (design.md:211-212). Deterministic leg `cOID` — no resize generation exists, IBKR leg-`cOID` dedup unverified
  (design.md:213-215).
- Flip the shared `.gitleaks.toml` `[allowlist]` to `regexTarget="match"` — re-tests the four existing literals
  against matched secret text (design.md:218-219). Whole-file `paths` allowlist for the PEMs with no regex — hides a
  real key pasted into the fixture (design.md:220).
- Runtime `rsa.GenerateKey` test keys — cannot reproduce ibind PKCS1v15 / RSA-SHA256 known-answer vectors
  (design.md:221).
- Hand-rolled 1-slot semaphore + goroutine — `singleflight.DoChan` with a `context.WithoutCancel` leader ctx gives the
  same detachment with less machinery (design.md:222-223). Plain `singleflight.Do` with the caller's ctx — hands a
  short-ctx `DeadlineExceeded` to every waiter (design.md:224).
- Boot LST warm-up after `LoadBrokerPool` — the detached holder caches its result, so the cost is at most one lost
  first tick (design.md:225-226).
- `/iserver/auth/status` poll after init — speculative; a transient `authenticated:false` heals next cycle
  (design.md:227).
- Full server-side DH/RSA fake with its own oracle — a second crypto implementation sharing our guesses; replay of
  ibind vectors by string equality instead (design.md:228-229).
- Reject legacy 4-field blobs in `instantiateBrokerLocked` — drops the pool entry and `PlaceOrder` becomes NotFound
  (design.md:230-231; recon.md:277-281). Chosen instead: stay tolerant, read INVALID locally with no HTTP call.
- Key material in env vars, config secret rows or a migration — the per-account AES-256-GCM blob already carries it
  (design.md:232-233). New `CredentialStatus` value for "competing session" — proto + UI churn for a self-healing
  condition; WARN with `competing=true` instead (design.md:234-235).

**Scars & gotchas**:
- UNVERIFIED EXTERNAL CONTRACT (caveat promoted here so it survives): no live IBKR account existed, so no test proves
  IBKR accepts what we send. The replay fake echoes our own guesses back. Unverified: `ssodh/init` body `{publish,
  compete}` and reply fields `authenticated`/`competing`/`connected`; the K serialization rule; PKCS1v15 vs OAEP for
  `access_token_secret`; whether query values are encoded as shipped; whether IBKR ever answers a lapsed brokerage
  session differently from HTTP 400 `no bridge`. All tests can pass while every real account reads INVALID. Only a
  paper smoke separates "IBKR rejected us" from "we guessed the shape wrong" (old context.md@1ed63958 2026-10-21 sdd-design
  "Tracked caveat"; `fails.md:481-484`). Also recorded in `services/xstockstrat-trading/docs/ibkr.md` (the 249 section).
- FR-3 (sign query params) contradicts the pinned ibind reference. ibind signs regular requests WITHOUT query params
  (`_get_headers` passes no `request_params`, `ibkr_client.py:146-158`; the URL excludes them, `rest_client.py:226-231`,
  ibind @ 759ec3a1). Operator ruled "Include params (FR-3)" on 2026-10-29. Discovered only at /sdd-spec time
  (2026-10-21), after the design had stated the rule.
  - Why the vectors cannot settle it: the AC-1 vectors call ibind's `generate_base_string` WITH `request_params`, which
    ibind's own regular-request path never passes. They prove consistency with the RFC 5849 base-string rule, not how
    ibind signs and not that IBKR accepts it (implementation-spec.md:64-67; Open Risks :1166-1169).
  - Paper-smoke decision rule (implementation-spec.md:70-73): paper `GetOrder` (carries a query) next to
    `ValidateCredentials` (no query). Both 200 -> keep params. Query call 401 while the no-query call is 200 -> exclude
    params.
  - Reverting is two edits, not one: flip the single inclusion in `buildBaseString` (`ibkr.go:600`) AND regenerate
    the AC-1 vector (`gen_vectors.py` / `vectors.json`), and (inference) the promoted AC-1 scenario in
    `services/xstockstrat-trading/acceptance/fix-ibkr-request-signing.feature`, whose Then asserts the base string includes
    `orderId=42`.
- ibind `quote_plus` encoding (not RFC 5849 `%20`): pinned encoding equals Go `url.QueryEscape` (`oauthEncode`,
  `ibkr.go:585-586`). A space in a query value (`BRK B`) signs as `+`.
- Wrong-key decrypt: pycryptodome 4.2.0 `PKCS1_v1_5.decrypt` returns empty bytes (not the `None` sentinel), so ibind's
  prepend becomes `""` instead of raising. `gen_vectors.py` accepts either; the Go `mintLST` must fail closed on an
  empty plaintext (implementation-spec Deviation Log, Step 1 and Steps 4+5; tested).
- Committed test keys: the root `.gitignore:55` ignores `*.pem`, so the three fixture PEMs under
  `internal/testdata/ibkr/` were force-added (`git add -f`). gitleaks: the two key PEMs are allowlisted by unique
  first-body-line regexes; the generated `vectors.json` (fake OAuth tokens, signatures, an encrypted test secret) trips
  default rules and is allowlisted by exact `paths` entry in the single `[allowlist]` table (`.gitleaks.toml:42-46`; comment block
  `:34-41`; operator Option A, 2026-10-29). A fresh key dropped into `ibkr/` is still detected (verified locally). Regeneration
  from ibind `759ec3a1` with pycryptodome 4.2.0 is byte-identical.
- Host toolchain lag, every Go step: the provisioned `~/go/bin/golangci-lint` v2.14.0 was built with go1.26 and
  rejects the `go 1.27.0` module; it was rebuilt with go1.27 into a scratch `GOBIN` each time. The host protoc Go
  plugins (built with go1.24.7) reflow comments in unrelated `gen/go/analysis/v1/analysis.pb.go`; they were rebuilt
  with go1.27.0 (CI `proto-freshness` Go) before `buf-gen.sh`. Host fix: rebuild `~/go/bin` plugins and lint with Go
  1.27 (see `docs/runbooks/codegen-toolchain-host-setup.md`).
- Strict wire tests (`package broker_test`, `internal/service`) reach the replay handler by swapping
  `http.DefaultTransport` for a host-rewriting transport, because the client signs over the vector base URL
  `https://api.ibkr.com/v1/api`. No production seam was added; no test in those packages may run in parallel.
- The joiner re-call rule compares a per-flight sequence number, not a wall-clock timestamp, so it is independent of
  the `Now` test seam (implementation-spec Deviation Log, Steps 4+5).
- An `ssodh/init` reply with `authenticated:true, competing:true` is still treated as established; only "2xx lacking
  `authenticated:true`" is INVALID (Deviation Log, Steps 4+5).
- A 400 `no bridge` resend that fails is an ordinary error, not uncertain (the 400 proves the first send was not
  processed), and `noResend` blocks only the 401 resend, so a bracket-leg 400 `no bridge` is still re-inited and
  resent once (Deviation Log, Steps 6+7).
- The PEM fields are `Textarea`s because a multi-line PEM pasted into the single-line `type="password"` `Input` loses
  its newlines (recon.md:310).
- Native `required` on the PEM `Textarea`s blocks submit before react-hook-form runs, so `FieldError` text never
  renders on the empty-key path; the e2e asserts the textarea is `:invalid` instead (operator "B: Keep native",
  2026-10-30). Playwright `getByPlaceholder('Access Token')` is a substring of `Access Token Secret`; use
  `exact: true`.
- `buf breaking` against the feature branch from a worktree: the sandbox refuses a `.git#branch=` input, so a
  `git archive` tarball with `#subdir=packages/proto` was the baseline (Deviation Log, Step 11).
- Mid-lifecycle, twice (2026-10-21 sdd-spec and sdd-review) the operator asked "what happened to the prior progress?":
  nothing was lost. The impl-spec reviewer had read a stale worktree at 4d9b1022 (`status.md` = `spec-ready`) and
  raised two false FAILs (AC-5..AC-10 missing, no design.md). Authoritative state is `origin/feature/<slug>`.
- Steps were executed in merged pairs (2+3, 4+5, 6+7, 8+9, 13+14, 15+16) under the operator's standing "Merge pairs +
  standing rule" because each step's RED test was the next step's; the spec's 17 steps map to 11 commits.

**Permanent deviations** (shipped contradicts design):
- design said RFC 5849 §3.6 `oauthEncode`, with `url.QueryEscape` removed from the signer (design.md:26-29) ->
  shipped `oauthEncode` IS `url.QueryEscape` (`ibkr.go:585-586`) -> because ibind's `quote_plus` over the raw joined
  string equals `QueryEscape`, and design §1's own clause "pinned by ibind vectors" governs (old context.md@1ed63958 2026-10-21
  sdd-spec).
- design said lapsed brokerage session = 401 re-init, or a non-401 reply "pinned at /sdd-spec" as a `c.do` re-init
  trigger, with a documented REDUCE_ONLY exception until then (design.md:106-109, :247-250) -> shipped HTTP 400
  `no bridge` on `/iserver/` triggers `reinit` + one resend, which narrows the exception -> because ibind
  `ibkr_client.py:139-143` returns that for a lapsed session (old context.md@1ed63958 2026-10-21 sdd-spec; unverified live). The
  exception is narrowed, not closed: a lapsed session answered by anything other than 401 or 400 `no bridge` still
  counts as systemic and can still push to REDUCE_ONLY (implementation-spec.md:1177-1178).
- design said gitleaks: unique-substring regex in the `"line"` table, or `[[allowlists]]` paths AND regex; no
  whole-file paths allowlist (design.md:181-185, :220) -> shipped regex for the two PEMs plus an exact-path allowlist
  for generated `vectors.json` only -> because the generated data trips default rules and the operator chose Option A
  (Deviation Log, Step 1; implementation-spec.md:1190-1197). The `[[allowlists]]` fallback was never needed. This is
  a bare exact-path entry, which `fails.md:2988-2989` forbids; see the 2026-11-04 fails entry for why it is a
  sanctioned exception.
- design said fleet-wide INVALID alert either ships or becomes a follow-up (design.md:262-264) -> follow-up only
  (D-spec-1, C-18/YAGNI). Likewise the `/tickle` keepalive (design.md:258-261). Neither is filed as a feature.
- design said uncertain marker is "a deadline-class `%w` error (or an equivalent marker)" (design.md:96-99) ->
  shipped sentinel `broker.ErrOutcomeUncertain` plus extracted predicate `isUncertainBrokerOutcome`
  (`trading.go:2520`) replacing both inline classifiers (D-spec-3). In-bounds of the design's wording, listed for
  discoverability.

**Cross-feature signal**:
- Feature 001 (archived) shipped plain OAuth 1.0a for IBKR; 249 completes the contract it chose the Web API for.
- Sibling defect `docs/reports/2026-10-19-trading-ibkr-timeout-hardcoded-defect.md` (hardcoded `IBKRRequestTimeout`,
  `ibkr.go:44-46`) stays separate; 249's `trading.ibkr.*` timing keys deliberately do not use it.
- Feature 240 touches disjoint `trading.go` regions and `trading.proto`/`gen/`; whichever merged second re-ran
  `./scripts/buf-gen.sh` (rebase-only). Features 264/248 add newer entries to the `config-governance.md`
  Per-Feature Registered Keys log; keep it newest-first.
- Related to `fails.md:481-484` (unverified external API field) and `fails.md:2980-2989` (gitleaks allowlist lesson,
  dated 2026-10-21, cites design.md §10); the 2026-11-04 fails entry for this feature refines that rule.

**Deferred follow-ons**:
- `ibkr-session-keepalive`: `/tickle` keepalive; if 60s reconciliation traffic does not count as session activity,
  brokerage sessions may idle out between ticks. Only mentioned at `services/xstockstrat-trading/docs/ibkr.md:49`; no
  feature directory exists. Needs `/sdd-story`.
- `ibkr-fleet-invalid-alert`: one aggregate alert when every IBKR account reads INVALID in a reconcile tick (a signer
  regression after a deploy currently shows only per-account WARNs). Same status.
- Paper-account smoke against a real IBKR account (FR-3 vs ibind, `ssodh/init` shape, lapsed-session reply).
- A 2xx order reply carrying a duplicate-`cOID` error is not classified as uncertain (reply format unpinned); only a
  non-2xx resend is.
- `docs/runbooks/mcp-tools.md` `update_credentials` bullet and `**Errors:**` line still name only "invalid JSON" for
  `INVALID_ARGUMENT` (incomplete IBKR blob not mentioned).
- `compete=false` self-competition (DO rolling-deploy overlap, ~24h LST refresh re-running init) can read INVALID for
  up to one health interval (default 300000 ms); heals via the next poll (AC-4 `competing:true` row, AC-10).
- Defect report `docs/reports/2026-10-19-trading-ibkr-oauth-signature-omits-query-defect.status` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-10-19-trading-ibkr-oauth-signature-omits-query-defect.md) is still `triaged`
  (`ref: feature:249-fix-ibkr-request-signing`); it is not resolved yet, so `/sdd-archiver reports` will not prune it.
- Unverified residual, no source addresses it: register/update swaps in a fresh client (recon.md:287-288), discarding
  the cached LST while the old client may be mid-request. Each credential update then forces a new handshake +
  `ssodh/init` with `compete=false`, possibly the same self-competition INVALID window as above.
- Known and accepted: a 403 permission error on an `/iserver` order call also skips the systemic count for that tick
  (design.md:265-266). Three `trading.ibkr.*` keys (`lst_refresh_margin_ms` 60000, `handshake_timeout_ms` 10000,
  `reauth_min_interval_ms` 30000) are unseeded (feature 102 pattern) and read live with `<= 0` -> default.

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-11-04 entries. (The
original gitleaks `regexTarget` lesson is already `fails.md:2980-2989`; the new fails entry refines it. The
read-the-reference-first lesson is already `insights.md:1406-1419` and its closer predecessor `fails.md:1013-1024`,
the 2026-08-10 shadcn-sidebar-visual-rewrite entry that insights.md:1412-1413 cites.)

**Runtime-invariant recommendations (→ /context-constitution)**:
- TRADING-3 was already widened in-feature (`services/xstockstrat-trading/docs/context-constitution.md:21`). Candidate
  new trading invariant: `reconcileTick` must not count `ErrInvalidCredentials` from `ListOrders`/`GetPositions` as
  systemic (the skip is in code but only enforced by the promoted AC-9, not a PLAT-/TRADING- row).
- Candidate: IBKR order-path error wrapping — an error produced before any byte is sent must be flattened (`%v`) so the
  timeout classifiers (`trading.go` SubmitOrder/ReplaceOrder via `isUncertainBrokerOutcome`) read it as definite
  REJECTED; `%w` is reserved for `ErrInvalidCredentials` and for errors after a send.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 1ed63958.
