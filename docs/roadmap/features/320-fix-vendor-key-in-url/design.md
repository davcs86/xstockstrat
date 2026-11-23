# Design: fix-vendor-key-in-url

**Created**: 2026-11-13
**Rounds**: 3 (full; termination: approved)
**Approved by**: operator @ 2026-11-13 (approval gate after round 3; Floor clear)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

The FMP and Finnhub vendor keys leave the query string and travel in a per-request header (D-1). The
same step makes the default client refuse redirects (D-2, D-5). No general URL-error sanitizer is
added (D-3). A pre-merge vendor proof gates the change (D-6). A vendor that fails that proof keeps
its query key under a signed residual and must get a vendor-scoped sanitizer (D-4).

The change is internal to `xstockstrat-marketdata`'s outbound vendor HTTP. No consumer surface
changes (C-14): `GetFundamentals` / `GetFundamentalsMulti` keep their responses and their key-free
`Unavailable` statuses, and no proto, config key, migration or inter-service edge changes
(recon.md:71-76).

**Step 0: pre-merge vendor proof (D-6). It blocks step 2.**
- Recon could not find any evidence in the repo that either vendor accepts header auth
  (recon.md:83-86), so the operator proves it. The operator curls each vendor directly, from outside
  marketdata, with the key in the header only and without `-L`. Cover all six paths:
  - FMP (`apikey`): `/stable/quote`, `/stable/ratios-ttm`, `/stable/profile`
  - Finnhub (`X-Finnhub-Token`): `/stock/metric`, `/quote`, `/stock/profile2`
- Keep the key out of argv, shell history and context.md. Use `-H @hdrfile` (mode 0600, deleted
  afterwards) or an unexported variable. context.md records results only.
- Record per path:
  - `%{http_code} %{redirect_url} %{http_version}`: must be 200 with no redirect.
  - A summary showing the payload is non-empty.
  - The vendor docs URL with a quoted passage where one exists.
  - If the negotiated protocol is HTTP/1.1, run one `--http1.1` probe whose hdrfile sends the
    Go-canonical `Apikey:` spelling (O-16).
- Check the staging and production `fmp.base_url` / `finnhub.base_url` overrides the same way.
- **Per-vendor fallback (D-4).** A vendor that fails step 0 keeps its query key under a user-signed
  OQ2 residual (recon.md:84-85). For that vendor, a vendor-scoped R-3 sanitizer wrapped around the
  `Do` unwrap is mandatory. Test it with the 302 + unparseable-`Location` fixture and the 254 form
  where `errors.As(*url.Error)` is false.

**Step 1: RED tests (P-06).**
- **@AC-2.** One `httptest.NewServer` per vendor records `r.URL.RawQuery` and `r.Header`. Assert the
  key is absent from the query and present in the header (recon.md:54).
- **@AC-1, both vendors.** The server answers 302 with an unparseable `Location` that echoes
  `r.URL.RawQuery`. Use `HTTPClient: nil` with `BaseURL` set to the server, and assert with
  `assertNoKeyLeak` (`internal/fmp/fmp_client_test.go:230`, recon.md:49).
  - FMP: also assert the `GetFundamentalsMulti` gRPC status and the log line. The test file is
    confirmed at spec time, near `marketdata_service_test.go:4405`.
  - Finnhub (O-14): drive the case through single-symbol `GetFundamentals`
    (`internal/finnhub/finnhub_client.go:67-69`), which returns the error. `GetFundamentalsMulti`
    swallows per-symbol errors (`finnhub_client.go:80-85`), so a test through it would pass without
    testing anything (R-7). Assert there is no `k-secret` and no `token=`, and that
    `errors.As(*url.Error)` is false.
- **CR/LF (O-15).** Through `newLeakClient` (`fmp_client_test.go:247`, recon.md:50) with
  `APIKey: "k-secret\n"`, assert `assertNoKeyLeak` on the resulting header-validation transport
  error. Header-value validation is a new key-bearing path that this design creates.
- **Traceability.** @AC-1 goes GREEN because of D-1, not because of `CheckRedirect` (D-4). `net/http`
  `Client.do` parses `Location` before it calls `checkRedirect`. The error leaves through the `Do`
  unwrap at `fmp_client.go:289-295` and `finnhub_client.go:140-146` (recon.md:21,27).

**Step 2: one atomic step (D-5).**
1. Write the cross-host redirect test first: host A answers 302 to host B, and host B never sees the
   key header. Show it RED once the header lands. Go strips only `Authorization`, `WWW-Authenticate`,
   `Cookie` and `Cookie2` on a redirect, so a custom key header would otherwise follow it.
2. Delete `params.Set` at `fmp_client.go:260` and `finnhub_client.go:126` (recon.md:18,25).
3. After the build-request branch, add `req.Header.Set("apikey", c.apiKey())` (FMP, after
   `fmp_client.go:272`) and `req.Header.Set("X-Finnhub-Token", c.apiKey())` (Finnhub, after
   `finnhub_client.go:138`). The key is read through `c.apiKey()` on every request, never stored in a
   transport or a header map at construction (recon.md:32-33,47). This preserves 295 @AC-16.
4. Add `CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }`
   to the default clients at `fmp_client.go:73` and `finnhub_client.go:46` (recon.md:29-31). A
   refused 3xx then flows through the existing key-free status paths (`statusError` / "returned
   HTTP %d").
5. Repoint the tests that read the key from the query: `cmd/server/main_test.go:165,171,195,196,297`,
   `finnhub_client_test.go:394`, `fmp_client_test.go:625-626` (recon.md:55). Re-grep at spec time
   (recon.md:102).
6. Add an `HTTPClient` field-doc line at `fmp_client.go:38` and `finnhub_client.go:28`: "An injected
   client must refuse redirects; the key travels in a request header." No production code injects
   an `HTTPClient` (O-11).

**Step 3: comments and pinned guarantees.**
- Rewrite these comments so each states the new constraint: `fmp_client.go:254-255,266,308,331,389`,
  `finnhub_client.go:120-121,132,156` and `internal/service/etf_flags.go:131` (recon.md:23,35). This
  includes the `ErrorClass` doc at `fmp_client.go:389`, which says "can carry apikey=".
- Spec pins:
  - **294 @AC-13** keeps the `fmpOp` / `finnhubOp` op labels and the outcome constants, with no URL
    or header attribute (`fmp_client_test.go:636-645`, `finnhub_client_test.go:413-415`;
    recon.md:22,28,64-66). Its scenario text is amended in step 4, so the pin does not call it
    "unchanged".
  - **230 @AC-5** uses two separate assertions for a refused 302 (D-7):
    - `ErrorClass` == `http_302`, the `http_<code>` form that `enrichmentClass` produces
      (`fmp_client.go:380`).
    - The telemetry outcome is `other` (`HTTPErrorOutcome`, `internal/telemetry/otel.go:375-384`).
  - The class-only log at `etf_flags.go:170` is unchanged, and the `etf_flags_test.go:390-392`
    fixtures are left alone (recon.md:63).
  - **254 @AC-5 / @AC-7** hold through the unchanged unwrap (recon.md:61-62).
- **F-07 note:** `apikey` and `X-Finnhub-Token` are vendor protocol constants, like the path literals
  at `fmp_client.go:396,406`. They are not config.

**Step 4: docs and acceptance.**
- Add one line to marketdata `CLAUDE.md` § Fundamentals Integration on how the key is sent
  (recon.md:78).
- Promote the open question at `services/xstockstrat-marketdata/docs/context-constitution-findings.md:39`
  (the service-scoped file, not the root `docs/` file; D-8, recon.md:79) to a hard invariant: the key
  is header-only, and URLs and errors are key-free.
- Amend these scenarios in place with `@feature-320` (fails.md trap 2026-11-04, recon.md:97):
  - 254 @AC-1 and @AC-2 (`acceptance/fix-marketdata-secret-exposure.feature:9,17`). The @AC-2 Then
    reads "the request URL received by the vendor endpoint".
  - 294 @AC-13 (`acceptance/signal-map-instrumentation.feature:13-15`, O-13). The Given becomes an
    FMP 429 for `https://fmp.example/stable/profile?symbol=AAPL` with key SECRET123 sent in the
    `apikey` header. The Then "no metric attribute, span attribute or log line contains SECRET123"
    stays.
- Leave `fix-etf-flag-fill.feature:55` (synthetic error text) unchanged.

**Step 5: post-deploy confirmation (D-6).**
- Record, per vendor, the before and after values of
  `marketdata.vendor.requests{outcome ∈ ok, http_4xx, other, decode}`.
- Pass if the `ok` share does not fall and none of the other three rises.
- A vendor path that is off on dev is either enabled for the window, or recorded as "not exercised"
  and checked at the first environment where it is live.

## Rejected Alternatives

- `R-1` Header-injecting RoundTripper — rejected because it re-injects the key on every redirect
  hop, including cross-host ones.
- `R-2` Shared vendor-HTTP package for the client literals — rejected because it would hold two
  one-line literals, which fails C-18.
- `R-3` Query key plus `redactURLError` as the primary fix — rejected because it does not close
  residual (b), the access logs. It survives only as the mandatory per-vendor fallback if step 0
  fails (D-4).
- `R-4` `CheckRedirect` returning a sentinel error instead of `http.ErrUseLastResponse` — rejected
  because it turns a 3xx into a transport `*url.Error` and loses the status code that
  `statusError{path,3xx}` keeps.
- `R-5` Landing `CheckRedirect` in a later step than the header move — rejected because it opens a
  window where the custom key header follows a cross-host redirect.
- `R-6` Wrapping `http.DefaultTransport` in a runtime tripwire that rejects any request whose query
  holds `apikey` / `token` — rejected because it adds one more moving part (C-18), and the @AC-2
  httptest tests already guard the same invariant at merge time.
- `R-7` A Finnhub @AC-1 error-text test driven through `GetFundamentalsMulti` — rejected because
  Multi swallows per-symbol errors (`finnhub_client.go:80-85`), so the test would pass without
  testing anything. Use single-symbol `GetFundamentals` (`:67-69`).

The debate also settled these points without opening an `R-n`:
- A general `redactURLError` at all four unwrap sites as defence in depth is not added (D-3). Once
  D-1 lands, no key-bearing URL is left to redact, and the CR/LF test covers the only new
  key-bearing path.
- Pinning `ErrorClass` as the literal `http_3xx` was dropped (D-7). `enrichmentClass` produces
  `http_<code>` (`fmp_client.go:380`), so that test could never pass.
- Applying `CheckRedirect` to an injected `cfg.HTTPClient` was not adopted, because no production
  code injects one. The field-doc constraint is enough.
- Refusing only cross-host redirects was not adopted: it adds mechanism with no demonstrated need.
- A dev smoke test was not used as the OQ1 merge gate, because dev deploys only after the merge it
  would gate (O-2).

## Open Risks

- [ ] The vendor header contract cannot be verified from the repo. A wrong header name means
  401/403 on every production call while the unit tests stay green. Step 0, run across all six paths
  with protocol and header-case fidelity, is the only pre-merge gate. Addressed at: step 0.
- [ ] Step 0 assumes the operator's host behaves like marketdata's egress, which holds only if
  header acceptance does not depend on the source IP. Header handling may also differ between the
  staging and production vendor plans. Addressed at: step 0 (both `base_url` overrides) and step 5.
- [ ] A redirecting configured `base_url` becomes a hard failure. The error stays key-free
  (`statusError` 3xx, outcome `other`). Addressed at: step 0 (no-redirect check) and step 5.
- [ ] A secret stored with a trailing CR/LF now fails as an invalid header value. The error is
  key-free and pinned by a test, but the request fails, and this design adds no trimming.
  Addressed at: step 1 (CR/LF test) and step 5.
- [ ] If one vendor fails step 0, that vendor keeps the query key with a vendor-scoped sanitizer, and
  residual (b), the access logs, remains under a signed acceptance. Addressed at: step 0 (D-4
  fallback).
- [ ] Other test fakes or `recordingRT` responders may still read the key from the query. Addressed
  at: spec time (re-grep) and step 2.
- [ ] The test file for the FMP @AC-1 gRPC-status and log assertions is not yet confirmed.
  Addressed at: spec time (step 1).
- [ ] O-13 to O-16 are non-blocking and still open in debate.md. All four are folded into this
  approach (steps 0, 1 and 4). Addressed at: `/sdd-spec`, which must carry each one as a concrete
  step item.

## Constitution Rules Touched

- `C-01` — honored by: every step cites a `path:line` that recon or the debate re-grepped. The
  remaining test-site lists are explicitly marked "re-grep at spec time".
- `C-08` — honored by: each code-bearing step has paired tests. These are the @AC-1 / @AC-2 httptest
  cases for both vendors, the cross-host redirect test, the CR/LF header-validation test and the
  repointed query-reading tests.
- `C-11` — honored by: the feature went through `/sdd-triage` (Track C), `/sdd-review` and a full
  three-round `/sdd-design` before any code.
- `C-15` — honored by: @AC-1 and @AC-2 trace to the step-1 tests, and each scenario amended in step 4
  is backed by a test that asserts the header transport.
- `C-16` — honored by: the affected durable scenarios are listed below. Each is PRESERVE or an
  in-place `@feature-320` EXTEND, and there is no CHANGE.
- `C-18` — honored by: the least mechanism that closes both residuals. That is two `req.Header.Set`
  lines and two `CheckRedirect` literals, with no shared package (R-2), no RoundTripper (R-1), no
  tripwire (R-6) and no general sanitizer (D-3).
- `P-03` — honored by: OQ1, vendor header support, is not guessed. Step 0 is the operator proof that
  gates step 2, and a failing vendor needs a signed residual (D-4).
- `P-06` — honored by: step 1 is written RED before step 2, and the cross-host test goes RED inside
  step 2 before `CheckRedirect` lands.
- `F-04` — honored by: no invented symbol. `redactURLError` and `CheckRedirect` are recorded as
  absent today (recon.md:98-101), and the FMP @AC-1 service-test file is flagged as still to be
  confirmed.
- `F-07` — honored by: the header names are vendor protocol constants, like the path literals at
  `fmp_client.go:396,406`. The keys still come from the `GetSecret`-resolved config secrets through
  `c.apiKey()` (recon.md:33-34).
- `F-08` — honored by: step 2 is one atomic unit whose Files list covers both clients, their tests
  and `cmd/server/main_test.go`. The spec must list every staged file.

## Business Rules Touched (C-16)

- EXTEND `@AC-1` "An FMP transport failure never reveals the API key"
  (`services/xstockstrat-marketdata/acceptance/fix-marketdata-secret-exposure.feature:9`, @feature-254)
  — new case added: a redirect with an unparseable `Location`, for FMP and for Finnhub single-symbol
  `GetFundamentals`. Amended in place with `@feature-320`. The 254 assertions are kept.
- EXTEND `@AC-2` "A Finnhub transport failure never reveals the token" (same file `:17`,
  @feature-254) — new case added: the request URL received by the vendor endpoint carries no token.
  Amended in place with `@feature-320`. The 254 assertions are kept.
- EXTEND `@AC-13` "Vendor requests are counted by bounded outcome without leaking the FMP key"
  (`services/xstockstrat-marketdata/acceptance/signal-map-instrumentation.feature:13`, @feature-294)
  — Given amended in place with `@feature-320`: key SECRET123 is sent in the `apikey` header. The
  no-SECRET123 Then and the bounded `op` / `outcome` labels are kept.
- PRESERVE `@AC-16` "A rotated vendor secret is used without a restart"
  (`services/xstockstrat-marketdata/acceptance/fix-config-keys-drift.feature:14`, @feature-295) — not
  regressed by: the header value is read through `c.apiKey()` on every request.
- PRESERVE `@AC-5` "A failed fill logs only the error class, never the raw error text"
  (`services/xstockstrat-marketdata/acceptance/fix-etf-flag-fill.feature:53`, @feature-230) — not
  regressed by: `ErrorClass` and the class-only log at `etf_flags.go:170` are unchanged. A refused
  3xx yields `http_<code>` (D-7).
- PRESERVE `@AC-5` "The marketdata gRPC Unavailable status never carries the vendor key"
  (`fix-marketdata-secret-exposure.feature:25`, @feature-254) — not regressed by: the 254 `*url.Error`
  unwrap stays as it is (D-3).
- PRESERVE `@AC-7` "The marketdata batch Unavailable status never carries the vendor key"
  (`fix-marketdata-secret-exposure.feature:35`, @feature-254) — not regressed by: the same unchanged
  unwrap, plus the new FMP `GetFundamentalsMulti` @AC-1 assertion.

There are no CHANGE entries, so no operator decision reference is needed. No operator decisions were
recorded for this feature.

## Rounds

- Round 1 (2026-11-11, /sdd-batch): +3 D, +3 R, +6 O. The header-move approach was settled (D-1 to
  D-3).
- Round 2 (2026-11-11, /sdd-batch): +3 D, +2 R, closed O-1 to O-6, +6 O. The adversary showed that
  `Location` is parsed before `checkRedirect` (O-7, blocking), so @AC-1 was retraced to D-1 and the
  fallback sanitizer became mandatory (D-4, D-5).
- Round 3 (2026-11-13, /sdd-batch): +2 D, +2 R, closed O-7 to O-12, +4 non-blocking O. Two
  citations were corrected (D-7, D-8).
- Termination: approved. The operator approved at the gate after round 3 with no Floor breach and
  no blocking objection. No reopen petitions were filed. O-13 to O-16 remain open, non-blocking, and
  folded into the approach.
