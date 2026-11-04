# IBKR Broker Notes

> On-demand detail relocated from `CLAUDE.md` (context-forge just-in-time move). Load when working on `internal/broker/ibkr.go` or IBKR P&L.

### IBKR: Hedged Mode not supported

The IBKR integration (`internal/broker/ibkr.go`) assumes the account uses **netting mode** (the default for standard and margin accounts), where a buy order automatically offsets an open short position in the same security. IBKR also offers **Hedged Mode** (available to portfolio-margin and institutional accounts), which allows simultaneous long and short lots in the same security without automatic netting.

If an IBKR account is configured for Hedged Mode:

1. `pollFills` may emit `order.filled` events for both a buy and a sell in the same security that coexist rather than net — the fill payloads will be structurally valid but represent distinct lots.
2. `xstockstrat-portfolio`'s `GetPnL` two-pass algorithm (feature `013-phase-2-data-layer`) applies all `order.filled` events before all `order.partially_filled` events regardless of chronological order. In netting-mode accounts this produces correct P&L because opposing positions cannot coexist; in Hedged Mode the ordering may produce incorrect cost-basis calculations for interleaved fills.

**To add Hedged Mode support**: add an `IsHedged bool` field to `IBKRConfig`, propagate it to `BrokerOrder` or a separate signal, and update `GetPnL` in `xstockstrat-portfolio` to merge and sort both event types by `recorded_at` before feeding the accumulator.

Alpaca is unaffected: Alpaca prohibits simultaneous long and short positions in the same security at the API level (returns `position intent mismatch` if attempted).

### IBKR: order confirmation prompts are auto-confirmed (bounded)

The Client Portal API can answer an order POST (`SubmitOrder`, `ReplaceOrder`, `SubmitBracketLegs`) with a precautionary prompt (`[{"id", "message"}]`) instead of an order reply. The order is not placed until `POST /iserver/reply/{id}` confirms it, and IBKR may chain one prompt per warning. `resolveIBKROrderReplies` **auto-confirms** each prompt with `{"confirmed":true}` (operator decision, 2026-10-05) and logs every confirmed message at WARN (`ibkr: auto-confirming order prompt`) for audit. After `ibkrMaxConfirmRounds` (5) it stops and returns `broker.ErrIBKRConfirmationRequired`, so the order is recorded `REJECTED`. A transport error on a reply is returned wrapped, so a timeout stays an *uncertain* outcome (the confirmation may have placed the order) and is reclaimed like any other. Any final reply element with an empty `order_id` is an error. No order is ever stored as submitted with an empty broker id.

Trailing stops (`trailing_stop` → `TRAIL`) send `trailingAmt` with `trailingType` `amt` (from `trail_price`) or `%` (from `trail_percent`). `ReplaceOrder` does not map `trail` for IBKR.

### IBKR: OAuth 1.0a + Live Session Token (feature 249)

**Credential blob.** An IBKR account's `credentials_json` carries 7 string fields: `consumer_key`, `access_token`, `access_token_secret` (the base64 encrypted secret IBKR issues), `ibkr_account_id`, `signature_key` and `encryption_key` (PEM RSA private keys, PKCS#1 or PKCS#8), and `dh_prime` (a PEM `DH PARAMETERS` block). `RegisterBrokerAccount` and `UpdateBrokerAccountCredentials` reject an IBKR blob that is missing any of them with `InvalidArgument`, naming the missing fields and never a value (`validateIBKRCreds`, `internal/service/trading.go`). A legacy 4-field account still instantiates. Every session attempt then fails locally with `ErrInvalidCredentials` (`IBKRClient.credErr`), so the account reads INVALID until its credentials are updated.

**Handshake order** (`internal/broker/ibkr_session.go`). `ensureSession` runs at most one coalesced handshake per client. It uses the `singleflight` key `"lst"` and a detached context bounded by `HandshakeTimeout`:

1. `POST /oauth/live_session_token` (`mintLST`) decrypts `access_token_secret` with `encryption_key` (PKCS#1 v1.5). The request is signed RSA-SHA256 with `signature_key` over the hex of that secret prepended to the base string, and it carries the Diffie-Hellman challenge (`authorizeLST`). The LST is HMAC-SHA1 of the decrypted secret, keyed by the DH shared secret serialized as Java `toByteArray` (`computeLST`). It is checked against the reply's `live_session_token_signature`, which is `hex(HMAC-SHA1(LST, consumer_key))`.
2. `POST /iserver/auth/ssodh/init` sends `{"publish":true,"compete":false}`, signed with the new LST. A reply with `authenticated:false` is `ErrInvalidCredentials`.

A handshake that fails with `ErrInvalidCredentials` is negatively cached for `ReauthMinInterval`. The session is re-minted `LSTRefreshMargin` before the LST expires.

**Regular requests** are signed by `authorize` (`internal/broker/ibkr.go`) with HMAC-SHA256 keyed by the LST. The header starts with `realm="limited_poa"` and carries no `oauth_version`. Encoding is pinned to the ibind reference: Go `url.QueryEscape` (Python `quote_plus`) is applied once to the base URI and once to the joined `k=v` string, and the header's signature value is `QueryEscape`d too. `buildBaseString` is the single place where the URL's query params enter the base string.

**Retry rule.** `IBKRClient.do` is the only send path for the 11 regular calls:

- A 401 is resent at most once. If another caller already minted a newer session, the resend uses it. Otherwise the session is invalidated (at most once per `ReauthMinInterval`) and a new handshake runs first. A 401 is final when this call itself just minted the session.
- A 400 `no bridge` on an `/iserver/` path re-runs only `ssodh/init` and resends once.
- `SubmitBracketLegs` passes `noResend`, so a bracket leg is never resent.
- A POST/DELETE whose resend after a 401 fails returns `broker.ErrOutcomeUncertain`. The service classifies it like a timeout (`isUncertainBrokerOutcome`).
- A final 401/403 from any call (handshake, `ssodh/init` or a regular call) returns `ErrInvalidCredentials` (TRADING-3). `reconcileTick` skips an account whose `ListOrders`/`GetPositions` returns it and does not count it as systemic.

**Config keys.** These are read live on every use, and a value `<= 0` reads as the default. They are registered in `CLAUDE.md` § Config Keys Consumed: `trading.ibkr.lst_refresh_margin_ms` (60000), `trading.ibkr.handshake_timeout_ms` (10000) and `trading.ibkr.reauth_min_interval_ms` (30000).

**Unverified contract.** No real IBKR account has been exercised. The signer and handshake are pinned to known-answer vectors generated from ibind @ `759ec3a127accfb03e76bcd54856d1421d986e6a` (`internal/testdata/ibkr/gen_vectors.py` → `vectors.json`), so the tests prove agreement with ibind, not acceptance by IBKR. ibind never reads the `ssodh/init` reply fields (`authenticated`, `competing`). One deliberate deviation from ibind remains: ibind signs regular requests **without** query params, while FR-3 includes them. The operator ruled on 2026-10-29: "Include params (FR-3)". If IBKR behaves like ibind, every GET with a query (`resolveConid`, `GetOrder`, `ListOrders`) gets a 401. A paper smoke against a real account settles this, and the fix point is `buildBaseString`.

**Follow-ups (not built):** `ibkr-session-keepalive` (a `/tickle` keepalive for the brokerage session) and `ibkr-fleet-invalid-alert` (one aggregate alert when every IBKR account reads INVALID).
