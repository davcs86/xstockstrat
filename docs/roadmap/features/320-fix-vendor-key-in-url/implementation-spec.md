# Implementation Spec: fix-vendor-key-in-url

**Status**: `pending`
**Created**: 2026-11-13
**Feature**: `docs/roadmap/features/320-fix-vendor-key-in-url/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/fix-vendor-key-in-url`
**Tree**: `detached@b2a6744d ≡ origin/feature/fix-vendor-key-in-url` (clean; every `path:line` below was re-read at this tree)
**Review re-check**: 2026-11-13 at `7e637a28` (`/sdd-review impl-spec`). The Steps 2-5 `path:line` citations in both clients, `etf_flags.go:131`, `marketdata_service.go:1856`, `marketdata_service_test.go:4417`, `main_test.go:157,165,171,195,196,221,297,318,328,363`, `finnhub_client_test.go:385,394,402` and `fmp_client_test.go:598,613,616,625-626` were re-read and hold.

---

## Execution Summary

The design (`design.md` § Chosen Approach) is carried as six steps. Step 1 is the operator's pre-merge
vendor proof (design step 0, D-6). It is a hard gate, because nothing in the repo shows that FMP accepts
an `apikey` header or that Finnhub accepts `X-Finnhub-Token` (recon.md § Risks).

Steps 2-5 are one atomic unit, U1 (design step 2, D-5, F-08). U1 moves the key out of the query string
into a per-request header in both clients. In the same commit it makes each default client refuse
redirects, and it repoints every test that read the key from the query. It also rewrites the comments
that the move makes false (design step 3) and adds the new RED-first regressions (design step 1).
Step 6 updates the service docs and amends the durable scenarios in place (design step 4). The
post-deploy outcome check (design step 5) runs after the dev deploy. It is described in
`## Post-Deploy Confirmation` and is not an execute step.

Order: the gate comes first. A vendor that fails it changes U1's shape for that vendor (D-4), so no code
is written before the proof is recorded. U1 then lands as one commit. Step 6 follows U1 so that the docs
describe shipped behavior.

**Consumer surface (C-14):** none; this is internal to the platform. The product spec has no
`## Consumer Surface(s)` section (review warning, `context.md` 2026-11-10), and the design records that
no consumer surface changes. `GetFundamentals` and `GetFundamentalsMulti` keep their responses and their
key-free `Unavailable` statuses. No proto, config key, migration, env var, port or inter-service edge
changes (recon.md § Dependencies). That is a decision, not an omission.

**Deploy-file audit:** no new env var and no new port, so `docker-compose.yml`, `.do/app.dev.yaml` and
`.do/app.yaml` stay unchanged. The keys are still the `GetSecret`-resolved config secrets
`marketdata.fmp.api_key` and `marketdata.finnhub.api_key` (`services/xstockstrat-marketdata/CLAUDE.md:194-200`).

**F-07:** the header names `apikey` and `X-Finnhub-Token` are vendor protocol constants, like the path
literals at `fmp_client.go:396,406`. They are not config values.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1`: a redirect with an unparseable `Location` never surfaces the key | Step 3 (FMP client `TestRedirectUnparseableLocation_DoesNotLeakAPIKey_AC1`; service `TestFundamentals_RedirectLocationErrorIsKeyFree_feature320` asserts the `GetFundamentalsMulti` gRPC status and every log line); Step 5 (Finnhub `TestRedirectUnparseableLocation_DoesNotLeakAPIKey_AC1` through single-symbol `GetFundamentals`, O-14) |
| `@AC-2`: vendor request URLs carry no key | Step 3 (FMP `TestRequest_KeyInHeaderNotURL_AC2` over all three FMP paths); Step 5 (Finnhub `TestRequest_KeyInHeaderNotURL_AC2` over all three Finnhub paths). The `httptest` server's recorded `r.URL` stands in for the URL-logging proxy: it sees exactly the request line any hop on the path would log. |

Traceability note: the product spec and the design cite the Finnhub redirect scenario under 254 `@AC-1`. This spec moves it to 254 `@AC-2`, the Finnhub scenario (Step 6, item 4). The integration PR's traceability matrix must cite `@AC-2` for the Finnhub redirect case.

Design "Tests MUST" clauses traced to steps (`fails.md:2808-2811`, 2026-10-07 extract-tool-ssrf-hardening:
security test mandates are traced like `@AC-*`):
- Cross-host redirect test (D-5): Steps 3 and 5 (`TestRedirect_CrossHostNeverReceivesKey`).
- CR/LF header-value test (O-15): Step 3 (`TestHeaderValidationError_DoesNotLeakAPIKey`).
- Refused 302 gives `ErrorClass` `http_302` plus outcome `other` (D-7, 230 `@AC-5` pin): Step 3, asserted
  inside `TestRedirect_CrossHostNeverReceivesKey` (FMP). The Finnhub test in Step 5 asserts outcome
  `other`.
- Query-reading tests repointed (design step 2.5): Steps 3 and 5.

### Pinned guarantees (design step 3; durable business rules, C-16)

These existing tests must stay green across U1 without being weakened. Step 5's union Verification runs
them by name.

| Rule | Kind | Guard |
|---|---|---|
| 254 `@AC-1` (FMP transport) | EXTEND | `internal/fmp/fmp_client_test.go:252` `TestTransportError_DoesNotLeakAPIKey_AC1`, `:261` `TestBuildRequestError_DoesNotLeakAPIKey`, `:268` `TestTransportError_PreservesDeadlineCause` (unchanged), plus Step 3's new tests |
| 254 `@AC-2` (Finnhub transport) | EXTEND | `internal/finnhub/finnhub_client_test.go:283` `TestTransportError_DoesNotLeakAPIKey_AC2`, `:289`, `:295` (unchanged), plus Step 5's new tests |
| 254 `@AC-5` / `@AC-7` (status) | PRESERVE | `internal/service/marketdata_service_test.go:4393` `TestFundamentals_TransportErrorStatusIsKeyFree_feature254` (unchanged; the `*url.Error` unwrap at `fmp_client.go:289-296` stays as it is, D-3) |
| 294 `@AC-13` (bounded labels, no key) | EXTEND (Given amended in Step 6, O-13) | `fmp_client_test.go:598` `TestVendorMetrics_FMP429_NoKeyOrSymbol_AC13` (repointed in Step 3; the `assertNoAttrContains` and span/log checks at `:636-645` are kept), `:650`; `finnhub_client_test.go:385` (repointed in Step 5; checks at `:413-415` kept), `:420` |
| 230 `@AC-5` (class-only fill log) | PRESERVE | `internal/service/etf_flags_test.go:385` `TestEtfFlagFiller_FailLogsClassOnly_AC5` (unchanged; its synthetic `apikey=SECRET` fixtures at `:390-392` stay, design step 4); the class-only log at `etf_flags.go:170-175` is unchanged |
| 295 `@AC-16` (rotation, no restart) | PRESERVE | `cmd/server/main_test.go:289` `TestLiveSecrets_RotationReachesNextFMPRequest_AC16` (repointed fake in Step 5). The header value is read through `c.apiKey()` on every request. |

## Step Dependencies

- Step 1 blocks Steps 2-6. U1 is written only after the Step 1 proof shows PASS for all six paths. If a
  vendor FAILS (D-4 fallback), `/sdd-execute` stops before U1. The operator then records a signed OQ2
  residual acceptance for that vendor in `context.md`, and `/sdd-spec` re-runs to replace that vendor's
  U1 members with the D-4 shape. In that shape the vendor keeps its query key, and a vendor-scoped
  sanitizer wraps the `Do` unwrap (`fmp_client.go:289-296` / `finnhub_client.go:140-147`). It is tested
  with the 302 + unparseable-`Location` fixture and the 254 form where `errors.As(*url.Error)` is false.
  This spec does not pre-write that branch, because its shape depends on which vendor fails (P-03, F-09).
- Steps 2, 3, 4 and 5 land together (U1). Triggers (`step-constraints.md` §C):
  - Step 2 changes how the FMP key is transported. That breaks the tests that read it from the query:
    `fmp_client_test.go:625-626` and `cmd/server/main_test.go:171` through its callers at `:195` and
    `:297`, which assert at `:221,318,328,363`.
  - Step 4 does the same for Finnhub: `finnhub_client_test.go:394,402` and the `newVendorFake` caller at
    `main_test.go:196`.
  - Steps 3 and 5 add RED tests that need Steps 2 and 4 to go green.
  - The design makes U1 one atomic step over both clients, their tests and `cmd/server/main_test.go`
    (D-5, R-5, F-08). The shared `newVendorFake` (`main_test.go:165`) serves both vendors' fakes.
  - All four members are adjacent, on the backend surface, and within the cap of 4.
- Inside U1 the cross-host redirect test must be shown RED twice before `CheckRedirect` lands (D-5, P-06):
  - once against the pre-unit tree;
  - once after the header move but before the `CheckRedirect` literal, when host B receives the key
    header.

  Both runs are recorded in `context.md` (Step 3 and Step 5 **TDD**).
- Step 6 follows U1, so the docs and the amended scenarios state shipped behavior.
- Business-rule promotion (C-16): Step 6 amends 254 `@AC-1`/`@AC-2` and 294 `@AC-13` in place with
  `@feature-320`. That is the promotion form for this feature's EXTEND-only changes (fails.md trap
  2026-11-04). At integration no separate copy of 320's `@AC-1`/`@AC-2` is promoted. The integration PR
  only checks that the three `@feature-320` tags are present.
- Design step 5 (post-deploy outcome check) runs after the integration PR deploys to dev. See
  `## Post-Deploy Confirmation`. It never blocks a step commit.
- Non-overlap: none of this batch's peer features (`fix-retired-surface-proto-cleanup`,
  `fix-grpc-status-mapping`, `fix-telemetry-startup-log`, `fix-live-enrich-ttl-seed`,
  `fix-migration-tooling-safety`) is recorded as touching `internal/fmp/` or `internal/finnhub/`. If a
  marketdata peer lands first and shifts lines in `internal/service/marketdata_service_test.go` or
  `cmd/server/main_test.go`, re-anchor the edits by symbol, not by line.

---

### Step 1 — docs: pre-merge vendor header-auth proof (operator gate, D-6, O-16)

**Status**: `pending`
**Service**: `xstockstrat-marketdata` (operator action; recorded in the feature's `context.md`)
**Files**:
- `docs/roadmap/features/320-fix-vendor-key-in-url/context.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- The six endpoint paths the clients call:
  - FMP: `/stable/quote` (`internal/fmp/fmp_client.go:396`), `/stable/ratios-ttm` (`:406`), and `/stable/profile` (`:419`).
  - Finnhub: `/stock/metric` (`internal/finnhub/finnhub_client.go:184`), `/quote` (`:194`) and `/stock/profile2` (`finnhubOp`, `:173`).
- Default base URLs:
  - FMP: `https://financialmodelingprep.com` (`cmd/server/main.go:266`).
  - Finnhub: `https://api.finnhub.io/api/v1` (`cmd/server/main.go:224`).
  - Both are overridable live through `fmp.base_url` and `finnhub.base_url`.
- **Not found:** any repo evidence of vendor header-auth support. Recon grepped for it and found none (recon.md § Risks, OQ1).

**TDD**: `N/A (operator verification, no code)`

**Covers**: —

**Instructions**:
1. The operator runs the probes from a host outside marketdata, with the staging FMP and Finnhub keys.
   Each probe sends the key **only** in a header, with no query key and no `-L`:
   - FMP header `apikey: <key>` on `/stable/quote?symbol=AAPL`, `/stable/ratios-ttm?symbol=AAPL` and
     `/stable/profile?symbol=AAPL`.
   - Finnhub header `X-Finnhub-Token: <key>` on `/stock/metric?symbol=AAPL&metric=all`,
     `/quote?symbol=AAPL` and `/stock/profile2?symbol=AAPL`.
2. Keep the key out of argv, shell history and `context.md`. Use `curl -sS -H @"$HDRFILE" -o body.json
   -w '%{http_code} %{redirect_url} %{http_version}\n' '<url>'`, where `$HDRFILE` is a mode-0600 file
   holding one header line and is deleted afterwards. An unexported shell variable is the alternative.
3. Per path, record the following. Pass requires `200`, an empty `redirect_url` and a non-empty payload.
   - The `%{http_code} %{redirect_url} %{http_version}` line.
   - A one-line payload summary, for example "array of 1, symbol AAPL" or "object with 132 metric keys".
   - The vendor docs URL with a quoted passage where one exists.

   An FMP or Finnhub FAIL invalidates Steps 2-5 for that vendor (the D-4 fallback below), not only Step 1.
4. **O-16:** if any FMP probe negotiated `HTTP/1.1`, repeat that probe with `--http1.1` and a hdrfile
   that spells the header `Apikey:`, which is how Go's `Header.Set` canonicalises it. Record the result.
   `X-Finnhub-Token` is already in canonical form.
5. Read the staging and production `marketdata.fmp.base_url` and `marketdata.finnhub.base_url` values
   from config-ui. If either differs from the default, probe one path against it the same way. A
   redirecting `base_url` is a FAIL, because U1 turns every 3xx into a hard, key-free failure (design
   § Open Risks).
6. Append the result to `context.md` as a block headed `### Step-0 vendor header proof (2026-MM-DD)`.
   - It holds one table row per path, in the form
     `| <vendor> | <path> | <http_code> | <redirect_url or -> | <http_version> | <payload summary> | <docs> | PASS/FAIL |`.
   - Then add the two `base_url` lines.
   - Never write a command line that contains the key.
7. If any row is FAIL, stop. Do not start U1, and follow the D-4 fallback in `## Step Dependencies`.

**Verification**:
```bash
F=docs/roadmap/features/320-fix-vendor-key-in-url/context.md
awk '/^### Step-0 vendor header proof/{f=1} f && /^\| (fmp|finnhub) \|/ && /\| PASS \|$/ {n++} END{exit (n==6)?0:1}' "$F" \
  && ! awk '/^### Step-0 vendor header proof/{f=1} f && /^\| (fmp|finnhub) \|/ && /\| FAIL \|$/ {bad=1} END{exit bad?0:1}' "$F" \
  && awk '/^### Step-0 vendor header proof/{f=1} f && /base_url/ && /[Ss]taging/ {s=1} f && /base_url/ && /[Pp]roduction/ {p=1} END{exit (s&&p)?0:1}' "$F"
```
The operator also confirms by eye that no key value appears in the block.

---

### Step 2 — service: FMP key moves to the `apikey` header; the default client refuses redirects (U1)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/fmp/fmp_client.go` — modify
- `services/xstockstrat-marketdata/internal/service/etf_flags.go` — modify (comment only)

**Reviewers**:
- Service owner `xstockstrat-marketdata`: OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency.
- Security: API keys and secrets. The key is still resolved only via `GetSecret`, and is never stored or logged.

**Codebase Evidence**:
- `grep -n 'params.Set("apikey"' internal/fmp/fmp_client.go` gives `:260`. The nil guard it needs is at `:257-259`, and the URL is built at `:263` (`u := c.baseURL() + path + "?" + params.Encode()`).
- The request is built at `:264`. The build-request branch, which unwraps `*url.Error` to `ue.Err`, runs `:265-272`.
- The `Do` unwrap at `:289-296` (`&stageError{"transport", fmt.Errorf("fmp: %s request failed: %w", path, ue.Err)}`) stays as it is (D-3).
- Default client: `httpClient = &http.Client{Timeout: 30 * time.Second}` at `:73`, inside `NewClient` at `:70`. Its doc at `:69` reads "A nil HTTPClient defaults to a 30s-timeout client."
- The `HTTPClient` field doc at `:38` reads "HTTPClient is injectable so tests can assert call counts and stub responses."
- Per-request key read: `apiKey := cfg.APIKeyFunc` with the fallback `func() string { return cfg.APIKey }` at `:79-82`, stored as `apiKey` at `:93`. This preserves 295 `@AC-16` (recon.md § Patterns to REUSE).
- `grep -rn "HTTPClient:" --include=*.go services/xstockstrat-marketdata` matches only tests. Production builds the client with `newFMPClient` at `cmd/server/main.go:263-275` and injects no `HTTPClient` (O-11).
- Comments that become false (design step 3):
  - `:254-255`: "getJSON builds a URL under baseURL with the apiKey query param … The apiKey is added to the query, never logged."
  - `:266`: "*url.Error carries the key-bearing URL: wrap only its inner cause."
  - `:308`: "Never include the URL (it carries the apikey) in the error."
  - `:331`: "statusError … its text must never carry the URL (apikey)."
  - `:389`: "ErrorClass is the secret-free class of an FMP error (never its text, which can carry apikey=)."
  - `internal/service/etf_flags.go:131`: "fillEtfFlag … never logs the error text (it can carry apikey=)."
- Unchanged, for the 294 `@AC-13` and 230 `@AC-5` pins:
  - `fmpOp` at `:319-329`;
  - `enrichmentClass`, which returns `fmt.Sprintf("http_%d", se.code)` at `:380`;
  - `ErrorClass` at `:390`;
  - `telemetry.HTTPErrorOutcome` at `internal/telemetry/otel.go:375-385`, which returns `Other` for a 3xx.

  Re-anchored at the 2026-11-13 re-spec (main-dev `d5de836b`): merged peers added `hostProvider`/`hostlabel` to `otel.go`, moving the function from `:362-372`; behavior unchanged.

**Lands with**: `Step 3, Step 4, Step 5`

**TDD**: `red-green required`. RED means Step 3's tests fail before this step (see Step 3 **TDD**).

**Covers**: —

**Instructions**:
1. In `getJSON`, delete `params.Set("apikey", c.apiKey())` (`:260`). Delete the `if params == nil { params = url.Values{} }` guard (`:257-259`) as well, because its only job was to make that `Set` safe. `url.Values(nil).Encode()` returns `""`, and every caller (`:394-396`, `:404-406`, `:417-419`) passes a non-nil `params`.
2. Directly after the build-request `if err != nil { … }` block closes (`:272`), and before `outcome = telemetry.VendorThrottle`, add `req.Header.Set("apikey", c.apiKey())`. The key is read through `c.apiKey()` on every call. Never store it in a transport or in a header map at construction (recon.md § Patterns to REUSE).
3. In `NewClient`, change the default at `:73` to `httpClient = &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}`.
   - Use `http.ErrUseLastResponse`, not a sentinel error (R-4).
   - Do not add a RoundTripper (R-1), a shared package (R-2) or a tripwire (R-6).
   - A refused 3xx then reaches the existing `statusError{path, code}` (`:306-309`) as outcome `other`.
4. Rewrite the doc comments, at most 2 lines each:
   - `:69`: "A nil HTTPClient defaults to a 30s-timeout client that refuses redirects."
   - `:38`, the `HTTPClient` field doc: keep the first sentence and add "An injected client must refuse redirects; the key travels in a request header." This is the field-doc constraint (O-11).
5. Rewrite the comments that are now false, each stating the constraint that holds now:
   - `:254-255` → "getJSON GETs path under baseURL and decodes the JSON array response into dst. The key travels only in the apikey request header, never in the URL, an error or a log."
   - `:266` → "Wrap only *url.Error's inner cause: an error never carries the request URL."
   - `:308` → "Never include the URL in the error."
   - `:331` → "statusError is a non-200 FMP response; its text is path and code only, never the URL."
   - `:389` → "ErrorClass is the bounded, secret-free class of an FMP error; callers log it, never the error text."
   - `internal/service/etf_flags.go:131` → "fillEtfFlag logs only after releasing etf.mu, and logs fmp.ErrorClass, never the error text."
6. Do not touch the `Do` unwrap (`:289-296`), `fmpOp`, `enrichmentClass`, `ErrorClass`'s body or `etf_flags.go:170-175` (D-3, D-7). Do not add a URL- or header-bearing telemetry attribute (294 `@AC-13`).

**Verification**: the union in Step 5. Step-local checks, run from the repo root:
```bash
cd services/xstockstrat-marketdata \
  && ! grep -n 'params.Set("apikey"' internal/fmp/fmp_client.go \
  && test "$(grep -c 'req.Header.Set("apikey", c.apiKey())' internal/fmp/fmp_client.go)" -eq 1 \
  && test "$(grep -c 'http.ErrUseLastResponse' internal/fmp/fmp_client.go)" -eq 1 \
  && ! grep -n 'carry apikey=\|carries the apikey\|(apikey)\|apiKey query param' internal/fmp/fmp_client.go internal/service/etf_flags.go \
  && GOWORK=off go build ./... && GOWORK=off go vet ./internal/fmp/ ./internal/service/ \
  && GOWORK=off golangci-lint run --modules-download-mode=mod
```
The lint call matches the CI `golangci-lint` job (`.github/workflows/ci.yml:352-357`, `version: v2.14.0`, `args: --modules-download-mode=mod` at `:357`, module root). It lints the test files too, which still compile mid-U1. The linter must be v2.14.0 built with go1.27 (`golangci-lint --version`); if not, install it per `.claude/skills/sdd-execute/reference/tooling-setup.md` (`GOTOOLCHAIN=go1.27.0 go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.14.0`) before this check and Steps 4 and 5.

---

### Step 3 — test: FMP header, redirect, CR/LF and gRPC-status regressions (U1)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/fmp/fmp_client_test.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**:
- Service owner `xstockstrat-marketdata`: OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency.
- Security: API keys and secrets. The key is still resolved only via `GetSecret`, and is never stored or logged.

**Codebase Evidence**:
- Harness helpers in `internal/fmp/fmp_client_test.go`:
  - `assertNoKeyLeak(t, err, wantPath)` at `:230-245`. It checks that the error names `fmp` and the path, has no `k-secret` and no `apikey=`, and that `errors.As(err, new(*url.Error))` is false.
  - `newLeakClient(baseURL)` at `:247-249`, which builds `APIKey: "k-secret"` and `Metrics: []string{"core"}` with no `HTTPClient`, so `NewClient`'s default client is used.
  - `vendorMetricReader` at `:525` and `collectVendorMetrics` at `:546`, with requests keyed `vendor/op/outcome`.
  - `captureSlog` at `:283`.
- The test to repoint is `TestVendorMetrics_FMP429_NoKeyOrSymbol_AC13` at `:598`. It captures `gotQuery = r.URL.Query()` (`:613-617`) and asserts `gotQuery.Get("apikey") != "SECRET123"` (`:625-626`).
- `grep -rn 'URL.Query()\|RawQuery\|apikey' --include=*_test.go internal/fmp internal/service` finds:
  - `fmp_client_test.go:616` and `:625-626`, which are repointed here;
  - `:239`, `:493` and `:636-645`, which are kept;
  - `internal/service/etf_flags_test.go:314-326,390-392`, which are kept (design step 4);
  - `internal/service/marketdata_service_test.go:4405`, which is kept.

  None of the others reads the key from a request.
- `TestEnrichment_WarnDoesNotLeakAPIKey` (`:481-497`) builds its error from `req.URL.String()` (`:484`). After the move the URL holds no key, so its assertion gets stronger without any edit.
- Service-level test home, confirmed at spec time (design § Open Risks):
  - `internal/service/marketdata_service_test.go`. The template is `TestFundamentals_TransportErrorStatusIsKeyFree_feature254` at `:4393-4417`, which uses `fmp.NewClient(fmp.ClientConfig{BaseURL: …, APIKey: "k-secret", Metrics: []string{"core"}})`, `newFundSvc(enabledCfg("fmp"), newFakeFundRepo(), client, &fakeNotify{}, "fmp")` and `connect.CodeOf(err) == connect.CodeUnavailable`.
  - The file already imports `net/http`, `net/http/httptest`, `log/slog`, `strings` and `connectrpc.com/connect` (`:8-21`), but not `bytes`.
  - The service maps the fetch error at `internal/service/marketdata_service.go:1856` (`connect.NewError(connect.CodeUnavailable, fmt.Errorf("%s fetch: %w", provider, err))`, in `GetFundamentalsMulti`).
- Go `net/http` (cited in debate.md O-7 and fails.md 2026-11-13):
  - `Client.do` parses `Location` before it calls `checkRedirect`, so an unparseable `Location` returns `failed to parse Location header %q` through the `Do` branch even after `CheckRedirect` lands.
  - On a redirect, custom headers are forwarded to any host. Only `Authorization`, `WWW-Authenticate`, `Cookie` and `Cookie2` are stripped.
  - O-15, verified at review time on Go 1.27.0: `net/http/transport.go` `validateHeaders` returns `field value for %q` with the header **name** only ("Don't include the value in the error, because it may be sensitive"). A local probe with `apikey: k-secret\n` gave `Get "<url>": net/http: invalid header field value for "Apikey"`, with 0 server hits. The error surfaces from `Do`, so it takes the `:289-296` unwrap. The `*url.Error` URL is key-free after the move in any case.
- C-13: `k-secret`, `SECRET123` and `AAPL` are sentinel scenario values that each test file already declares inline (`:248`, `:621`, `marketdata_service_test.go:4394`). They are test-double scaffolding, not shared domain fixtures, so no `internal/testdata` constant is added (precedent: `finnhub_client_test.go:26-27`).

**Lands with**: `Step 2, Step 4, Step 5`

**TDD**: `red-green required`.
- Run the new and repointed tests against the pre-U1 tree and record the observed failures in `context.md`. Never record a predicted failure. Expected RED:
  - AC-2: the query carries `apikey`, and the header is empty.
  - AC-1, client and service: the error and status text contain `apikey=k-secret`.
  - Cross-host: host B is hit, and `err` is nil.
  - CR/LF: no error, and the server is hit.
  - The repointed AC-13 test: the header is empty.
- Run the cross-host test again after Step 2's header move but **before** its `CheckRedirect` literal, and record that host B received the `apikey` header (D-5). Then GREEN after Step 2 is complete.

**Covers**: `AC-1, AC-2`

**Instructions**:
1. **@AC-2: `TestRequest_KeyInHeaderNotURL_AC2`.**
   - Start an `httptest.NewServer` that records, under a mutex, each request's `r.URL.Path`, `r.URL.RawQuery` and `r.Header.Get("apikey")`.
   - It answers `/stable/quote` with `[{"symbol":"AAPL","price":1}]` and the other paths with `[]`.
   - Build `NewClient(ClientConfig{BaseURL: srv.URL, APIKey: "k-secret", Metrics: []string{"core", "extended"}})` and call `GetFundamentalsMulti(ctx, []string{"AAPL"})`.
   - Assert the server saw all three paths: `/stable/quote`, `/stable/ratios-ttm` and `/stable/profile`.
   - For every recorded request, assert that `RawQuery` contains neither `apikey` nor `k-secret`, and that the recorded header equals `k-secret`.
   - Name `@AC-2` in the failure messages.
2. **@AC-1: `TestRedirectUnparseableLocation_DoesNotLeakAPIKey_AC1`.**
   - The server sets `Location: "/%zz?" + r.URL.RawQuery` and writes `http.StatusFound`. The `%zz` escape makes `url.Parse` fail.
   - Call `newLeakClient(srv.URL).GetFundamentalsMulti(ctx, []string{"AAPL"})`.
   - Assert `assertNoKeyLeak(t, err, "/stable/quote")`.
   - Use the default client (`newLeakClient` injects none), never `recordingRT` or `newTestClient` (`:29`, `:60`).
   - The test traces to the header move (D-1/D-4), not to `CheckRedirect`. Say so in a ≤2-line comment.
3. **D-5 and D-7: `TestRedirect_CrossHostNeverReceivesKey`.**
   - Host B is an `httptest` server that counts hits and records `r.Header.Get("apikey")` and `r.URL.RawQuery`, answering `[]`.
   - Host A answers `302` with `Location: hostB.URL + r.URL.Path`.
   - Call `vendorMetricReader(t)`, then `newLeakClient(hostA.URL).GetFundamentalsMulti(ctx, []string{"AAPL"})`.
   - Assert all of the following:
     - host B received 0 requests;
     - no recorded header or query on B contains `k-secret`;
     - `err.Error() == "fmp: /stable/quote returned HTTP 302"`;
     - `ErrorClass(err) == "http_302"` (230 `@AC-5` pin);
     - `collectVendorMetrics(t, reader).requests["fmp/quote/other"] == 1` (D-7: telemetry outcome `other`).
   - No `t.Parallel()`, because the test swaps the global MeterProvider (`:523`).
4. **O-15: `TestHeaderValidationError_DoesNotLeakAPIKey`.**
   - The server counts hits.
   - Build `NewClient(ClientConfig{BaseURL: srv.URL, APIKey: "k-secret\n", Metrics: []string{"core"}})`. This is `newLeakClient`'s shape with a CR/LF-bearing key. The client is built inline because `newLeakClient` hard-codes the key at `:248`, and its two existing callers stay unchanged.
   - Call `GetFundamentalsMulti`, then assert `assertNoKeyLeak(t, err, "/stable/quote")` and that the server received 0 requests.
   - This pins the key-free header-value validation error, a new key-bearing path that U1 creates.
5. **Repoint `TestVendorMetrics_FMP429_NoKeyOrSymbol_AC13`** (`:613-627`).
   - In the handler, also capture `gotKey = r.Header.Get("apikey")` for `/stable/profile`.
   - Replace the `:625-626` assertion with: `gotQuery.Get("symbol") == "AAPL"`, `!gotQuery.Has("apikey")` and `gotKey == "SECRET123"`.
   - The failure message names both the query and the header.
   - Keep `:629-646` unchanged, including `assertNoAttrContains(t, got, "SECRET123", "AAPL", "apikey")` and the span and log checks.
6. **@AC-1, service layer: `TestFundamentals_RedirectLocationErrorIsKeyFree_feature320`.**
   - Add it to `internal/service/marketdata_service_test.go` directly after the 254 test, which ends at `:4417`.
   - Install a `strings.Builder` as the target of `slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))`, and restore it in `t.Cleanup`. The file has no `bytes` import, and this needs none. No `t.Parallel()`.
   - Start the same 302 + `/%zz?`+query server as in item 2.
   - Build the client with `fmp.NewClient(fmp.ClientConfig{BaseURL: srv.URL, APIKey: "k-secret", Metrics: []string{"core"}})` and `svc := newFundSvc(enabledCfg("fmp"), newFakeFundRepo(), client, &fakeNotify{}, "fmp")`.
   - Call `svc.GetFundamentalsMulti(ctx, []string{"AAPL"})`.
   - Assert all of the following:
     - `connect.CodeOf(err) == connect.CodeUnavailable`;
     - the message contains `fmp`;
     - the message contains neither `k-secret` nor `apikey=`;
     - `logs.String()` contains neither `k-secret` nor `apikey=`.
   - Name `@AC-1` in the failure messages.

**Verification**: the union in Step 5. Step-local check, run from the repo root:
```bash
cd services/xstockstrat-marketdata \
  && GOWORK=off go test ./internal/fmp/ ./internal/service/ -race -count=1 \
       -run 'TestRequest_KeyInHeaderNotURL_AC2|TestRedirectUnparseableLocation_DoesNotLeakAPIKey_AC1|TestRedirect_CrossHostNeverReceivesKey|TestHeaderValidationError_DoesNotLeakAPIKey|TestVendorMetrics_FMP|TestTransportError_|TestBuildRequestError_|TestEnrichment_WarnDoesNotLeakAPIKey|TestFundamentals_RedirectLocationErrorIsKeyFree_feature320|TestFundamentals_TransportErrorStatusIsKeyFree_feature254|TestEtfFlagFiller_FailLogsClassOnly_AC5' -v \
  && grep -c "@AC-1\|@AC-2" internal/fmp/fmp_client_test.go
```
C-13: `grep -rn '"k-secret"' --include=*_test.go internal/fmp` shows only the per-file inline sentinels. No new shared literal or `internal/testdata` symbol is added.

---

### Step 4 — service: Finnhub key moves to the `X-Finnhub-Token` header; the default client refuses redirects (U1)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go` — modify

**Reviewers**:
- Service owner `xstockstrat-marketdata`: OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency.
- Security: API keys and secrets. The key is still resolved only via `GetSecret`, and is never stored or logged.

**Codebase Evidence**:
- `grep -n 'params.Set("token"' internal/finnhub/finnhub_client.go` gives `:126`. Its nil guard is at `:123-125`, and the URL is built at `:129`.
- The request is built at `:130`. The build-request branch runs `:131-138`.
- The `Do` unwrap at `:140-147` (`fmt.Errorf("finnhub: %s request failed: %w", path, ue.Err)`, with the cause-free fallback at `:146`) stays as it is. Finnhub does not wrap in a `stageError` (recon.md § Codebase Map).
- Default client: `httpClient = &http.Client{Timeout: 30 * time.Second}` at `:46`, inside `NewClient` at `:43`. The doc at `:42` reads "A nil HTTPClient defaults to a 30s-timeout client."
- The `HTTPClient` field doc at `:28` reads "HTTPClient is injectable so tests can assert call counts and stub responses."
- Per-request key read: the `apiKey` closure at `:52-55`, stored at `:58`.
- Production construction: `newFundamentalsSource` at `cmd/server/main.go:221-229`, with no `HTTPClient` injected.
- Comments that become false:
  - `:120-121`: "getJSON builds a URL under baseURL with the "token" auth param (never logged) … Finnhub's auth param is "token", not FMP's "apikey"."
  - `:132`: "*url.Error carries the token-bearing URL: wrap only its inner cause."
  - `:156`: "Never include the URL (it carries the token) in the error."
- Non-200 text: `fmt.Errorf("finnhub: %s returned HTTP %d", path, resp.StatusCode)` at `:157`, with `outcome = telemetry.HTTPErrorOutcome(resp.StatusCode)` at `:155`. A 3xx therefore gives outcome `other` (`internal/telemetry/otel.go:375-385`; re-anchored from `:362-372` at the 2026-11-13 re-spec, behavior unchanged).
- Callers pass non-nil `params`: `:181-184`, `:192-194`, and `fetchProfile` from `:200`.

**Lands with**: `Step 2, Step 3, Step 5`

**TDD**: `red-green required`. RED means Step 5's tests fail before this step (see Step 5 **TDD**).

**Covers**: —

**Instructions**:
1. In `getJSON`, delete `params.Set("token", c.apiKey())` (`:126`) and the nil guard (`:123-125`), for the same reason as in Step 2.
2. Directly after the build-request `if err != nil { … }` block closes (`:138`), and before `outcome, sentAt = telemetry.VendorTransport, time.Now()`, add `req.Header.Set("X-Finnhub-Token", c.apiKey())`. Read the key per call through `c.apiKey()`.
3. In `NewClient`, change the default at `:46` to `httpClient = &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}`.
4. Rewrite the doc comments:
   - `:42` → "A nil HTTPClient defaults to a 30s-timeout client that refuses redirects."
   - `:28`: keep the first sentence and add "An injected client must refuse redirects; the key travels in a request header."
5. Rewrite the comments that are now false:
   - `:120-121` → "getJSON GETs path under baseURL and decodes the JSON response into dst. The key travels only in the X-Finnhub-Token request header, never in the URL, an error or a log."
   - `:132` → "Wrap only *url.Error's inner cause: an error never carries the request URL."
   - `:156` → "Never include the URL in the error."
6. Leave `finnhubOp`, the `Do` unwrap and the `:157` status text unchanged.

**Verification**: the union in Step 5. Step-local checks:
```bash
cd services/xstockstrat-marketdata \
  && ! grep -n 'params.Set("token"' internal/finnhub/finnhub_client.go \
  && test "$(grep -c 'req.Header.Set("X-Finnhub-Token", c.apiKey())' internal/finnhub/finnhub_client.go)" -eq 1 \
  && test "$(grep -c 'http.ErrUseLastResponse' internal/finnhub/finnhub_client.go)" -eq 1 \
  && ! grep -n 'token-bearing URL\|it carries the token\|"token" auth param' internal/finnhub/finnhub_client.go \
  && GOWORK=off go build ./... && GOWORK=off go vet ./internal/finnhub/ \
  && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 5 — test: Finnhub header and redirect regressions; the `cmd/server` fakes read the header (U1)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client_test.go` — modify
- `services/xstockstrat-marketdata/cmd/server/main_test.go` — modify

**Reviewers**:
- Service owner `xstockstrat-marketdata`: OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency.
- Security: API keys and secrets. The key is still resolved only via `GetSecret`, and is never stored or logged.

**Codebase Evidence**:
- Harness helpers in `internal/finnhub/finnhub_client_test.go`:
  - `assertNoKeyLeak` at `:261-276`. It checks that the error names `finnhub` and the path, has no `k-secret` and no `token=`, and that `errors.As(*url.Error)` is false.
  - `newLeakClient(baseURL)` at `:278-280`, built with `APIKey: "k-secret"` and no `HTTPClient`.
  - `vendorMetricReader` at `:312` and `collectVendorMetrics` at `:333`.
- The test to repoint is `TestVendorMetrics_Finnhub429_NoTokenOrSymbol_AC13` (`:385`). It reads `gotToken = r.URL.Query().Get("token")` at `:394` and asserts `gotToken != "SECRET123"` at `:402-404`. Its checks at `:406-416` are kept.
- O-14 / R-7: `GetFundamentals` → `fetchOne` returns the per-path error (`finnhub_client.go:67-69,92-104`). `GetFundamentalsMulti` swallows per-symbol errors (`:80-85`), so the AC-1 test must go through `GetFundamentals`.
- `cmd/server/main_test.go`:
  - The `vendorFake` doc is at `:157` ("records hits and the key query param it saw").
  - `newVendorFake(t, keyParam, body string)` is at `:165`, and reads `r.URL.Query().Get(keyParam)` at `:171`.
  - Callers: `:195` `"apikey"`, `:196` `"token"` and `:297` `"apikey"`.
  - Key assertions: `:221` (`key != "fmp-key"`), `:318`, `:328` and `:363` (rotation keys). No assertion reads the Finnhub fake's key; `:208,214,224` read hits only.
- `seedQuoteRT` (`:81-91`) and `secHostRedirect` (`:377`) do not read the key, so they are unchanged.
- C-13: the same inline sentinel verdict as Step 3. `newVendorFake` is test-double scaffolding with a single consumer file.

**Lands with**: `Step 2, Step 3, Step 4`

**TDD**: `red-green required`.
- Against the pre-U1 tree, record the observed RED. Expected:
  - AC-2: `token` in the query and an empty header.
  - AC-1: the error carries `token=k-secret`.
  - Cross-host: host B is hit, and `err` is nil.
  - The repointed AC-13 test: the header is empty.
  - `main_test.go` `:221` and `:318`: the key is `""`.
- Run the cross-host test again after Step 4's header move but before its `CheckRedirect` literal, and record that host B received `X-Finnhub-Token` (D-5). Then GREEN after Step 4.

**Covers**: `AC-1, AC-2`

**Instructions**:
1. **@AC-2: `TestRequest_KeyInHeaderNotURL_AC2`.**
   - Start an `httptest` server that records `r.URL.Path`, `r.URL.RawQuery` and `r.Header.Get("X-Finnhub-Token")` under a mutex.
   - It answers `/stock/metric` with `{"metric":{}}` and the other paths with `{}`, which is the shape at `:245-250`.
   - Call `newLeakClient(srv.URL).GetFundamentals(ctx, "AAPL")`.
   - Assert the server saw all three paths: `/stock/metric`, `/quote` and `/stock/profile2`.
   - For every recorded request, assert that `RawQuery` contains neither `token` nor `k-secret`, and that the header equals `k-secret`.
2. **@AC-1, O-14: `TestRedirectUnparseableLocation_DoesNotLeakAPIKey_AC1`.**
   - The server sets `Location: "/%zz?" + r.URL.RawQuery` and writes `302`.
   - Call `newLeakClient(srv.URL).GetFundamentals(ctx, "AAPL")`. Use `GetFundamentals`, not `GetFundamentalsMulti`, because of R-7.
   - Assert `assertNoKeyLeak(t, err, "/stock/metric")`. That checks for no `k-secret` and no `token=`, and that `errors.As(*url.Error)` is false.
3. **D-5: `TestRedirect_CrossHostNeverReceivesKey`.**
   - Host B counts hits and records `r.Header.Get("X-Finnhub-Token")` and `RawQuery`.
   - Host A answers `302` with `Location: hostB.URL + r.URL.Path`.
   - Call `vendorMetricReader(t)`, then `newLeakClient(hostA.URL).GetFundamentals(ctx, "AAPL")`.
   - Assert all of the following:
     - B received 0 requests;
     - nothing recorded on B contains `k-secret`;
     - `err.Error() == "finnhub: /stock/metric returned HTTP 302"`;
     - `collectVendorMetrics(t, reader).requests["finnhub/metric/other"] == 1`.
   - No `t.Parallel()`.
4. **Repoint `TestVendorMetrics_Finnhub429_NoTokenOrSymbol_AC13`.**
   - At `:394`, record both `gotToken = r.Header.Get("X-Finnhub-Token")` and `gotQuery = r.URL.Query()`.
   - At `:402-404`, assert `gotToken == "SECRET123"` and `!gotQuery.Has("token")`.
   - Keep `:406-416`.
5. **`cmd/server/main_test.go`:**
   - Rename `newVendorFake`'s parameter `keyParam` → `keyHeader`, and read `r.Header.Get(keyHeader)` at `:171`.
   - Update the `vendorFake` doc at `:157` to "records hits and the key header it saw".
   - Change the `:196` argument `"token"` → `"X-Finnhub-Token"`. Leave `:195` and `:297` as `"apikey"`.
   - The assertions at `:221`, `:318`, `:328` and `:363` stay unchanged and now prove 295 `@AC-16` over the header.

**Verification**: this is the union for U1 (Steps 2-5). Run it from the repo root. It covers the step-local checks of Steps 2 and 4, the named RED→GREEN and pin tests, the 40% coverage floor and lint.
```bash
cd services/xstockstrat-marketdata \
  && ! grep -n 'params.Set("apikey"' internal/fmp/fmp_client.go \
  && ! grep -n 'params.Set("token"' internal/finnhub/finnhub_client.go \
  && test "$(grep -c 'http.ErrUseLastResponse' internal/fmp/fmp_client.go)" -eq 1 \
  && test "$(grep -c 'http.ErrUseLastResponse' internal/finnhub/finnhub_client.go)" -eq 1 \
  && ! grep -n 'URL.Query().Get(' cmd/server/main_test.go internal/finnhub/finnhub_client_test.go \
  && export GOWORK=off \
  && go test ./internal/fmp/ ./internal/finnhub/ ./internal/service/ ./cmd/server/ -race -count=1 \
       -run 'TestRequest_KeyInHeaderNotURL_AC2|TestRedirectUnparseableLocation_DoesNotLeakAPIKey_AC1|TestRedirect_CrossHostNeverReceivesKey|TestHeaderValidationError_DoesNotLeakAPIKey|TestVendorMetrics_|TestTransportError_|TestBuildRequestError_|TestEnrichment_WarnDoesNotLeakAPIKey|TestHTTPError_DoesNotLeakAPIKey|TestFundamentals_RedirectLocationErrorIsKeyFree_feature320|TestFundamentals_TransportErrorStatusIsKeyFree_feature254|TestEtfFlagFiller_FailLogsClassOnly_AC5|TestFundamentalsSource_ProviderSwitchIsLive_AC7|TestLiveSecrets_RotationReachesNextFMPRequest_AC16' -v \
  && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:" \
  && golangci-lint run --modules-download-mode=mod \
  && cd ../.. && DUP_REPORT_ONLY=1 python3 scripts/check-duplication.py services/xstockstrat-marketdata/internal
```
The `COVERPKGS`/`-coverpkg` lines and the lint call mirror CI `.github/workflows/ci.yml:374-375` and `:352-357`. The DRY check is `scripts/check-duplication.py` (jscpd, report-only for Go: `.husky/pre-commit:18` runs it with `DUP_REPORT_ONLY=1`). Commit `c87c084c` ported it from `scripts/check-duplication.sh`, which no longer exists. If the report pairs the two `CheckRedirect` default-client literals, that is the accepted R-2 trade-off (C-18): record it in `context.md`. Any other new clone is fixed before the U1 commit.

Confirm that the `total:` line is ≥ 40%. The changed logic lives in `internal/fmp` and `internal/finnhub`, which the measurement includes. The `internal/service` and `cmd/server` edits are tests or comments in excluded packages. C-13 is satisfied: no `internal/testdata` symbol is added. `grep -rn "k-secret" --include=*_test.go internal/finnhub cmd/server` shows only the inline per-file sentinels.

---

### Step 6 — docs: marketdata CLAUDE.md, MARKETDATA-18 invariant, findings resolved, durable scenarios amended (design step 4, O-13)

**Status**: `pending`
**Service**: `xstockstrat-marketdata` (docs and durable acceptance suites)
**Files**:
- `services/xstockstrat-marketdata/docs/fundamentals.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-marketdata/acceptance/fix-marketdata-secret-exposure.feature` — modify
- `services/xstockstrat-marketdata/acceptance/signal-map-instrumentation.feature` — modify

**Reviewers**: none

**Codebase Evidence**:
- Re-anchored at the 2026-11-13 re-spec (main-dev `d5de836b`, after the context refresh `5c4cc935` / #1539):
- `CLAUDE.md` § Fundamentals Integration (`:107-109`) is now a one-line pointer to `docs/fundamentals.md`. The vendor-secret paragraph lives at `docs/fundamentals.md:66-72` and ends "Every other knob (`enabled`, `base_url`, cache/quota settings) remains an ordinary config key." (`:71-72`, the line `:72` is `key.`).
- `docs/context-constitution.md`:
  - The header at `:3` reads "last refreshed 2026-11-13 (`main-dev` @ `52f6d5a`)." There is no per-feature amendment log any more (the old `:5` log line is gone; `:5` is a description line).
  - Rule rows run `:15-30`; the last is `MARKETDATA-17` at `:30`, followed by `## Norms` at `:32`.
  - The highest ID is `MARKETDATA-17` (`grep -no "MARKETDATA-[0-9]*"`). `MARKETDATA-15` exists only as a `(candidate)` entry at `:50` and has no rule row, so `MARKETDATA-18` is the next free ID, and 15 stays reserved. `grep -c MARKETDATA-18` returns 0.
  - The row format is `| ID | Rule | Why | Evidence | Example (canonical path:line) |` (`:13`).
- `docs/context-constitution-findings.md`:
  - `:40` is the open question "`fmp.getJSON` deliberately omits the URL from every error because it carries the `apikey` query param — confirm this "never log the URL" rule is a hard security invariant to enshrine … — status: **open**".
  - `:41` is a separate bullet: the `newFundamentalsSource` fail-open question, status **open**. It no longer carries the fmp question ("(carried above)" is gone).
  - The `## Resolved` heading is at `:47`. Its newest entries take the form `- **RESOLVED 2026-11-10 — …**: …`.
  - This is the service-scoped file, not the root `docs/` file (D-8).
- `acceptance/fix-marketdata-secret-exposure.feature:9-15` is `@AC-1 @FR-1 @regression @feature-254` (FMP), and `:17-23` is `@AC-2 @FR-2 @regression @feature-254` (Finnhub).
- `acceptance/signal-map-instrumentation.feature:13-21` is `@AC-13 @FR-4 @feature-294`. Its Given at `:15` reads `for URL "https://fmp.example/stable/profile?symbol=AAPL&apikey=SECRET123"`, and the Then at `:19` is kept.
- `acceptance/fix-etf-flag-fill.feature:55` (the synthetic error text) is left unchanged (design step 4).

**TDD**: `N/A (docs and durable acceptance text; behavior is proven by Steps 3 and 5)`

**Covers**: —

**Instructions**:
1. **`docs/fundamentals.md`**: after `:72` (`key.`), add one sentence to the same paragraph. `CLAUDE.md` is not edited; its § Fundamentals Integration already points here.

   > Each key is sent only in a request header (FMP `apikey`, Finnhub `X-Finnhub-Token`), never in the
   > URL, and the default vendor clients refuse redirects so the header never follows a 3xx (feature 320).
2. **`docs/context-constitution.md`**: insert a `MARKETDATA-18` row after `MARKETDATA-17` (`:30`), before the blank line and `## Norms` (`:32`).
   - Rule: "**A vendor API key travels only in a per-request header (FMP `apikey`, Finnhub `X-Finnhub-Token`), read through `c.apiKey()` on every call; no request URL, error text, status message, log line or telemetry attribute carries it, and the default clients refuse redirects (`CheckRedirect` → `http.ErrUseLastResponse`).**"
   - Why: "A query-string key leaks through a redirect `Location`-parse error and every URL-logging access log or proxy (feature 320). A custom header is forwarded on a cross-host redirect, because Go strips only `Authorization`/`WWW-Authenticate`/`Cookie`/`Cookie2`. An injected `HTTPClient` must refuse redirects too."
   - Evidence: `internal/fmp/fmp_client.go#getJSON`, `#NewClient`; `internal/finnhub/finnhub_client.go#getJSON`, `#NewClient`; guard tests `#TestRequest_KeyInHeaderNotURL_AC2`, `#TestRedirect_CrossHostNeverReceivesKey`, `#TestRedirectUnparseableLocation_DoesNotLeakAPIKey_AC1` (both packages), and `internal/service/marketdata_service_test.go#TestFundamentals_RedirectLocationErrorIsKeyFree_feature320`.
   - Example: `internal/fmp/fmp_client.go#getJSON`.
   - The header no longer keeps a per-feature amendment log (`:3` is a "last refreshed" stamp), so add no header entry and leave `:3` unchanged; the new row is the record. Re-run the `MARKETDATA-17` check at execute time, because a peer may land a new ID first.
3. **`docs/context-constitution-findings.md`**:
   - Delete the `:40` bullet (the `fmp.getJSON` open question).
   - Leave the `:41` `newFundamentalsSource` fail-open bullet unchanged, with its **open** status.
   - Add under `## Resolved`, newest first: `- **RESOLVED 2026-11-13 — is "fmp.getJSON never includes the URL in errors" a hard invariant?**: yes. It is enshrined as constitution MARKETDATA-18 (feature 320). The key no longer rides in the URL at all; it travels only in a request header, and URLs, errors and logs are key-free.`
4. **`acceptance/fix-marketdata-secret-exposure.feature`**: amend in place (C-16 EXTEND; fails.md trap 2026-11-04). Keep every existing 254 line.
   - Tags at `:9` → `@AC-1 @FR-1 @regression @feature-254 @feature-320`. After `:15`, append:
     - `And the same holds when the vendor answers 302 with an unparseable Location header that echoes the request query`
     - `And the request URL received by the vendor endpoint does not contain "apikey=" or "k-secret", because the key is sent in the "apikey" header`
   - Tags at `:17` → `@AC-2 @FR-2 @regression @feature-254 @feature-320`. After `:23`, append:
     - `And the same holds for GetFundamentals when the vendor answers 302 with an unparseable Location header that echoes the request query`
     - `And the request URL received by the vendor endpoint does not contain "token=" or "k-secret", because the key is sent in the "X-Finnhub-Token" header`

   Spec-time precision: the design lists the Finnhub redirect case under `@AC-1`, but `@AC-1` is the FMP scenario, so that case lands in the Finnhub scenario `@AC-2`. This is recorded in `context.md`.
5. **`acceptance/signal-map-instrumentation.feature`** (O-13):
   - Tags at `:13` → `@AC-13 @FR-4 @feature-294 @feature-320`.
   - The Given at `:15` becomes `Given an FMP request that returns HTTP 429 for URL "https://fmp.example/stable/profile?symbol=AAPL" with key "SECRET123" sent in the "apikey" header`.
   - Lines `:16-21` are unchanged, including "no metric attribute, span attribute or log line contains "SECRET123"".
   - The file's "Verbatim; do not edit by hand" header (`:1`) is about promotion. This edit is the C-16 in-place EXTEND that the design mandates, so leave the header as it is.
   - No CI guard rejects the edit. This was checked at review: no `.github/workflows/*.yml` job and no `scripts/` or `.husky/` hook reads `services/*/acceptance/`. The only `.feature`-aware guard, `scripts/check-otel-produced-signals.sh`, keeps `.feature` files outside its glob (`check-otel-produced-signals.test.sh:402`).

**Verification**:
```bash
cd services/xstockstrat-marketdata \
  && grep -n "X-Finnhub-Token" docs/fundamentals.md docs/context-constitution.md \
  && grep -n "feature 320" docs/fundamentals.md \
  && test "$(grep -c '^| \*\*MARKETDATA-18\*\*' docs/context-constitution.md)" -eq 1 \
  && grep -n "RESOLVED 2026-11-13" docs/context-constitution-findings.md \
  && ! grep -n "fmp.getJSON" docs/context-constitution-findings.md | grep -q "status: \*\*open\*\*" \
  && grep -n "newFundamentalsSource" docs/context-constitution-findings.md | grep -q "status: \*\*open\*\*" \
  && test "$(grep -c '@feature-254 @feature-320' acceptance/fix-marketdata-secret-exposure.feature)" -eq 2 \
  && grep -n '@AC-13 @FR-4 @feature-294 @feature-320' acceptance/signal-map-instrumentation.feature \
  && ! grep -n 'apikey=SECRET123' acceptance/signal-map-instrumentation.feature \
  && grep -c 'does not contain "apikey="' acceptance/fix-marketdata-secret-exposure.feature
```

---

## Post-Deploy Confirmation (design step 5; not an execute step)

This runs after the integration PR deploys to dev. The operator records the result in `context.md`
before `/promote`, and it does not block any step commit.

1. Record dev's `marketdata.fmp.enabled`, `marketdata.finnhub.enabled` and
   `marketdata.fundamentals.snapshot_source`.
2. For each live vendor, record `marketdata.vendor.requests{vendor, outcome ∈ ok, http_4xx, other, decode}`
   over equal windows before and after the deploy.
   - Pass if the `ok` share does not fall and none of `http_4xx`, `other` or `decode` rises.
   - The pass also requires a non-zero `ok` count after the deploy. That positive control shows the sink
     returns marketdata series at all (insights.md 2026-11-04, fix-marketdata-secret-exposure).
3. A vendor path that is off on dev is either turned on for the window (the flags are read live) or
   recorded as "not exercised on dev". If it is recorded that way, the check is repeated at the first
   environment where it is live.

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
