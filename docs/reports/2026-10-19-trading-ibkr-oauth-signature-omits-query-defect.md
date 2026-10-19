# Defect: IBKR OAuth signature base omits query parameters on GET requests

**Recorded**: 2026-10-19
**Severity**: SEV-2
**Impact type**: broker-auth-failure
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-trading
**Config-only fix possible**: no
**Source**: `services/xstockstrat-trading/docs/context-constitution-findings.md` § Open questions, row 1 (IBKR `signRequest`)

## Observed
Three IBKR GET calls (`resolveConid`, `GetOrder`, `ListOrders`) set `httpReq.URL.RawQuery` and then
sign the bare `endpoint` string. `signRequest` builds the OAuth 1.0a signature base only from the
`oauth_*` params, so the request's query params are never part of the signature. If IBKR enforces
RFC 5849 §3.4.1.3, these GETs fail with 401. Per TRADING-3, a 401 maps to
`broker.ErrInvalidCredentials`, so the account would also be marked INVALID.

## Expected
The signature base string includes every query parameter actually sent, sorted and encoded together
with the oauth params, and the base URI excludes the query.

## Reproduction
1. Register a live (non-paper) IBKR account with valid OAuth credentials.
2. Place an order for a symbol, which triggers `resolveConid`'s `GET .../secdef/search?symbol=…&types=STK`.
3. Look for a 401 from IBKR, or for the account's `CredentialStatus` flipping to INVALID.
4. Repeat with the fill poller (`GetOrder`) and the reconciliation poller (`ListOrders`).

## Evidence
`services/xstockstrat-trading/internal/broker/ibkr.go:167`
> httpReq.URL.RawQuery = q.Encode()

`services/xstockstrat-trading/internal/broker/ibkr.go:168`
> httpReq.Header.Set("Authorization", c.signRequest(http.MethodGet, endpoint))

`services/xstockstrat-trading/internal/broker/ibkr.go:388-389` (GetOrder) and `:427-428` (ListOrders) follow the same pattern.

`services/xstockstrat-trading/internal/broker/ibkr.go:580`
> func (c *IBKRClient) signRequest(method, rawURL string) string {

## Root cause hypothesis
`signRequest` takes a URL string rather than the built `*http.Request`. Callers pass the
pre-query endpoint, and the function never parses or includes query params in the parameter string.
The paper endpoint, or lenient IBKR validation, may be hiding the problem.

## Confidence
low
