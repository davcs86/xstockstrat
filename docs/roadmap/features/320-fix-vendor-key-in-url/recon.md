# Recon: fix-vendor-key-in-url

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: detached@c4fd48b0 ≡ origin/main-dev (no `feature/fix-vendor-key-in-url` branch on origin yet); citations re-grepped at this tree
**Affected services**: xstockstrat-marketdata

---

## Objective

The FMP and Finnhub fundamentals clients still put the vendor API key in the request query string (`apikey=`, `token=`). That leaves two residuals that feature 254 accepted. (a) When a vendor redirect has an unparseable `Location`, the inner `*url.Error` cause quotes that `Location` and can carry the key into error text, the gRPC `Unavailable` status and logs. (b) Every request URL holds the key, so vendor access logs and any URL-logging egress proxy record it. The fix must make sure no vendor key leaves the process in any error, log line or URL. The class fix is to send the key in a request header. Whether the vendors support header auth is unverified.

## Codebase Map

- **`xstockstrat-marketdata`** (Go 1.27)
  - FMP HTTP chokepoint: `getJSON` — `services/xstockstrat-marketdata/internal/fmp/fmp_client.go:256`. This is the only FMP HTTP site.
    - Key in the query: `params.Set("apikey", c.apiKey())` — `fmp_client.go:260`
    - URL build: `u := c.baseURL() + path + "?" + params.Encode()` — `fmp_client.go:263`. Request at `:264` (`http.NewRequestWithContext`).
    - Build-request error: `errors.As(err, &ue)` then `%w`-wraps only `ue.Err` — `fmp_client.go:268-269`
    - `Do` error: `errors.As(err, &ue)` then `&stageError{"transport", fmt.Errorf("fmp: %s request failed: %w", path, ue.Err)}` — `fmp_client.go:292-293`. **This is where residual (a) leaks**: the redirect-parse cause is `ue.Err`, and its text quotes `Location`.
    - Telemetry: `defer telemetry.RecordVendorRequest(ctx, telemetry.VendorFMP, fmpOp(path), outcome, sentAt)` — `fmp_client.go:262`. `fmpOp(path)` at `:319` maps only the path to a closed op label. The URL is never passed to telemetry.
    - Secret-free error types: `statusError` at `fmp_client.go:332` and `stageError` at `:340`. `ErrorClass` at `:389` has the doc comment "never its text, which can carry apikey=".
  - Finnhub HTTP chokepoint: `getJSON` — `services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go:122`
    - Key in the query: `params.Set("token", c.apiKey())` — `finnhub_client.go:126`
    - URL build at `:129`, request at `:130`. Build-request error unwrap at `:134-135`.
    - `Do` error: `fmt.Errorf("finnhub: %s request failed: %w", path, ue.Err)` — `finnhub_client.go:143-144`. It falls back to a cause-free message at `:146`. Note that Finnhub does **not** wrap in a `stageError`, so the two clients' `Do` sites differ in shape.
    - Telemetry: `RecordVendorRequest(..., telemetry.VendorFinnhub, finnhubOp(path), ...)` — `finnhub_client.go:128`. `finnhubOp` is at `:167`.
  - HTTP client construction. Both clients build it the same way and neither sets `CheckRedirect`:
    - `httpClient = &http.Client{Timeout: 30 * time.Second}` — `fmp_client.go:73` (in `NewClient` at `:70`) and `finnhub_client.go:46` (in `NewClient` at `:43`).
    - This client is used only when `cfg.HTTPClient` is not injected.
  - Key resolution, read per request:
    - `ClientConfig.APIKeyFunc` (`fmp_client.go:48`, doc at `:45`: "read on every call") falls back to `func() string { return cfg.APIKey }` (`fmp_client.go:79-81`; Finnhub `finnhub_client.go:53-54`).
    - The secrets are `marketdata.fmp.api_key` and `marketdata.finnhub.api_key`, resolved via `GetSecret` (marketdata `CLAUDE.md` § Fundamentals Integration).
  - Service-layer consumer of the FMP error class: `internal/service/etf_flags.go:131` (doc: never logs error text, "it can carry apikey=") and `:170` (`class := fmp.ErrorClass(err)`).
  - Last migration: `009_symbol_classification.up.sql` (`services/xstockstrat-marketdata/migrations/`). No migration is needed.
  - Out of scope:
    - Alpaca client (`internal/alpaca/client.go`). It authenticates with headers, and its only query param is `page_token`.
    - EDGAR, which is keyless (marketdata `CLAUDE.md`, `edgar.user_agent`).

## Patterns to REUSE

- Error unwrap: `errors.As(err, &ue)` then `%w`-wrap `ue.Err`, with a cause-free fallback. Reuse the 254 pattern at `fmp_client.go:268-269,292-293` and `finnhub_client.go:134-135,143-146`. It keeps `errors.Is(err, context.DeadlineExceeded)` working (fails.md 2026-10-22 rule).
  - If a shared `redactURLError` is introduced, it consolidates these **4 sites**.
  - No shared vendor-HTTP package exists. `internal/telemetry` is the only package both clients import.
  - A home for the helper is a design decision. Duplicating it per client is a DRY concern (C-18 / dry-reviewer).
- Per-request key read: use the existing `c.apiKey()` closure. A header-based key must be set per request (`req.Header.Set(...)` after `NewRequestWithContext`), never baked into a transport or a header map at construction. This preserves 295 `@AC-16`.
- Leak-test harness (FMP), `internal/fmp/fmp_client_test.go`:
  - `assertNoKeyLeak(t, err, wantPath)` at `:230`: the error names vendor and path, contains neither `k-secret` nor `apikey=`, and `errors.As(err, new(*url.Error))` is false.
  - `newLeakClient(baseURL)` at `:247`.
  - `recordingRT` at `:29` and `newTestClient` at `:60` (a RoundTripper mock).
  - Existing tests: `TestTransportError_DoesNotLeakAPIKey_AC1` at `:252`, `TestBuildRequestError_DoesNotLeakAPIKey` at `:261`, `TestTransportError_PreservesDeadlineCause` at `:268`, `TestEnrichment_WarnDoesNotLeakAPIKey` at `:481`.
- Leak-test harness (Finnhub), `internal/finnhub/finnhub_client_test.go`: `TestHTTPError_DoesNotLeakAPIKey` at `:215` (no `k-secret` and no `token=`, asserted at `:270`), `TestTransportError_DoesNotLeakAPIKey_AC2` at `:283`, `TestBuildRequestError_DoesNotLeakAPIKey` at `:289`.
- New 320 tests can use an `httptest.NewServer` handler for both cases. It can answer 302 with a bad `Location` (@AC-1), and it can record `r.URL` / `r.Header` (@AC-2). No such test exists today.
- A header move breaks the FMP test that pins the key in the query: `fmp_client_test.go:626` (`want symbol=AAPL&apikey=SECRET123`). Update it in the same step.

## Existing Business Rules (preserve / extend)

- **EXTEND** `@AC-1` "An FMP transport failure never reveals the API key" (`services/xstockstrat-marketdata/acceptance/fix-marketdata-secret-exposure.feature:9`, @feature-254). 320 adds the redirect/unparseable-`Location` case next to it. The 254 assertions are unchanged: the error names "fmp" and "/stable/quote", with no key and no "apikey=".
- **EXTEND** `@AC-2` "A Finnhub transport failure never reveals the token" (same file `:17`, @feature-254). 320 adds "request URLs carry no token". The 254 assertions are unchanged: the error names "finnhub" and "/stock/metric", with no key and no "token=".
- **PRESERVE** `@AC-5` "The marketdata gRPC Unavailable status never carries the vendor key" (same file `:25`, @feature-254). The `GetFundamentals` UNAVAILABLE message names "fmp", with no key and no "apikey=".
- **PRESERVE** `@AC-7` "The marketdata batch Unavailable status never carries the vendor key" (same file `:35`, @feature-254). This is the same guarantee on `GetFundamentalsMulti`, which is also the subject of 320 @AC-1.
- **PRESERVE** `@AC-5` "A failed fill logs only the error class, never the raw error text" (`services/xstockstrat-marketdata/acceptance/fix-etf-flag-fill.feature:53`, @feature-230). A shared helper must not change `fmp.ErrorClass` output or the class-only logging at `etf_flags.go:170`.
- **PRESERVE** `@AC-13` "Vendor requests are counted by bounded outcome without leaking the FMP key" (`services/xstockstrat-marketdata/acceptance/signal-map-instrumentation.feature:13`, @feature-294). Keep the `outcome` classification, such as `http_429`, `transport` and `build`, and the `op` classification, such as `profile`.
  - Recon correction to the scenario digest: no URL "scrubbing" code exists in `internal/telemetry`. The guarantee holds because only `fmpOp(path)` (`fmp_client.go:319`) and closed outcome constants reach telemetry, never the URL.
  - The design must keep the URL away from every metric, span and log attribute. It must not add a URL-bearing attribute or span (for example, `otelhttp` default attributes).
- **PRESERVE** `@AC-16` "A rotated vendor secret is used without a restart" (`services/xstockstrat-marketdata/acceptance/fix-config-keys-drift.feature:14`, @feature-295). The header key must come from `c.apiKey()` per request.
- No CHANGE flags. Both 320 ACs strengthen 254 without altering an existing guarantee, so no C-16 sign-off is needed unless the design drops a 254 assertion.
- `docs/sdd/business-rules/platform.feature` has no scenario about vendor API keys in URLs or redirect errors. Coverage is partial: lines 1-785 were read and the rest was keyword-grepped.

## Dependencies

- Proto/RPC: none
- Migration: none (latest is `009`)
- Config keys: none. Same `marketdata.fmp.api_key` / `marketdata.finnhub.api_key` secrets; only the transport changes.
- Inter-service edges: none (outbound vendor HTTP only)
- New env vars / ports: none
- Docs: marketdata `CLAUDE.md` § Fundamentals Integration (the vendor-secret contract). Add one line if the key's transport changes.
  - Related open finding: `services/xstockstrat-marketdata/docs/context-constitution-findings.md:39-40` asks whether "`fmp.getJSON` never includes the URL in errors" is a hard security invariant. This feature is the natural place to answer it.

## Risks / Not-found

- **Open Question 1 is unresolved: vendor header auth.** The repo has no evidence that FMP accepts an `apikey` header or that Finnhub accepts `X-Finnhub-Token`.
  - This is a design fork. If header auth is unsupported, the query key stays.
  - In that case residual (b) cannot close in-process. 320 @AC-2 would then need an explicit, user-signed residual acceptance in `context.md` (product-spec OQ2).
  - Recon must not guess; the design or the operator must verify against vendor docs.
- **Redirect-error cut point (design fork).** There are two ways to stop the leak:
  - Set `CheckRedirect` (or `http.ErrUseLastResponse`) on the default `http.Client` at `fmp_client.go:73` / `finnhub_client.go:46`. An injected `cfg.HTTPClient` bypasses this.
  - Sanitize `ue.Err` at the 4 `Do`/build sites through a shared `redactURLError`.

  The `Location` parse failure surfaces from `Do`, and its inner `.Err` quotes the header. Even with a header-auth move, an echoed query would hold no key. Defence in depth is product-spec OQ3.
- **Asymmetric `Do` wrapping.** FMP wraps in `stageError{"transport"}` and Finnhub does not (`finnhub_client.go:144`). A shared helper must not change `fmp.ErrorClass` results (230 @AC-5) or the telemetry `outcome` (294 @AC-13).
- **Header names are a vendor contract.** The wrong name means every call 401s while unit tests stay green. The design needs a dev smoke test (product-spec Acceptance: "smoke-tested on dev").
- **fails.md traps that apply:**
  - 2026-10-22 (fix-marketdata-secret-exposure): unwrap `*url.Error`, wrap only `ue.Err`, and prove it with a test that the key is absent and `errors.As(*url.Error)` is false.
  - 2026-11-04 (fix-marketdata-secret-exposure, jscpd): do not cite jscpd as the gate for duplicated **test** helpers, since `.jscpd.json` ignores `**/*_test.go`. Justify extraction by C-18 or dry-reviewer.
  - 2026-11-04 (C-16 promotion form): if any 254 scenario is tightened rather than extended, amend it in place with a `@feature-320` tag. Do not add a parallel scenario.
- Not found:
  - No `redactURLError` anywhere in marketdata.
  - No `CheckRedirect` in any marketdata Go file.
  - No existing redirect-302 or URL-recording test for either vendor.
- Unscoped risk: other marketdata tests (the fundamentals cache, ETF-flag and sector suites) may build fake servers or `recordingRT` responders that read the key from the query. These were grep-scanned only, so re-check them at spec time.

## Recommended Scope

Advisory only, not binding:
1. Resolve OQ1 (vendor header-auth support for FMP and Finnhub). Record the evidence or the operator's decision in `context.md`. This gates step 3.
2. RED tests:
   - FMP: `httptest` 302 with an unparseable `Location` that echoes the query, asserted via `assertNoKeyLeak` plus the gRPC status (@AC-1).
   - FMP and Finnhub: `httptest` handlers that record `r.URL` and assert no `apikey=` / `token=` / key value (@AC-2).
3. Move the key to a per-request header in both `getJSON` sites, reading `c.apiKey()` per call. Drop `params.Set`, and update `fmp_client_test.go:626`. If OQ1 is negative for a vendor, do this step only for the vendor that supports it and record the signed residual.
4. Defence in depth (OQ3): add one shared redirect/`*url.Error` sanitization for the 4 sites, or `CheckRedirect` on the default client. Keep `ErrorClass`, `outcome` and `errors.Is(DeadlineExceeded)` unchanged.
5. Docs and acceptance:
   - Add one line to marketdata `CLAUDE.md` on the key transport.
   - Resolve the findings `:39-40` question.
   - Promote 320 @AC-1 and @AC-2 into `fix-marketdata-secret-exposure.feature` as EXTEND scenarios.
