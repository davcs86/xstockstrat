# Implementation Spec: fix-marketdata-secret-exposure

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/254-fix-marketdata-secret-exposure/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-marketdata-secret-exposure`

---

## Execution Summary

The spec follows design.md's Chosen Approach as two independent Track C fixes (SEV-2), done in this order:

1. **D-39 (marketdata, Steps 1-3).** Both vendor `getJSON` functions unwrap `*url.Error` and `%w`-wrap only
   `ue.Err`, with a cause-free fallback. This applies at the transport (`Do`) site and, per the operator scope
   addition of 2026-10-22, at the `build request` site. Client tests (Step 2) and service-edge tests (Step 3)
   prove the key never reaches the error or the gRPC `Unavailable` status.
2. **D-40 (config, Steps 4-7).** First extract a shared PKI test helper. Then move the GetSecret describe of
   `secretsAndScope.test.ts` onto an mTLS wire harness and show it green under the current header-only grant. Then
   add a wire wrong-SAN negative and record its red run. Last, bind the `marketdata` grant to
   `peerSan: 'xstockstrat-marketdata'` and update the unit deny matrix in the same step.
3. **Docs and residuals (Step 8), then the dev smoke check (Step 9).**

D-39 runs first because it touches only marketdata and is independent of D-40. D-40's commit order (harness green,
then red AC-3, then grant) is a design mitigation for the "harness fails for harness reasons" risk.

There are **no proto, migration, config-key, env-var, port or DB-pool changes** (recon.md:87-93):
- marketdata's last migration is `009_symbol_classification`;
- config's last migration is `030_marketdata_edgar_snapshot_keys`;
- neither is touched, so there is no `buf` step.

**Consumer surface (C-14):** None. This is internal/platform-only, as the product spec decides in `## Consumer
Surface(s)`. The only visible changes are the text of marketdata's `CodeUnavailable` message and the `GetSecret`
authz outcome for non-marketdata peers. There is no UI or agent step, by decision, not omission.

**Broker / paper-live (C-2/C-3):** ALPACA and IBKR order routing is unaffected. No step touches the order path,
order types or fills. The SAN binding is not scoped by environment.

**Operator trace-id decision (2026-10-21):** not engaged. No step adds an emit, write or outbound call path (design.md
Constitution Rules Touched).

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` FMP transport failure never reveals the key | Step 2 |
| `@AC-2` Finnhub transport failure never reveals the token | Step 2 |
| `@AC-3` marketdata secret refused to a peer with the wrong SAN | Step 6 (wire), Step 7 (unit) |
| `@AC-4` marketdata service still resolves its secret | Step 5 (wire, through the marketdata leaf), Step 7 (unit) |
| `@AC-5` single `GetFundamentals` Unavailable status is key-free | Step 3 |
| `@AC-6` marketdata secret refused with no peer SAN | Step 7 (unit only: an mTLS server rejects a cert-less peer before the handler runs, design.md 3d) |
| `@AC-7` batch `GetFundamentalsMulti` Unavailable status is key-free | Step 3 |

### Open-risk resolutions made at /sdd-spec

- **Body-read wrap (`fmp_client.go:249-251`, `finnhub_client.go:121-123`) needs no change and no test.** A body read
  never produces a `*url.Error`. The `*url.Error` is built only by `Client.do`'s `uerr`
  (`$GOROOT/src/net/http/client.go:665`, toolchain go1.27.0). Body reads go through `cancelTimerBody.Read`
  (`client.go:997-1009`), which returns the raw transport read error, or a `timeoutError` built from that error's
  text. Neither contains the request URL or query.
- **The redirect residual is accepted and untested** (design.md). The error
  `failed to parse Location header %q` (`client.go:665`) is wrapped in `uerr`. After the fix, its inner cause is
  `ue.Err`, which still quotes the vendor-sent `Location`. This is tracked in the Step 8 defect report.

## Step Dependencies

- **Steps 1-3 form one red-green cycle (P-06).** Step 2 [test] and Step 3 [test] both pair with Step 1 [service]
  (C-08). Author both test steps first and run them RED against the pre-Step-1 tree: the error still contains
  `k-secret` / `apikey=` / `token=`, and `errors.As(*url.Error)` is true. Then apply Step 1 and run them GREEN.
  Step 3 is test-only: the service wraps at `marketdata_service.go:1704`/`:1760` do not change. Its RED run is
  therefore that same pre-Step-1 run.
- **Step 5 requires Step 4.** The wire harness imports `mtlsTestPki.ts`.
- **Step 6 requires Step 5.** The wire wrong-SAN negative needs the mTLS harness and the ingest leaf.
- **Step 7 [service] pairs with Step 6 [test]** (C-08). Step 6's recorded red run is the RED evidence for the grant
  change. Step 7 also carries its own in-step unit tests, authored first and run red, because the old
  `perUserSecrets.test.ts:236` assertion ("no SAN required") must flip in the same commit as the grant. Splitting
  them would leave a step whose verification fails (F-05).
- **Pre-merge gate for Step 7.** Before the integration PR merges, re-confirm three unchanged lines:
  `scripts/gen-dev-certs.sh:28` (`SERVICES=` lists `xstockstrat-marketdata`), `:50`
  (`subjectAltName = DNS:${svc}`) and `.github/workflows/deploy.yml:102` (runs `gen-dev-certs.sh` per env).
  Step 7's Verification greps them.
- **Step 8 requires Steps 1 and 7.** The docs describe the shipped behavior.
- **Step 9 requires the integration PR merged to `main-dev`, and the dev deploy.**
- **Steps 1-3 are independent of Steps 4-7.** Rollback of D-40 is reverting the Step 7 `authz.ts` line alone; D-39
  stays.
- **Textual merge overlap (rebase only).**
  - 241-fix-config-audit-author-spoof touches `authz.ts:46-50` and `:82-97`, plus `perUserSecrets.test.ts:237-243`,
    next to the Step 7 flip.
  - 263-fix-edge-owner-scope touches `authz.ts`.
  - 255-fix-marketdata-fundamentals-cache touches `fmp_client.go`, `finnhub_client.go` and `marketdata_service.go`.
  - Whichever lands second rebases. Never touch the ingest grant (`authz.ts:120-125`) or the SetConfig grant
    (`authz.ts:66-76`, owned by 241).

---

### Step 1 — service: D-39 redact `*url.Error` at the vendor clients' transport and build-request sites

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/fmp/fmp_client.go` — modify
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — vendor client error handling (D-39); Security — no plaintext secret in errors, logs or OTel

**Codebase Evidence**:
- FMP `getJSON`, from `fmp_client.go:218-260`:
  - `:222` is `params.Set("apikey", c.apiKey)` and `:223` is `u := c.baseURL + path + "?" + params.Encode()`.
  - **`:224-227`** is the build-request site:
    `req, err := http.NewRequestWithContext(...)` / `if err != nil { return fmt.Errorf("fmp: build request: %w", err) }`.
  - `:231` is `day, err := c.reserve()`, and `:235-240` is the refund `defer` gated on `counted`.
  - **`:241-243`** is the transport site:
    `resp, err := c.http.Do(req)` / `if err != nil { return fmt.Errorf("fmp: %s request failed: %w", path, err) }`.
  - `:254-255` is the pattern to reuse: `// Never include the URL (it carries the apikey) in the error.` /
    `return fmt.Errorf("fmp: %s returned HTTP %d", path, resp.StatusCode)`.
  - Imports (`:5-20`) already include `"errors"` and `"net/url"`.
- Finnhub `getJSON`, from `finnhub_client.go:106-131`:
  - `:110` is `params.Set("token", c.apiKey)`.
  - **`:112-115`** is the build-request site: `return fmt.Errorf("finnhub: build request: %w", err)`.
  - **`:116-119`** is the transport site: `return fmt.Errorf("finnhub: %s request failed: %w", path, err)`.
  - `:124-126` has the "Never include the URL (it carries the token)" rule.
  - Imports (`:5-16`) include `"net/url"` but **not** `"errors"`.
- `getJSON` is the single HTTP chokepoint. FMP routes `fetchQuotes` (`:263`, `/stable/quote`), `fetchRatios`
  (`:273`) and `fetchProfile` (`:286`, `/stable/profile`) through it, and so do `FetchSector` (`:364`) and
  `FetchIsEtf` (`:374`). Finnhub routes `fetchMetric` (`:135`, `/stock/metric`) through it.
- Service sentinels are unaffected. Only `errors.Is(err, fmp.ErrFMPDailyCapExceeded)` and
  `errors.Is(err, source.ErrNoFundamentals)` are tested, at `marketdata_service.go:1697`, `:1750` and `:1756`
  (recon.md:37). Neither is in the transport chain.

**TDD**: `red-green required`. RED comes from Steps 2 and 3, run before this step's code.

**Covers**: —

**Instructions**:
1. In `fmp_client.go`, replace the transport return at `:242-243` with:
   ```go
   if err != nil {
       var ue *url.Error
       if errors.As(err, &ue) {
           return fmt.Errorf("fmp: %s request failed: %w", path, ue.Err)
       }
       return fmt.Errorf("fmp: %s request failed", path)
   }
   ```
2. In `fmp_client.go`, replace the build-request return at `:225-226` with the same shape:
   `fmt.Errorf("fmp: %s build request: %w", path, ue.Err)` when `errors.As` matches, and
   `fmt.Errorf("fmp: %s build request", path)` otherwise. `path` is the `getJSON` parameter already in scope.
3. In `finnhub_client.go`, apply the same two edits at `:113-114` and `:117-118`, using the `finnhub:` prefix.
   Add `"errors"` to the import block (`:5-16`, alphabetical, after `"encoding/json"`).
4. Do **not** move either `return` relative to `reserve()`, or touch `counted` or the refund `defer`
   (`fmp_client.go:231-240`). This preserves feature-217 `@AC-4`, "Failed FMP calls refund the shared daily budget".
   The build-request return already sits before `reserve()`, so no budget slot is taken.
5. Leave the body-read wrap (`fmp_client.go:249-252`, `finnhub_client.go:121-124`) and the decode wraps unchanged.
   The Execution Summary explains why: they carry no URL.
6. Do not add a shared `redactURLError` helper (rejected in design.md, YAGNI/C-18). Do not string-scrub `apikey=` /
   `token=`. A comment, if any, must be at most 2 lines and state the constraint only, e.g.
   `// *url.Error carries the key-bearing URL: wrap only its inner cause.`

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./internal/fmp/ ./internal/finnhub/
grep -n 'request failed: %w", path, err)\|build request: %w", err)' internal/fmp/fmp_client.go internal/finnhub/finnhub_client.go   # expect no output
GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 2 — test: D-39 client tests (transport, build-request, deadline, budget refund)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/fmp/fmp_client_test.go` — modify
- `services/xstockstrat-marketdata/internal/fmp/fmp_gateway_test.go` — modify
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — vendor client error handling (D-39)

**Codebase Evidence**:
- Both test files are internal packages (`package fmp`, `package finnhub`). Existing leak tests cover only HTTP 403:
  `TestHTTPError_DoesNotLeakAPIKey` at `fmp_client_test.go:171` and at `finnhub_client_test.go:205`.
- Constructors are `fmp.NewClient(ClientConfig{BaseURL, APIKey, Metrics, HTTPClient, Limits, Now})`
  (`fmp_client.go:27-37`, `:60`) and `finnhub.NewClient(ClientConfig{BaseURL, APIKey, HTTPClient})`
  (`finnhub_client.go:20-25`, `:35`).
- Neither `NewClient` alters the scheme or host of `BaseURL`. Each applies only `strings.TrimRight(cfg.BaseURL, "/")`
  (`fmp_client.go:76`, `finnhub_client.go:41`).
- Call paths:
  - FMP `GetFundamentalsMulti` (`:173`) goes first to `fetchQuotes`, then `/stable/quote` (`:267`).
  - FMP `FetchSector` (`:365`) goes to `fetchProfile`, then `/stable/profile` (`:290`).
  - Finnhub `GetFundamentals` (`:51`) goes to `fetchOne` (`:76`), then `fetchMetric`, then `/stock/metric` (`:140`).
  - Finnhub `GetFundamentalsMulti` swallows per-symbol errors (`:64-69`), so it is not used (recon.md:35).
- Budget pattern: `gatewayClient(rt, rps, dailyCap, now)` (`fmp_gateway_test.go:27`),
  `TestGateway_BudgetRefundOn503_AC4` (`:70`) and `c.BudgetSnapshot()` (`:78`).
- C-13: `"k-secret"` and `"http://127.0.0.1:1"` are scenario sentinels taken from `acceptance.feature`, not domain
  objects. They are inline one-offs in each file and need no fixture home.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2`

**Instructions**:
1. **`fmp_client_test.go`.** Add a file-local helper `assertNoKeyLeak(t, err, wantPath)`. It fails when any of these
   hold:
   - `err == nil`;
   - the text lacks `"fmp"` or `wantPath`;
   - the text contains `"k-secret"` or `"apikey="`;
   - `errors.As(err, new(*url.Error))` is true.

   Then add the following tests, each with a client built as
   `NewClient(ClientConfig{BaseURL: …, APIKey: "k-secret", Metrics: []string{"core"}})`:
   - `TestTransportError_DoesNotLeakAPIKey_AC1`: BaseURL `http://127.0.0.1:1`. Call
     `GetFundamentalsMulti(ctx, []string{"AAPL"})` and run `assertNoKeyLeak(…, "/stable/quote")`. Also call
     `FetchSector(ctx, "AAPL")` and run `assertNoKeyLeak(…, "/stable/profile")`, which covers the `fetchProfile`
     filler.
   - `TestBuildRequestError_DoesNotLeakAPIKey`: BaseURL `"http://127.0.0.1:1\x7f"`, which makes `url.Parse` fail on
     the control character. Call `GetFundamentalsMulti` and run `assertNoKeyLeak(…, "/stable/quote")`.
   - `TestTransportError_PreservesDeadlineCause`: an `httptest.NewServer` handler that blocks on
     `<-r.Context().Done()`, so `srv.Close()` cannot hang, and a `context.WithTimeout(…, 50*time.Millisecond)`.
     Assert `errors.Is(err, context.DeadlineExceeded)` **and** no `*url.Error` in the chain.

   Add `net/url`, `net/http/httptest` and `time` imports as needed.
2. **`fmp_gateway_test.go`.** Add `TestGateway_BudgetRefundOnTransportError_AC4`, which preserves feature-217
   `@AC-4`. Build `NewClient(ClientConfig{BaseURL: "http://127.0.0.1:1", APIKey: "k-secret",
   Limits: func() (float64, int) { return 0, 3 }})` and call `FetchSector` 5 times; each must error. Assert
   `used == 0` via `BudgetSnapshot()`. This passes before and after Step 1 (a characterization guard); record it as
   such.
3. **`finnhub_client_test.go`.** Mirror item 1 with `"finnhub"`, `"token="` and `"/stock/metric"`:
   - `TestTransportError_DoesNotLeakAPIKey_AC2` uses `GetFundamentals(ctx, "AAPL")`.
   - `TestBuildRequestError_DoesNotLeakAPIKey` uses BaseURL `"http://127.0.0.1:1\x7f"`.
   - `TestTransportError_PreservesDeadlineCause` uses the blocking `httptest` server.

   Keep the helper file-local. A second copy in another package is below the jscpd floor (`.jscpd.json:4`,
   `minTokens: 100`), and a shared test package was rejected (YAGNI).
4. **RED (before Step 1).** The leak assertions fail, because the text contains `apikey=k-secret` / `token=k-secret`
   and `*url.Error` is present. The deadline test passes even before Step 1, because `%w` of the raw `*url.Error`
   already satisfies `errors.Is`. That is expected: it guards against the "drop `%w`" regression, and its red is
   "N/A — characterization". Record it so.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/fmp/ ./internal/finnhub/ -race -count=1 -run 'DoesNotLeak|PreservesDeadline|BudgetRefund' -v
cd services/xstockstrat-marketdata && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 3 — test: D-39 service-edge Unavailable status is key-free (single + batch)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — vendor client error handling (D-39)

**Codebase Evidence**:
- The single RPC goes through `resolveFundamentals`. Its `if err != nil { return nil, connect.NewError(
  connect.CodeUnavailable, fmt.Errorf("%s fetch: %w", s.fundProvider, err)) }` is at `marketdata_service.go:1759-1761`.
  The batch RPC has the same wrap at `:1703-1704`.
- Helpers in `marketdata_service_test.go`:
  - `newFundSvc(cfg, repo, src source.FundamentalsSource, notify, provider)` (`:309`);
  - `enabledCfg("fmp")` (`:290`, `daily_request_cap: 250`);
  - `newFakeFundRepo()` (`:188`, empty cache);
  - `&fakeNotify{}` (used at `:320`).
- The assertion pattern is `connect.CodeOf(err) != connect.CodeUnavailable` (`:2962`).
- `*fmp.Client` satisfies `source.FundamentalsSource` (`fmp_client.go:157`). Package `service` tests already import
  `github.com/xstockstrat/marketdata/internal/fmp` (`classification_service_test.go`), so there is no import cycle.

**TDD**: `red-green required`. RED is the pre-Step-1 run (see Step Dependencies).

**Covers**: `AC-5, AC-7`

**Instructions**:
1. Add `TestFundamentals_TransportErrorStatusIsKeyFree_feature254`. Build
   `client := fmp.NewClient(fmp.ClientConfig{BaseURL: "http://127.0.0.1:1", APIKey: "k-secret", Metrics: []string{"core"}})`
   and `svc := newFundSvc(enabledCfg("fmp"), newFakeFundRepo(), client, &fakeNotify{}, "fmp")`.
2. Add a subtest `single (AC-5)`. Call `svc.GetFundamentals(ctx, "AAPL")` and assert:
   - `connect.CodeOf(err) == connect.CodeUnavailable`;
   - `err.Error()` contains `"fmp"`;
   - `err.Error()` contains neither `"k-secret"` nor `"apikey="`.
3. Add a subtest `batch (AC-7)`. Call `svc.GetFundamentalsMulti(ctx, []string{"AAPL"})` and make the same four
   assertions.
4. Add the `internal/fmp` import. Do not change `marketdata_service.go` (FR-3: the service `%w` wraps only the
   already-redacted client error).
5. C-13: the sentinels are inline scenario one-offs, so no fixture home is needed (`internal/testdata/` is not
   extended).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ -race -count=1 -run 'TransportErrorStatusIsKeyFree|VendorNoFundamentalsIsNotFound_feature215' -v
# Coverage threshold: total >= 40% (CI gate), measured with Step 2's command; service/ is excluded from COVERPKGS.
cd services/xstockstrat-marketdata && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 4 — test: extract the shared mTLS PKI test helper (config)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/mtlsTestPki.ts` — create
- `services/xstockstrat-config/src/__tests__/peerSanSpike.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/mtls.test.ts` — modify

**Reviewers**: `xstockstrat-config` owner — secret encryption + redaction, `GetSecret` allow-list

**Codebase Evidence**:
- `peerSanSpike.test.ts` holds identical copies of `sh` (`:17-19`), `mintLeaf(dir, name, ca, caKey): [string, string]`
  (`:21-27`) and `setEnv(cert, key, ca)` (`:29-33`).
- `mtls.test.ts` holds the same three, at `:21-23`, `:35-41` and `:57-61`.
- `mtls.test.ts` `mintPki` (`:43-55`) mints two CAs inline (`/CN=test-ca`, `/CN=foreign-ca`). That is why there is no
  `mintCa` helper (rejected in design.md).
- `tsconfig.json:14` (`"include": ["src/**/*"]`) compiles the helper. `package.json` `test` / `test:coverage` run only
  `dist/__tests__/*.test.js`, so the helper never runs as a test file. There is no `.c8rc`, so c8's default exclude
  (`**/__tests__/**`) keeps it out of coverage.
- jscpd floor: `.jscpd.json:4` (`minTokens: 100`). `mintLeaf` is above it, so a third inline copy is barred
  (design.md).

**TDD**: `N/A (red N/A — refactor with no behavior change; the existing peerSanSpike/mtls suites are the characterization tests and must stay green)`

**Covers**: —

**Instructions**:
1. Create `mtlsTestPki.ts`. It exports `sh`, `mintLeaf` and `setEnv`, moved **verbatim** from
   `peerSanSpike.test.ts:17-33`, with the imports they need: `execFileSync`, `readFileSync`, `writeFileSync` and
   `join`. Export nothing else.
2. In `peerSanSpike.test.ts` and `mtls.test.ts`, delete the local `sh` / `mintLeaf` / `setEnv` definitions and add
   `import { sh, mintLeaf, setEnv } from './mtlsTestPki';`. Remove only the `node:*` import names that become unused.
   Make no other edits. `mintPki` keeps its inline CA lines.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage   # peerSanSpike + mtls suites green; c8 lines >= 40
cd services/xstockstrat-config && pnpm run lint
grep -n 'function sh\|function mintLeaf\|function setEnv' src/__tests__/*.ts   # only mtlsTestPki.ts
bash scripts/check-duplication.sh 2>/dev/null || (cd ../.. && bash scripts/check-duplication.sh)
```

---

### Step 5 — test: move the GetSecret describe of `secretsAndScope.test.ts` onto an mTLS wire harness

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/secretsAndScope.test.ts` — modify

**Reviewers**: `xstockstrat-config` owner — secret encryption + redaction, `GetSecret` allow-list

**Codebase Evidence**:
- The GetSecret describe is `describe('GetSecret allow-list + failure modes', …)` at `secretsAndScope.test.ts:63-136`.
  - The server binds `grpc.ServerCredentials.createInsecure()` (`:75`).
  - The client is `new ConfigServiceClient(\`127.0.0.1:${port}\`, grpc.credentials.createInsecure())` (`:78`).
  - The tests are AC-4 (`:88`), AC-5 (`:98`, `:108`) and AC-16 (`:117`, `:127`).
  - The file header (`:8-10`) mandates a real loopback connection (`fails.md` 2026-07-27, and `fails.md:668`).
- The SetConfig describe (`:139+`) stays insecure.
- `src/mtls.ts`:
  - `load()` reads the `MTLS_*` env on every call (`:11-19`).
  - `serverCredentials()` (`:22`) uses `createSsl(ca, …, true)`, which requires a client cert.
  - `clientCredentials()` (`:28`) and `targetOverride(targetService)` (`:35`) give `grpc.ssl_target_name_override`.
- Precedent for a client with SAN pinning: `peerSanSpike.test.ts:93`,
  `new grpc.Client(\`127.0.0.1:${port}\`, mtls.clientCredentials(), mtls.targetOverride(SVC))`.
- openssl already runs in the same CI job: `ci.yml:594`, `pnpm run test:coverage`.

**TDD**: `N/A (red N/A — transport change with no behavior change; the five existing GetSecret tests are the characterization and must stay green under the still header-only grant, which de-risks the harness before the red AC-3 in Step 6)`

**Covers**: `AC-4`

**Instructions**:
1. In the GetSecret describe's `before`:
   - Use `mkdtempSync(join(tmpdir(), 'getsecret-mtls-'))` for a tmp dir.
   - Mint the test CA inline with one `sh('req','-x509','-newkey','rsa:2048','-nodes','-keyout',caKey,'-out',ca,'-days','1','-subj','/CN=test-ca')`.
   - Mint three leaves with `mintLeaf`: `xstockstrat-config` (server), `xstockstrat-marketdata` and
     `xstockstrat-ingest`.
2. `sh`/openssl writes the CA to a path, so read it once with `const caPem = readFileSync(ca, 'utf8')`. `mintLeaf`
   returns a `[certPem, keyPem]` tuple and `setEnv(cert, key, ca)` takes three PEM strings. Set the env to the server
   leaf with `setEnv(...serverLeaf, caPem)`, then bind with `mtls.serverCredentials()` in place of `createInsecure()`
   at `:75`.
3. Build `client` (the marketdata client) by calling `setEnv(...marketdataLeaf, caPem)` and then
   `new ConfigServiceClient(\`127.0.0.1:${port}\`, mtls.clientCredentials(), mtls.targetOverride('xstockstrat-config'))`.
   Build a second `ingestClient` the same way after `setEnv(...ingestLeaf, caPem)`. Step 6 uses it; close both in
   `after`.
4. Keep the five existing `it` blocks unchanged. They now run on the wire through the marketdata leaf.
5. Import `* as mtls from '../mtls'` and `{ sh, mintLeaf, setEnv } from './mtlsTestPki'`, plus the needed `node:*`
   imports. Update the header comment's covered list only if needed, and keep it within the 2-line comment cap for
   any new comment.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage   # all secretsAndScope tests green with authz.ts unchanged; c8 lines >= 40
cd services/xstockstrat-config && pnpm run lint
git diff --quiet -- src/grpc/authz.ts && echo "authz.ts untouched"
```

---

### Step 6 — test: wire wrong-SAN negative for the marketdata grant (red evidence)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/secretsAndScope.test.ts` — modify

**Reviewers**: `xstockstrat-config` owner — `GetSecret` allow-list; Security — `GetSecret` gated by caller identity

**Codebase Evidence**:
- `ingestClient` comes from Step 5. The local `getSecret(metadata, req)` helper (`secretsAndScope.test.ts:82-86`)
  uses `client`; add a sibling `getSecretAs(c, metadata, req)` or parameterize the client.
- `md({ [HEADER_INTERNAL_CALLER]: 'marketdata' })` follows the pattern at `:89`.
- Ledger trap: `fails.md:2404-2406`. Only a valid-CA, **wrong-SAN** negative proves a SAN check (recon.md:112).

**TDD**: `red-green required`. This step's run against the header-only grant is the RED for Step 7.

**Covers**: `AC-3`

**Instructions**:
1. Add `it('AC-3 (254): marketdata secret is denied to an mTLS peer whose SAN is xstockstrat-ingest', …)`.
   - Set `state.getSecretCiphertext = encryptSecret('alpaca-xyz')`.
   - Call GetSecret through `ingestClient` with header `x-internal-caller: marketdata` and
     `{ namespace: 'marketdata', key: 'alpaca.api_key', environment: 'ENVIRONMENT_PRODUCTION' }`.
   - Assert `err.code === grpc.status.PERMISSION_DENIED` and `res === undefined`.
2. Run it and capture the RED. Under the current header-only grant it returns `found=true` /
   `value='alpaca-xyz'`. Record that output in `context.md` and the PR body (tdd-gate). Do not commit the step until
   it is recorded. Per F-05, this step's verification is the expected-red run below.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm test 2>&1 | grep -E "AC-3 \(254\)|not ok|# fail"   # expect exactly the AC-3 (254) test failing (RED) before Step 7
cd services/xstockstrat-config && pnpm run lint
```
Coverage threshold: none at this step. The run is an expected-red, not a green gate, so run it only as the Step 6-7
pair. The `c8 lines >= 40` gate applies at Step 7's Verification (F-05, P-06).

---

### Step 7 — service: D-40 bind the marketdata GetSecret grant to DNS SAN `xstockstrat-marketdata` (+ unit deny matrix)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/authz.ts` — modify
- `services/xstockstrat-config/src/__tests__/perUserSecrets.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/secretCallerAuthz.test.ts` — modify

**Reviewers**: `xstockstrat-config` owner — secret encryption + redaction, `GetSecret` allow-list; `xstockstrat-marketdata` owner — the marketdata leaf SAN the grant binds to; Security — secrets decryptable only via `GetSecret` gated by verified caller identity

**Codebase Evidence**:
- The grant is `SECRET_CALLER_ALLOWLIST` in `authz.ts:114-126`. The marketdata entry (`:115-119`) is
  `{ callerID: 'marketdata', namespace: 'marketdata', keys: ['alpaca.api_key', 'alpaca.api_secret', 'fmp.api_key', 'finnhub.api_key'] }`
  and has no `peerSan`.
- The pattern is the ingest entry (`:120-125`), whose `peerSan: 'xstockstrat-ingest'` is at `:124`. The field doc
  (`:110`) reads "the header alone is spoofable".
- Enforcement already exists:
  - `peerDnsSans` (`:135-142`);
  - `hasSecretCallerAuthority` (`:149-164`), with the SAN term at `:162`,
    `(grant.peerSan === undefined || peerDnsSans(call).includes(grant.peerSan))`;
  - `SECRET_SCOPE_ERROR` (`:167`).
  - The handler at `configServiceImpl.ts:337` needs no change.
- Unit tests:
  - `perUserSecrets.test.ts:236-248` holds `it('marketdata exact-key GetSecret is unchanged: no SAN required, …')`.
    It calls `getSecret({ namespace: 'marketdata', key: 'alpaca.api_key' }, 'marketdata', () => ({}))` (`:245`) and
    expects `found:true`.
  - The `getSecret(request, callerID, authContext)` helper is at `:127-136`. The ingest deny trio template is at
    `:188-196`: wrong SAN, `() => ({})`, `undefined`.
  - `secretCallerAuthz.test.ts:57-62` holds `it('preserves the marketdata exact-keys grant (feature 147 regression)', …)`
    with `callWith('marketdata')` and no SAN. The helper is `callWith(callerID, subjectaltname?)` (`:17-24`).
- Deploy SAN material: `scripts/gen-dev-certs.sh:28` (`SERVICES="… xstockstrat-marketdata …`), `:50`
  (`subjectAltName = DNS:${svc}`) and `.github/workflows/deploy.yml:101`
  (`CERTS_DIR="$certs_dir" bash scripts/gen-dev-certs.sh`).
- The marketdata client presents its leaf: `internal/config/config.go:70` (`mtls.ClientConfig("xstockstrat-config")`),
  sends `x-internal-caller` at `:115`, and `InternalCallerID = "marketdata"` is at `:109`. No other caller sends
  `x-internal-caller: marketdata` (recon.md:92).

**TDD**: `red-green required`. RED is Step 6's wire AC-3, plus this step's unit AC-3/AC-6 cases, authored first and
run before the `authz.ts` edit.

**Covers**: `AC-3, AC-4, AC-6`

**Instructions**:
1. **Unit tests first (RED).**
   - In `perUserSecrets.test.ts`, replace the `it` at `:236-248` with
     `it('marketdata GetSecret requires the xstockstrat-marketdata peer SAN (254: AC-3/AC-4/AC-6)', …)`. Keep the
     same `setConfig` seed (`alpaca-xyz`, global scope). Add `const MARKETDATA_SAN = 'DNS:xstockstrat-marketdata'`
     next to `INGEST_SAN` (`:25`). Then assert:
     - AC-4: `() => ({ sslPeerCertificate: { subjectaltname: MARKETDATA_SAN } })` gives `err === null` and
       `[found, value]` equal to `[true, 'alpaca-xyz']`.
     - AC-3: `() => ({ sslPeerCertificate: { subjectaltname: INGEST_SAN } })` gives `PERMISSION_DENIED` and no `res`.
     - AC-6: `() => ({})` and `undefined` each give `PERMISSION_DENIED` and no `res`, mirroring the trio at `:188-196`.
   - This is the **only** home of the unit deny matrix (C-18).
   - In `secretCallerAuthz.test.ts:59`, change only `callWith('marketdata')` to
     `callWith('marketdata', 'DNS:xstockstrat-marketdata')`. Add no deny cases there (rejected in design.md).
   - Run `pnpm test` and capture the RED: the AC-3 and AC-6 unit asserts, and Step 6's wire AC-3, fail.
2. **Grant (GREEN).** Add `peerSan: 'xstockstrat-marketdata',` to the marketdata entry at `authz.ts:115-119`, after
   `keys`, mirroring `:124`. Make no other `authz.ts` edit. Leave the ingest grant (`:120-125`), the SetConfig grant
   (`:66-76`, feature 241) and the matcher alone.
3. Re-run. Step 5's wire AC-4 / AC-5 / AC-16 stay green, and Step 6's wire AC-3 turns green. In the wire suite, only
   AC-3 changes state.
4. **Pre-merge gate.** The grep in Verification must still show the three SAN-material lines unchanged. If it does
   not, block the step (P-03): a leaf without the SAN fails FR-5 soft at boot (`cmd/server/main.go:77-78` WARN).

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage   # all green incl. secretsAndScope AC-3 (254); c8 lines >= 40
cd services/xstockstrat-config && pnpm run lint
grep -n "peerSan: 'xstockstrat-marketdata'" src/grpc/authz.ts
cd ../.. && sed -n 28p scripts/gen-dev-certs.sh | grep -q 'xstockstrat-marketdata' && sed -n 50p scripts/gen-dev-certs.sh | grep -q 'subjectAltName = DNS:\${svc}' && sed -n 101p .github/workflows/deploy.yml | grep -q 'gen-dev-certs.sh' && echo "SAN material unchanged"
```

---

### Step 8 — docs: config/marketdata invariants, root config-governance line, residuals defect report

**Status**: `pending`
**Service**: `xstockstrat-config`, `xstockstrat-marketdata` (docs only; also root `CLAUDE.md` and `docs/reports/`)
**Files**:
- `services/xstockstrat-config/CLAUDE.md` — modify
- `services/xstockstrat-config/docs/context-constitution.md` — modify
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `CLAUDE.md` — modify
- `docs/reports/2026-10-22-marketdata-vendor-key-url-residuals-defect.md` — create (date = execution date if different)
- `docs/reports/2026-10-22-marketdata-vendor-key-url-residuals-defect.status` — create
- `docs/roadmap/features/254-fix-marketdata-secret-exposure/context.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-config/CLAUDE.md:41` (invariant #6) reads "grants: `marketdata` → the four vendor keys, and
  `ingest` → … which also requires the mTLS peer certificate to carry DNS SAN `xstockstrat-ingest`".
- `services/xstockstrat-config/docs/context-constitution.md`:
  - `:35` reads "`marketdata` (exact `keys` — the four vendor credentials) and `ingest` (… `peerSan: 'xstockstrat-ingest'` …)".
  - `:51` reads "grants: `marketdata` exact keys + `ingest` `keyPrefixes` bound to peer SAN `xstockstrat-ingest`".
- `services/xstockstrat-marketdata/CLAUDE.md:218` reads "returns plaintext only to this allow-listed caller"; the
  header-only wording is at `x-internal-caller: marketdata`.
- Root `CLAUDE.md` § Config Governance Rules reads "decrypted only by the authenticated `GetSecret` RPC for
  allow-listed internal callers (`x-internal-caller`)".
- Sidecar format: `.claude/skills/sdd-qa/reference/defect-filing.md:26-38` (line 1 `<status>`, optional
  `ref: <kind>:<target>`). Precedent: `docs/reports/2026-10-21-marketdata-secret-exposure-defect.status`.
- Residual (a): `$GOROOT/src/net/http/client.go:665`,
  `uerr(fmt.Errorf("failed to parse Location header %q: %v", loc, err))`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Config `CLAUDE.md:41`: change the marketdata grant clause to say it also requires DNS SAN
   `xstockstrat-marketdata` (`peerSan`, feature 254), alongside ingest's `xstockstrat-ingest`.
2. Config `docs/context-constitution.md:35` and `:51`: state that both grants now carry `peerSan`
   (`xstockstrat-marketdata` / `xstockstrat-ingest`), so the header alone never suffices.
3. Marketdata `CLAUDE.md:218`: say the caller is allow-listed by `x-internal-caller: marketdata` **plus** its mTLS
   leaf's DNS SAN `xstockstrat-marketdata`, and that a leaf without the SAN gets `PERMISSION_DENIED`, which surfaces
   as the boot WARN `resolving vendor credential from config failed`.
4. Root `CLAUDE.md` § Config Governance Rules: amend the parenthetical to "(`x-internal-caller`, plus the mTLS peer DNS
   SAN for grants that set `peerSan`)". Make no other root edit.
5. File the residuals report, with a `.status` sidecar containing `open`. It covers:
   - **(a)** the redirect residual: the `Location`-parse error's inner cause can quote a vendor-sent URL;
   - **(b)** query-string keys reaching proxy and vendor access logs.

   It recommends key-in-header (FMP `apikey` header, Finnhub `X-Finnhub-Token`; vendor support unverified) as the fix
   that closes the class, and a shared `redactURLError` helper as the consolidation point. The `build request` sites
   are **fixed** in Step 1 and are not listed as residuals.
6. `context.md`: record residual (a) as accepted with no test, pointing to the report.
7. **Teardown (root `CLAUDE.md` § Teardown).** Run `/context-forge:context-constitution refresh`, scoped to the files
   above, and fix any grounded drift. If the plugin is unavailable, re-read each touched context file against the code
   by hand, and record both the unavailability and the reconciliation in the PR body (`fails.md:671`, rule at `:673`).

**Verification**:
```bash
grep -n "xstockstrat-marketdata" services/xstockstrat-config/CLAUDE.md services/xstockstrat-config/docs/context-constitution.md | grep -i san
grep -n "DNS SAN" services/xstockstrat-marketdata/CLAUDE.md CLAUDE.md
head -1 docs/reports/*-marketdata-vendor-key-url-residuals-defect.status   # → open
```

---

### Step 9 — docs: dev smoke check of marketdata credential resolution (post-merge)

**Status**: `pending`
**Service**: `xstockstrat-marketdata` (dev deploy, observation only)
**Files**:
- `docs/roadmap/features/254-fix-marketdata-secret-exposure/context.md` — modify (record the evidence)

**Reviewers**: none

**Codebase Evidence**:
- The boot WARN is `slog.Warn("resolving vendor credential from config failed — treating as unset", "key", key, "error", err)`
  (`services/xstockstrat-marketdata/cmd/server/main.go:77-78`). Grep for the ASCII prefix, never the em-dash
  (design.md, Rejected Alternatives).
- The DO dev app spec is `.do/app.dev.yaml`. `main-dev` pushes deploy to the dev app (root `CLAUDE.md` § CI/CD).

**TDD**: `N/A (operational check)`

**Covers**: — (FR-5 smoke, which preserves marketdata `@AC-6` `@feature-147`)

**Instructions**:
1. After the integration PR merges to `main-dev` and the dev deploy completes, pick a marketdata boot whose timestamp
   is **after** the new config instance became healthy. If no such boot exists, force a marketdata restart.
2. Grep that boot's logs for the ASCII substring `resolving vendor credential from config failed`.
3. Pass means zero matches. Any match is a fail: revert the Step 7 `authz.ts` line alone (Steps 1-3 stay) and log it
   in `context.md`.
4. Prod gets no separate check (accepted Open Risk). Record the evidence (boot timestamp, match count) in
   `context.md`.

**Verification**:
```bash
# doctl is not installed in the agent sandbox: fetch the run log with the DigitalOcean apps MCP tool `apps-get-logs`
# (dev app, component xstockstrat-marketdata, type RUN) and count matches; with doctl on an operator host:
doctl apps logs <dev-app-id> xstockstrat-marketdata --type run | grep -c 'resolving vendor credential from config failed'   # → 0
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- **2026-10-29, re-spec of Steps 4-9 (after merging `origin/main-dev`).** Every path, symbol and line cite in Steps
  4-9 was re-checked against the merged tree and still resolves; no Files change. Step 5 Instructions 2-3 now spell
  out the `setEnv(...leaf, caPem)` spread (3-arg `setEnv`, `mintLeaf` tuple) and read the CA PEM with
  `readFileSync`. Step 9 Verification names the DigitalOcean apps MCP `apps-get-logs` tool, since `doctl` is absent.

- **2026-10-29, Step 4 (duplication check).** Verification line 4 (`bash scripts/check-duplication.sh`) could not be
  run as a script in this sandbox (the worktree guard refuses it), so its jscpd call was run directly with the same
  config: `node node_modules/jscpd/bin/jscpd --config .jscpd.json --threshold 0`. Scoped to
  `services/xstockstrat-config` it found 0 clones. The repo-wide default scope (`services packages`) found 46 clones
  and exits 1, but none is in a file this step touches. `.jscpd.json` ignores `**/__tests__/**`, so the three
  touched test files are never scanned. The pre-commit hook runs this scan report-only. **Disposition**:
  CI-equivalent fallback. No scope or Files change.
- **2026-10-28, Step 1 (TDD ordering).** Step Dependencies says to author Steps 2 and 3 first and run them RED before
  Step 1. Sequential mode executes Step 1 as its own unit, so RED was captured with throwaway, uncommitted probe tests
  (`internal/fmp/zz_red_probe_test.go`, `internal/finnhub/zz_red_probe_test.go`) that dial `http://127.0.0.1:1` and
  `http://127.0.0.1:1\x7f` with key `k-secret`. They failed on the pre-Step-1 tree (both transport and build-request
  errors contained `apikey=k-secret` / `token=k-secret` and a `*url.Error`) and passed after the edit; then they were
  deleted. Steps 2 and 3 still add the committed regression tests. No scope or Files change.
- **2026-10-28, Step 2 (TDD ordering and deadline red).** Step 1 was already committed, so RED was captured by
  checking out the pre-Step-1 `fmp_client.go` / `finnhub_client.go` (`ba303400^`) in the working tree, running the
  new tests, then restoring `HEAD`. Instruction 4 expected `TestTransportError_PreservesDeadlineCause` to pass before
  Step 1 ("N/A — characterization"). It failed instead, on its "no `*url.Error` in the chain" assertion, which
  Instruction 1 also requires. Its `errors.Is(context.DeadlineExceeded)` half held before and after Step 1, as
  expected. `TestGateway_BudgetRefundOnTransportError_AC4` passed before and after Step 1, as specified. A file-local
  `newLeakClient(baseURL)` constructor was added beside `assertNoKeyLeak` in each test file. Finnhub's
  `ClientConfig` has no `Metrics` field, so its client omits it. No scope or Files change.
- **2026-10-28, Step 3 (TDD ordering).** Step 1 was already committed, so RED was captured as in Step 2: the
  pre-Step-1 `fmp_client.go` (`ba303400^`) was swapped into the working tree, the new test was run, then `HEAD`'s file
  was restored. Both subtests failed on the leak assertion
  (`unavailable: fmp fetch: fmp: /stable/quote request failed: Get "http://127.0.0.1:1/stable/quote?apikey=k-secret&symbol=AAPL": ...`).
  The assertions sit in a test-local `assertKeyFree` closure shared by the two subtests. No scope or Files change.
