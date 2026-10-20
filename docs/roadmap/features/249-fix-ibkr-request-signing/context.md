# Context Log: fix-ibkr-request-signing

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-19-trading-ibkr-oauth-signature-omits-query-defect.md`
  (Issues disabled). Source: `services/xstockstrat-trading/docs/context-constitution-findings.md` § Open questions row 1.
- Severity: SEV-2. Impact type: broker-auth-failure. Environment: dev (main-dev) @ 1302e6d. Config-only: no.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..3), context.md.
- Affected services (from report): xstockstrat-trading. Triage grep adds possible xstockstrat-ui
  (`src/components/trader/accountShared.tsx`) and xstockstrat-agent (`app/tools.py`), which carry the IBKR
  credential fields, if the LST handshake needs new key material.
- Root cause hypothesis: `signRequest` (`internal/broker/ibkr.go:580`) is generic OAuth 1.0a — query params never
  merged into the base string; HMAC key `"&" + accessTokenSecret`; no LST handshake; no `realm`.
- Confirmation evidence (report): scratch test `zz_sigrepro_test.go` captured `GetOrder`'s header for query
  `orderId=42`: client sig `fVi5RZ…MQ3I=` matches the reference with query OMITTED; the RFC 5849 §3.4.1.3 reference
  with query INCLUDED is `41mcn4…8G0=` (no match); `realm present in header: false`. The LST/`realm` requirement
  comes from the ibind reference client and IBKR docs; a live 401 has not been observed against a real account.
  Existing tests (`TestSubmitOrder_IBKRResolvesConid`, `TestGetOrder_IBKRAvgPrice`, `TestIBKRListOrders_*`,
  `TestReplaceOrder_IBKR`) check paths/query values or header presence only.
- Scope widened at confirmation: the query-param omission is the narrow bug; the missing LST handshake and `realm`
  mean every IBKR call (including no-query `ValidateCredentials`) is expected to 401.
- **C-11 tension (unresolved, for design):** the query-param fix is a bug fix. The LST handshake (RSA-SHA256 request
  signing, Diffie-Hellman exchange, LST derivation/caching/refresh, new encrypted credential fields) is arguably new
  capability that original IBKR feature 001 (`docs/roadmap/features/001-add-ikbr-account-support/`, launched
  2026-05-12, archived) never built — 001 chose the IBKR Web API over Client Portal Gateway for unattended use
  (001 context.md Archive Synthesis) but shipped plain OAuth 1.0a. Design must decide, with operator sign-off,
  whether the LST work stays in this bug track (as completing 001's intended contract) or splits to `/sdd-story`
  per C-11. Record that decision here.
- Recommended design depth: full → `/sdd-design fix-ibkr-request-signing` (rationale: SEV-2; the C-11 scope fork
  above; possible credential-shape change spanning trading/UI/agent plus the `trading.proto:267` shape comment;
  Security review of new key material; LST lifecycle/caching under the IBKR client pool).
- Development branch: feature/fix-ibkr-request-signing
