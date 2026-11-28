# Defect: SSO review hardening nits on shipped feature 345

**Recorded**: 2026-11-28
**Severity**: SEV-3
**Impact type**: security-hardening
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-ui, xstockstrat-identity, xstockstrat-agent
**Config-only fix possible**: no

Source: independent security review of PR #1637 (feature 345, merged as `6739f030`), rated "nit, not
exploitable today". On 2026-11-28 the owner asked for all five items to be fixed. Item numbers follow
the review.

## Observed

4. The UI middleware forwards inbound `x-user-id` / `x-access-scope` to the UI's own route handlers
   (it copies every request header; the public early-return paths pass them through untouched).
5. Identity's `IssueSessionForUser` and `ResolveExternalIdentity` serve in `auth.mode` `local`; only
   the UI and the agent enforce the mode, behind the mTLS SAN gate.
6. The link transaction seals `user_id` and `created_at` only. A link started in one session of a
   user can be confirmed from another session of the same user.
7. A callback failure after the transaction cookie is opened leaves that cookie set; `sso_link` is
   set with `Path=/`, so it is sent on every request.
8. The agent JWKS ingest accepts a key with `use: "enc"` for signature verification.

## Expected

4. Inbound `x-user-id` / `x-access-scope` never reach a UI handler; the middleware keeps setting
   `x-trace-id`.
5. Both RPCs refuse in `local` with FAILED_PRECONDITION, as `LinkExternalIdentity` does.
6. The link is bound to the session that started it (hash of its refresh token, as identity stores
   `token_hash`); confirm from another session is refused.
7. Every callback failure after the txn is opened clears it; `sso_link` is scoped to its readers.
8. Keys whose `use` is present and not `sig` are skipped with a logged reason.

## Reproduction

1. Item 4: `curl -H 'x-user-id: forged' -H 'x-access-scope: 7'` any matched UI route; the handler
   sees both headers.
2. Item 5: call `IssueSessionForUser` from a SAN-allowed peer with identity `auth.mode=local`; a
   session is minted.
3. Item 6: start a link in session A, log in again as the same user (session B), confirm from B;
   it succeeds.
4. Item 7: callback with a valid txn and a failing code exchange; the response does not clear the
   `sso_txn_*` cookie.
5. Item 8: serve a JWKS whose only key has `use: "enc"`; the agent accepts tokens signed by it.

## Evidence

`services/xstockstrat-ui/src/middleware.ts:72`
> ...Object.fromEntries(req.headers),

`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:1059`
> async issueSessionForUser(call: any, callback: any) {

`services/xstockstrat-ui/src/lib/ssoTxn.ts:27`
> user_id: string;

`services/xstockstrat-ui/src/app/api/auth/sso/callback/route.ts:64`
> txn.purpose === 'link' ? linkFail(code) : loginFail(code, { fault });

`services/xstockstrat-ui/src/lib/ssoTxn.ts:117`
> path: '/',

`services/xstockstrat-agent/app/jwks.py:110`
> if not isinstance(kid, str) or not kid or alg not in _ASYMMETRIC_ALGS:

## Root cause hypothesis

Defense-in-depth checks omitted in the 345 implementation; each is a local fix.

## Confidence

high
