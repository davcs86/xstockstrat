# Defect: IBKR request signing omits query params and never uses a Live Session Token, so IBKR calls are expected to 401

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
`oauth_*` params, so the request's query params are never part of the signature. IBKR's scheme
includes query params in the base string (RFC 5849 §3.4.1.3), so these GETs are expected to fail
with 401.

The problem goes beyond query params. `signRequest` signs every request, POSTs and DELETEs
included, with HMAC-SHA256 keyed by `&` + the access token secret. IBKR keys regular requests with
the base64-decoded Live Session Token (LST), which a client gets from an RSA-SHA256 /
Diffie-Hellman handshake. The repo has no LST handshake, and the header carries no `realm`. Every
IBKR call is therefore expected to 401. Per TRADING-3, a 401 maps to
`broker.ErrInvalidCredentials`, so the account would also be marked INVALID.

## Expected
- The client obtains a Live Session Token through IBKR's OAuth 1.0a handshake.
- Each request is signed with HMAC-SHA256 keyed by that token, and the header carries `realm`
  (`limited_poa`).
- The signature base string includes every query parameter actually sent, sorted and encoded
  together with the oauth params, and the base URI excludes the query.

## Reproduction
1. Register an IBKR account with valid OAuth credentials. Paper and live accounts both hit
   `https://api.ibkr.com/v1/api` with the same signing.
2. Place an order for a symbol, which triggers `resolveConid`'s `GET .../secdef/search?symbol=…&types=STK`.
3. Look for a 401 from IBKR, or for the account's `CredentialStatus` flipping to INVALID.
4. Repeat with the fill poller (`GetOrder`), the reconciliation poller (`ListOrders`), and a call
   with no query such as `ValidateCredentials`. The missing LST should make that one fail as well.

Local repro, no IBKR account needed: the scratch test
`/tmp/claude-0/-home-user-xstockstrat/0e33c54d-7bf5-528d-8d50-aaa4bc92a407/scratchpad/confirm/trading-ibkr-oauth-signature-omits-query/zz_sigrepro_test.go`.
Copy it into `services/xstockstrat-trading/internal/broker/` and run
`GOWORK=off go test ./internal/broker/ -run TestZZ_ -v`.

## Evidence
`services/xstockstrat-trading/internal/broker/ibkr.go:167`
> httpReq.URL.RawQuery = q.Encode()

`services/xstockstrat-trading/internal/broker/ibkr.go:168`
> httpReq.Header.Set("Authorization", c.signRequest(http.MethodGet, endpoint))

`services/xstockstrat-trading/internal/broker/ibkr.go:388-389` (GetOrder) and `:427-428` (ListOrders) follow the same pattern.

`services/xstockstrat-trading/internal/broker/ibkr.go:580`
> func (c *IBKRClient) signRequest(method, rawURL string) string {

The signing key is taken from the access token secret, not an LST:

`services/xstockstrat-trading/internal/broker/ibkr.go` (`signRequest`)
> signingKey := "&" + url.QueryEscape(c.accessTokenSecret)

Grepping `services/xstockstrat-trading` for `live_session`, `realm`, `limited_poa` and `diffie`
returns nothing.

Paper mode does not change the endpoint or the signing. `instantiateBrokerLocked`
(`services/xstockstrat-trading/internal/service/trading.go:3009-3015`) never sets `BaseURL`, so
every IBKR client uses the default `https://api.ibkr.com/v1/api` (`ibkr.go:51`).

The scratch test (path above) captures the Authorization header that `GetOrder` sends to an
httptest server. It then recomputes the signature with the client's own key, once without the query
and once with it. Output:
> sent query: "orderId=42"
> client sig            = fVi5RZtDZRku/KmToUK0TlhdGSrtHMW1Imgkfc8MQ3I=
> ref sig, query OMITTED = fVi5RZtDZRku/KmToUK0TlhdGSrtHMW1Imgkfc8MQ3I=  match=true
> ref sig, query INCLUDED (RFC 5849 §3.4.1.3) = 41mcn4Gv8fkv2Y6e1cwF6rKC3wavDQwoW/BW5So8OG0=  match=false
> realm present in header: false

Reference implementation: the ibind client
(`https://raw.githubusercontent.com/Voyz/ibind/master/ibind/oauth/oauth1a.py`).
- `generate_base_string` merges query params into the base string
  (`base_string_params.update(request_params or {})`).
- Regular requests use HMAC-SHA256 keyed by
  `HMAC.new(bytes(base64.b64decode(live_session_token)), digestmod=SHA256)`.
- RSA-SHA256 is used only for the request-token, access-token and LST requests.
- The header is `OAuth realm="limited_poa", …`.

The existing tests don't catch any of this. `TestSubmitOrder_IBKRResolvesConid`,
`TestGetOrder_IBKRAvgPrice` and `TestIBKRListOrders_*` (`internal/broker/ibkr_test.go`) send GETs
with query params but check only the path and query values. `TestReplaceOrder_IBKR` checks only
that an Authorization header is present.

## Root cause hypothesis
`signRequest` was written as plain OAuth 1.0a, not IBKR's variant.
- It takes a URL string rather than the built `*http.Request`. Callers pass the pre-query endpoint,
  and the function never parses or includes query params in the parameter string.
- It uses `&` + access_token_secret as the HMAC key. The client never performs IBKR's Live Session
  Token handshake, and it omits `realm`.

Fixing only the query params will not make IBKR work. The client needs the LST handshake and
LST-keyed signing as well.

## Confidence
high: a local test showed that the signature excludes the query params. IBKR's need for the Live
Session Token and `realm` comes from the ibind reference implementation and IBKR's docs, not from a
live call. The full 401 has not been seen against a real IBKR account.
