# Defect: Marketdata vendor credentials are exposed through transport-error messages and a header-only GetSecret grant

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: secret-disclosure
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-marketdata, xstockstrat-config
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-39 and D-40. Both re-verified against main-dev @ a053b0e.

## Observed

### D-39 — FMP/Finnhub transport errors carry the API key in the wrapped URL

When `http.Client.Do` fails (timeout, DNS failure, connection reset), the FMP and Finnhub clients wrap the
error with `%w`. That error is a `*url.Error`, and its `Error()` string embeds the full request URL. The URL
carries the vendor key as a query parameter (`apikey=` for FMP, `token=` for Finnhub). The error goes up to
`MarketDataService`, which wraps it again with `%w` into a `connect.CodeUnavailable` status. So the plaintext
vendor key ends up in gRPC status messages, in every caller's logs (analysis, agent), and in any OTel exporter.
The non-2xx branch of the same functions avoids this on purpose ("Never include the URL").

### D-40 — Config's `marketdata` GetSecret grant is header-only

The `SECRET_CALLER_ALLOWLIST` entry for `callerID: 'marketdata'` has no `peerSan`. It grants
`alpaca.api_key`, `alpaca.api_secret`, `fmp.api_key` and `finnhub.api_key`. The interface doc in the same file
says that without `peerSan` "the header alone is spoofable". Every platform service holds a valid mTLS leaf
(feature 210). So any of them, or anyone holding a leaked leaf, can send `x-internal-caller: marketdata` to
`GetSecret` and get back the decrypted Alpaca live keys and both data-vendor keys. The `ingest` grant next to it
is SAN-bound (`peerSan: 'xstockstrat-ingest'`, feature 224). A config test asserts the gap as intended
behaviour ("no SAN required").

## Expected

- **D-39:** A transport failure produces an error that names the vendor and `path` but never the request URL or
  query string. No vendor key appears in any status message or log line.
- **D-40:** `GetSecret` for the `marketdata` grant decrypts only for a peer whose mTLS certificate carries the DNS SAN
  `xstockstrat-marketdata`. A peer with another SAN that sends `x-internal-caller: marketdata` gets
  `PERMISSION_DENIED`.

## Reproduction

1. **D-39:** Build the FMP (or Finnhub) client with key `k-secret` and a base URL that refuses connections,
   such as `http://127.0.0.1:1`. Call any fetch, for example `GetFundamentalsMulti(ctx, ["AAPL"])`. The returned
   error string contains `apikey=k-secret` (FMP) or `token=k-secret` (Finnhub).
2. **D-40:** In `services/xstockstrat-config`, call `getSecret({namespace:'marketdata', key:'alpaca.api_key'})`
   with header `x-internal-caller: marketdata` and a peer certificate whose SAN is `xstockstrat-ingest` (or no
   peer SAN). The decrypted value comes back (`found: true`). The existing test
   `perUserSecrets.test.ts:236` already shows this ("marketdata exact-key GetSecret is unchanged: no SAN
   required").

## Evidence

### D-39

`services/xstockstrat-marketdata/internal/fmp/fmp_client.go:243` (key set at `:222`)
> return fmt.Errorf("fmp: %s request failed: %w", path, err)

`services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go:118` (key set at `:110`)
> return fmt.Errorf("finnhub: %s request failed: %w", path, err)

`services/xstockstrat-marketdata/internal/fmp/fmp_client.go:254` / `internal/finnhub/finnhub_client.go:126`
> // Never include the URL (it carries the apikey) in the error.

`services/xstockstrat-marketdata/internal/service/marketdata_service.go:1704` (also `:1760`)
> return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("%s fetch: %w", s.fundProvider, err))

### D-40

`services/xstockstrat-config/src/grpc/authz.ts:115-119`
> callerID: 'marketdata',
> namespace: 'marketdata',
> keys: ['alpaca.api_key', 'alpaca.api_secret', 'fmp.api_key', 'finnhub.api_key'],

`services/xstockstrat-config/src/grpc/authz.ts:110`
> /** When set, the mTLS peer certificate must carry this exact DNS SAN — the header alone is spoofable. */

`services/xstockstrat-config/src/grpc/authz.ts:124` (the ingest grant, SAN-bound)
> peerSan: 'xstockstrat-ingest',

`services/xstockstrat-marketdata/internal/config/config.go:109`, `:115`: marketdata presents
`x-internal-caller: marketdata` over an mTLS channel (`config.go:70`, `mtls.ClientConfig("xstockstrat-config")`).
`scripts/gen-dev-certs.sh:28`, `:50`: the marketdata leaf is minted with `subjectAltName = DNS:xstockstrat-marketdata`,
so the SAN binding is available today.

## Root cause hypothesis

- **D-39:** The `%w` wrap on the transport path keeps the `*url.Error`. The redaction was applied only to the
  status-code branch.
- **D-40:** Feature 224 added `peerSan` for the new ingest grant and left the existing marketdata grant
  unchanged on purpose (feature 224 `implementation-spec.md:1615`). No later feature closed the gap.

## Confidence

high
