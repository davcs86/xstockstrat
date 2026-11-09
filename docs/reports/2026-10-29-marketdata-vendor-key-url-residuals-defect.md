# Defect: marketdata vendor API keys still ride in the request URL (redirect-parse residual + access logs)

**Recorded**: 2026-10-29
**Severity**: SEV-2
**Impact type**: secret-disclosure
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-marketdata
**Config-only fix possible**: no
**Source**: filed by feature 254 (`fix-marketdata-secret-exposure`) Step 8, as the residuals that feature accepted

## Observed

Feature 254 stopped the FMP and Finnhub clients from wrapping the key-bearing `*url.Error`: at the transport
(`Do`) site and the `build request` site, `getJSON` now `%w`-wraps only `ue.Err`. Both of those sites are
**fixed** and are not residuals. Two paths remain, because the key is still sent as a query parameter
(`apikey=` for FMP, `token=` for Finnhub):

- **(a) Redirect residual.** When a vendor answers with a redirect whose `Location` header fails to parse,
  `net/http`'s `Client.do` builds the error `failed to parse Location header %q: %v` and wraps it in `uerr`.
  After the 254 fix, the client wraps that inner cause (`ue.Err`), and the inner text still quotes the
  vendor-sent `Location`. If the vendor echoes the request query (with the key) into `Location`, the key
  reaches the error, the gRPC `Unavailable` status and logs. Accepted untested by feature 254 (design.md).
- **(b) Access logs.** Every request URL carries the key, so it is recorded in the vendor's access logs and in
  any egress proxy or load-balancer log on the path that logs full URLs.

## Expected

No vendor API key appears in any error text, log line or URL that leaves the process.

## Reproduction

1. (a) Point `fmp.NewClient` at an `httptest` server that returns `302` with a `Location` header that is
   unparseable and contains the request's query string, then call `GetFundamentalsMulti`. The returned
   error text contains `apikey=`.
2. (b) Route marketdata's vendor traffic through any proxy that logs request URLs and observe
   `apikey=` / `token=` in its log.

## Evidence

`services/xstockstrat-marketdata/internal/fmp/fmp_client.go:222-223`
> params.Set("apikey", c.apiKey)
> u := c.baseURL + path + "?" + params.Encode()

`services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go:111-112`
> params.Set("token", c.apiKey)
> u := c.baseURL + path + "?" + params.Encode()

`$GOROOT/src/net/http/client.go`, `Client.do` (go1.27.0; the line number varies by toolchain build)
> return nil, uerr(fmt.Errorf("failed to parse Location header %q: %v", loc, err))

## Root cause hypothesis

The key travels in the query string, so every URL-bearing surface (redirect errors, access logs) can carry it.
Recommended fix that closes the class: send the key in a request header — FMP `apikey` header, Finnhub
`X-Finnhub-Token` (vendor support for both is **unverified**). If URL-bearing errors must still be handled
after that, consolidate the `*url.Error` unwrap in one shared `redactURLError` helper used by both clients.

## Confidence

high for (b); low for (a), which depends on a vendor echoing the query into a malformed `Location`
