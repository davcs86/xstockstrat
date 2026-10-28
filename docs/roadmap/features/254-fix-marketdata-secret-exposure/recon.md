# Recon: fix-marketdata-secret-exposure

**Created**: 2026-10-21
**From**: product-spec.md
**Affected services**: xstockstrat-marketdata, xstockstrat-config
**Severity**: SEV-2 (Track C bug, defect report `docs/reports/2026-10-21-marketdata-secret-exposure-defect.md`)
**Operator decisions (binding, 2026-10-21)**: grouped by service+theme from the 2026-10-20 debt-radar scan; Track C (precedent #1264); scope is D-39 and D-40 only.

---

## Objective

Two vendor-credential leaks are closed.

- **D-39:** the FMP and Finnhub HTTP clients wrap the `http.Client.Do` transport error with `%w`. That `*url.Error` carries the full request URL, including `apikey=` / `token=`, and it reaches the gRPC `CodeUnavailable` status, caller logs and OTel. The fix redacts the error at the client.
- **D-40:** config's `GetSecret` grant for `x-internal-caller: marketdata` has no `peerSan`. Any platform mTLS leaf can therefore decrypt the Alpaca live keys and both vendor keys. The fix binds the grant to DNS SAN `xstockstrat-marketdata`, like the existing ingest grant.

## Codebase Map

- **`xstockstrat-marketdata`** (Go)
  - Entry point: `cmd/server/main.go:68`. The `cfgWatcher.ResolveSecret(ctx, key)` loop runs here. On error it logs WARN at `:70` ("treating as unset") and keeps going, so a SAN mis-bind fails soft at boot.
  - Config client: `internal/config/config.go:70`. It calls `mtls.ClientConfig("xstockstrat-config")`, which presents this service's leaf (`internal/mtls/mtls.go:58-68`, `Certificates: []tls.Certificate{leaf}`). `InternalCallerID = "marketdata"` is at `internal/config/config.go:109`. `ResolveSecret` is at `:113` and sends `x-internal-caller` at `:115`.
  - FMP client (D-39 site): `internal/fmp/fmp_client.go`
    - `getJSON` is at `:218`.
    - The key is put in the query at `:222` (`params.Set("apikey", c.apiKey)`) and the URL is built at `:223`.
    - The budget is reserved at `:231`, with a deferred `refund` at `:235-240`.
    - `c.http.Do(req)` is at `:241`.
    - **The leak is at `:243`:** `return fmt.Errorf("fmp: %s request failed: %w", path, err)`.
    - `GetFundamentals` (`:160`) delegates to `GetFundamentalsMulti` (`:173`), whose first call is `/stable/quote` (`:267`).
    - `var _ source.FundamentalsSource = (*Client)(nil)` is at `:157`.
  - Finnhub client (D-39 site): `internal/finnhub/finnhub_client.go`
    - `getJSON` is at `:106`. The key is set at `:110` (`params.Set("token", c.apiKey)`) and `Do` is at `:116`.
    - **The leak is at `:118`:** `return fmt.Errorf("finnhub: %s request failed: %w", path, err)`.
    - `GetFundamentals` is at `:51`. It goes through `fetchOne` (`:76`) to `fetchMetric` (`:135`), whose first path is `/stock/metric` (`:140`).
    - `GetFundamentalsMulti` (`:57`) skips per-symbol errors (`:64-69`, `continue`).
    - `var _ source.FundamentalsSource = (*Client)(nil)` is at `:47`.
  - Service wraps (FR-3; no change expected): `internal/service/marketdata_service.go:1704` (batch) and `:1760` (single), both `connect.NewError(connect.CodeUnavailable, fmt.Errorf("%s fetch: %w", s.fundProvider, err))`. These wraps only test sentinels: `errors.Is(err, fmp.ErrFMPDailyCapExceeded)` at `:1697`/`:1750` and `errors.Is(err, source.ErrNoFundamentals)` at `:1756`. `internal/service/classification_service.go:200` tests the cap sentinel too. None of them inspect the transport-error chain.
  - Last migration: `009_symbol_classification.up.sql` (`services/xstockstrat-marketdata/migrations/`). Not touched.
  - Config-read pattern: not applicable. This fix reads no new config key.
- **`xstockstrat-config`** (Node.js / TypeScript)
  - Grant (D-40 site): `src/grpc/authz.ts:114-119`. `SECRET_CALLER_ALLOWLIST` entry `{ callerID: 'marketdata', namespace: 'marketdata', keys: ['alpaca.api_key','alpaca.api_secret','fmp.api_key','finnhub.api_key'] }` has **no `peerSan`**.
  - Pattern grant: the ingest entry at `authz.ts:120-125`, with `peerSan: 'xstockstrat-ingest'` at `:124`.
  - `peerSan` field doc at `authz.ts:110`: "the header alone is spoofable".
  - Enforcement already exists:
    - `peerDnsSans` at `authz.ts:135` returns `[]` when the auth context or SAN is absent.
    - `hasSecretCallerAuthority` at `:149` performs the SAN check at `:162` (`grant.peerSan === undefined || peerDnsSans(call).includes(grant.peerSan)`).
    - `SECRET_SCOPE_ERROR` (`PERMISSION_DENIED`) is at `:167`.
  - Handler: `src/grpc/configServiceImpl.ts:337` (`if (!hasSecretCallerAuthority(call, namespace, key))`). No change needed.
  - Last migration: `030_marketdata_edgar_snapshot_keys.up.sql` (`services/xstockstrat-config/migrations/`). Not touched.
  - Test harness: `node:test` + `node:assert/strict`, with `"test": "tsc && node --test dist/__tests__/*.test.js"` (`package.json`).

## Patterns to REUSE

- **Redacted client error (D-39):** reuse the non-2xx branch's existing rule, which already drops the URL. The comment "Never include the URL (it carries the apikey/token) in the error." is at `fmp_client.go:254-255` and `finnhub_client.go:126-127`. Both keep the `vendor: <path>` prefix that `path` (already in scope) provides. Do not add a new redaction helper unless the design shows a second leak site needs it (DRY; C-18).
- **SAN-bound grant (D-40):** add `peerSan: 'xstockstrat-marketdata'` to the marketdata entry, mirroring `authz.ts:124`. No new authz code path is needed.
- **FMP client test double:** `recordingRT` (`fmp_client_test.go:16`, `RoundTrip` at `:23`) and `newTestClient(metrics, rt)` at `:47` (BaseURL `https://fmp.test`, key `SECRET-KEY`). The existing leak test `TestHTTPError_DoesNotLeakAPIKey` (`:171`) covers HTTP 403 only. AC-1 needs a RoundTripper that returns an error, or the spec's `http://127.0.0.1:1` real dial.
- **Finnhub client test double:** `newTestClient(rt)` (`finnhub_client_test.go:49`), `TestHTTPError_DoesNotLeakAPIKey` (`:205`, non-2xx only), and `TestGetFundamentals_OutageIsNotAbsence` (`:220`).
- **Service-layer test (AC-5/AC-7):**
  - `newFundSvc(cfg, repo, src source.FundamentalsSource, notify, provider)` (`marketdata_service_test.go:309`).
  - `enabledCfg(provider)` (`:290`), `newFakeFundRepo()` (`:188`).
  - The Unavailable assertion pattern in `TestFundamentals_VendorNoFundamentalsIsNotFound_feature215` (`:2930`).
  - A real `*fmp.Client` can be passed as `src`, since it satisfies `source.FundamentalsSource` (`fmp_client.go:157`; this closes digest 1's "not verified" item).
- **Config SAN test helpers:**
  - In `perUserSecrets.test.ts`: `getSecret(request, callerID, authContext)` (`:127-136`), `INGEST_SAN` (`:25`), `ingestPeer` (`:138`), and the ingest deny trio at `:188-196` (wrong SAN / `() => ({})` / `undefined`). That trio is the template for AC-3 and AC-6.
  - `callWith(callerID, subjectaltname?)` in `secretCallerAuthz.test.ts:17`.
  - The mTLS SAN harness `peerSanSpike.test.ts` (`dnsSans` `:35`, `getAuthContext()` capture `:77`), if the loopback tests are moved onto real mTLS.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-4` "An allow-listed internal caller resolves a secret via GetSecret" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`, `@FR-3 @feature-147`). The `marketdata` grant must still decrypt for the real marketdata leaf (FR-5, AC-4). The scenario names no peer SAN, so the SAN requirement is a tightening and must be recorded; see Risks.
- **EXTEND** `@AC-5` "GetSecret fails closed for a caller not on the allow-list" (same file, `@FR-3 @feature-147`). FR-4 adds a second deny case beside it: the correct `x-internal-caller: marketdata` header with a wrong or absent mTLS SAN gets `PERMISSION_DENIED`.
- **PRESERVE** `@AC-16` "GetSecret distinguishes an unset secret from a decrypt failure" (same file, `@FR-3 @feature-147`). `found=false` vs `INTERNAL` for an allow-listed caller is unchanged.
- **PRESERVE** `@AC-2`, `@AC-3`, `@AC-14`: "WatchConfig never streams secret plaintext", "GetConfig and ListKeys redact secrets at the edge", and "A secret stays redacted even inside a per-user WatchConfig overlay" (same file, `@feature-147`). Redaction at every read edge must not regress.
- **PRESERVE** `@AC-6` "marketdata resolves a vendor credential from config, not the env var" (`services/xstockstrat-marketdata/acceptance/config-secrets-and-scoping.feature`, `@FR-5 @feature-147`). Marketdata must still resolve its credentials via `GetSecret` at boot under the SAN-bound grant. This is the FR-5 smoke test.
- **PRESERVE** `@AC-7` "A missing Alpaca credential warns but marketdata still starts" (same file, `@FR-6 @feature-147`). The SAN denial must not turn a missing credential into a boot failure.
- **PRESERVE** `@AC-7` "Marketdata reports fundamentals absence distinctly from outage and disable" (`services/xstockstrat-marketdata/acceptance/block-fundamentals-strategy-on-etf.feature`, `@FR-7 @feature-215`). The NotFound / omit / Unavailable / FailedPrecondition / ResourceExhausted mapping is unchanged by the redaction. A Finnhub `GetFundamentals` error stays Unavailable.
- **PRESERVE** `@AC-4` "An FMP outage does not break classification reads" (`services/xstockstrat-marketdata/acceptance/sector-classification.feature`, `@feature-217`). Reads still serve from the local store when FMP fails.
- **PRESERVE** `@AC-4` "Failed FMP calls refund the shared daily budget" (same file, `@feature-217`). The budget must still be refunded on transport failure after the error rewrite. The refund is a `defer` (`fmp_client.go:235-240`) that does not depend on the error text, so the rewrite must not move the `return` ahead of `reserve()` or change the `counted` logic.
- Not impacted, from digest 3:
  - config `@AC-1`/`@AC-1b`/`@AC-10..13`;
  - the other config suites (only grep-checked; 3 matches in `config-ui-usability.feature` were not opened);
  - the remaining marketdata suites;
  - `docs/sdd/business-rules/platform.feature` `@AC-35 @feature-224` (the ingest SAN precedent; must not be disturbed);
  - `docs/sdd/business-rules/platform.feature` `@AC-1/2/4/5 @feature-210` (mTLS transport; relied on, not altered).
- No existing promoted scenario covers D-39 (vendor transport-error text). AC-1, AC-2, AC-5 and AC-7 are new ground.

## Dependencies

- Proto/RPC: none. `GetSecret` and `GetFundamentals`/`GetFundamentalsMulti` keep their shape. Only the `CodeUnavailable` message text changes (key removed, vendor and path kept).
- Migration: none (marketdata last `009`, config last `030`).
- Config keys: none. D-40 changes an in-code allow-list, not a config key.
- Inter-service edges: marketdata → config `GetSecret` (gRPC 50060, mTLS, `x-internal-caller: marketdata`), unchanged in shape. No other service sends `x-internal-caller: marketdata`: a grep of `services/`/`scripts/` found only `internal/config/config.go:115` and the tests. trading's `x-internal-caller` use (`services/xstockstrat-trading/internal/config/config.go:259`) is the SetConfig channel, not `GetSecret`.
- New env vars / ports: none.
- Deploy gate (SAN material), all unchanged on this worktree:
  - `scripts/gen-dev-certs.sh:28` (`SERVICES=` includes `xstockstrat-marketdata`)
  - `scripts/gen-dev-certs.sh:50` (`subjectAltName = DNS:${svc}`)
  - `.github/workflows/deploy.yml:102` (runs `gen-dev-certs.sh` per env)

## Risks / Not-found

- **Four config tests encode the old "no SAN" behavior and break with the one-line fix.** All must change in the same step:
  1. `perUserSecrets.test.ts:236-248`: "no SAN required"; calls `getSecret(..., 'marketdata', () => ({}))` at `:245` and expects `found:true`. Flip to AC-6 and add AC-3/AC-4 cases.
  2. `secretCallerAuthz.test.ts:57-60`: "preserves the marketdata exact-keys grant (feature 147 regression)"; `callWith('marketdata')` has no SAN. Pass `'DNS:xstockstrat-marketdata'`.
  3. `secretsAndScope.test.ts:88` (AC-4), `:117` and `:127` (AC-16 found=false / INTERNAL) run over an **insecure** loopback server (`:75`, `createInsecure()`). They have no peer cert, so after the fix they get `PERMISSION_DENIED`. The design must choose between an mTLS harness (`peerSanSpike.test.ts`) and a direct-handler rewrite with a stubbed `getAuthContext` (the `perUserSecrets.test.ts` pattern). The AC-16 guarantee must stay asserted.
  - `secretsAndScope.test.ts:98` and `:108` already expect `PERMISSION_DENIED`, so they still pass (`:108` now passes for a second reason as well).
- **`@AC-4` EXTEND-vs-CHANGE ambiguity (P-03).** The promoted config `@AC-4` implies header-only authority for `marketdata`. Recon defaults it to PRESERVE, because the happy path for the real leaf is kept. Design should record in `context.md` that header-only authority is deliberately narrowed to header plus SAN. It should also decide at promotion time whether the new AC-3/4/6 sit beside or supersede the old `@AC-4`. The archiver never rewrites a promoted scenario. Whether the unit-test flip at `perUserSecrets.test.ts:236` needs explicit user sign-off as a CHANGE is the user's call.
- **Sibling leak (same class, possibly out of D-39's literal scope).** `fmp_client.go:226` (`"fmp: build request: %w"`) and `finnhub_client.go:114` (`"finnhub: build request: %w"`) wrap the `http.NewRequestWithContext` error. For a malformed URL that error is a `*url.Error` (`Op: "parse"`) carrying the full raw URL, including the key. `base_url` is operator-set config (`marketdata.fmp.base_url`, `marketdata.finnhub.base_url`), so a typo would leak the key the same way. The design must decide whether D-39 covers it. The operator decision limits scope to D-39/D-40, so this is surfaced and not silently absorbed.
- **Body-read path:** `fmp_client.go:251` (`"fmp: read %s body: %w"`) wraps an `io.ReadAll` error. Recon did not establish whether a body-read error can embed the URL. The design should confirm whether it needs a test or can be left alone.
- **Error-chain semantics.** Dropping `%w` on the transport path loses `errors.Is(err, context.DeadlineExceeded/Canceled)`. No current caller tests that chain on the fundamentals path (the only `errors.Is` checks are on `ErrFMPDailyCapExceeded` and `ErrNoFundamentals`). Design should pick between preserving a key-free cause (e.g. unwrapping `*url.Error` to its inner `.Err`) and dropping it.
- **SAN mis-bind fails soft, so it can hide.** If a deployed marketdata leaf lacked `DNS:xstockstrat-marketdata`, `ResolveSecret` would get `PERMISSION_DENIED`, `main.go:70` would WARN and treat the credential as unset, and every Alpaca/FMP/Finnhub call would then fail. The cert script and `deploy.yml` were checked; running deployments were not. Prod leaves: `context.md` names `scripts/mtls-provision.sh` as CA-only, which the product spec relies on, but recon did not re-open it. The pre-merge gate and the dev smoke test (product-spec Fix Scope) are the mitigations.
- **Ledger traps that apply:**
  - `fails.md:2403-2406` (inter-service-mtls): a SAN check is only proven by a valid-CA **wrong-SAN** negative test. AC-3 (wrong SAN `xstockstrat-ingest`) satisfies this and must not be weakened to a no-cert case only.
  - `fails.md:2953-2961`: mTLS authenticates the calling service, not anything it asserts. This is consistent here, because the SAN binds service identity to the `x-internal-caller` claim, which is exactly the gap D-40 closes.
- **Merge overlaps (textual only, from `context.md`):**
  - 241-fix-config-audit-author-spoof (`authz.ts:46-50`, `:82-97`; `perUserSecrets.test.ts:237-243`, adjacent to the flip).
  - 263-fix-edge-owner-scope (`authz.ts`).
  - 255-fix-marketdata-fundamentals-cache (the three marketdata files).
  - Whichever lands second rebases. Do not touch the ingest grant (`authz.ts:124`). The SetConfig grant's missing `peerSan` (`authz.ts:66-76`) is out of scope; feature 241 owns it.
- **Not found:** running deployments' leaf SANs (not inspectable from the repo).

## Recommended Scope

Advisory only; input to the grilling and `/sdd-spec`.

1. **marketdata — D-39 client redaction (service + paired test, P-06 red first).**
   - Rewrite `fmp_client.go:243` and `finnhub_client.go:118` to keep `vendor` and `path` and drop the URL.
   - Add transport-failure tests: FMP `/stable/quote` via `GetFundamentalsMulti` (AC-1); Finnhub `/stock/metric` via `GetFundamentals` (AC-2). Each asserts no key, no `apikey=` / `token=`, and that the path is present.
   - Optionally include the `build request` siblings if the design rules them in scope.
2. **marketdata — FR-3 service-edge proof (test only).**
   - Build a real `*fmp.Client` (BaseURL `http://127.0.0.1:1`, empty cache) and pass it to `newFundSvc(..., "fmp")`.
   - Assert `CodeUnavailable` and a key-free `err.Error()` on the single RPC (AC-5, `:1760`) and the batch RPC (AC-7, `:1704`).
   - Also confirm the budget refund (`@AC-4 @feature-217`) still holds.
3. **config — D-40 SAN binding (service + paired tests).**
   - Add `peerSan: 'xstockstrat-marketdata'` at `authz.ts:118`.
   - Flip `perUserSecrets.test.ts:236` and add AC-3 (wrong SAN), AC-4 (marketdata SAN allows) and AC-6 (no SAN / no auth context).
   - Fix `secretCallerAuthz.test.ts:57-60`.
   - Re-home the three `secretsAndScope.test.ts` marketdata `GetSecret` tests so AC-4/AC-16 stay asserted.
4. **docs.**
   - Update `services/xstockstrat-config/CLAUDE.md` invariant #6 so the `marketdata` grant also requires DNS SAN `xstockstrat-marketdata`.
   - Then do the context-forge teardown audit (root `CLAUDE.md` § Teardown).
5. **Pre-merge gate + rollback.**
   - Re-confirm `gen-dev-certs.sh:28`/`:50` and `deploy.yml:102` before merging step 3.
   - After the dev deploy, check that marketdata logs no `PERMISSION_DENIED` from `GetSecret` at boot.
   - Rollback is reverting the `authz.ts` grant alone; step 1 is independent.
