# Defect: RevokeToken trusts an unverified JWT and revokes all of the decoded user's sessions

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: authz-bypass
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-identity
**Config-only fix possible**: no
**Source**: `services/xstockstrat-identity/docs/context-constitution-findings.md` § Open questions bullet 1; constitution § Gotchas (`revokeToken` decodes without verifying)

## Observed
`revokeToken` uses `jwt.decode` (no signature check) and revokes every active refresh token for the
decoded `user_id`. It returns `success:true` for empty or garbage input. Any caller that can reach the
RPC can log out an arbitrary user with a hand-crafted unsigned token (a logout DoS). Through the UI
this is mitigated: `/api/auth/logout` is not excluded from the middleware matcher, so the access-token
cookie is verified first. The remaining exposure is any direct mTLS gRPC caller.

## Expected
Verify the signature with `ignoreExpiration: true`, so expired-but-genuine tokens still log out and forged ones are rejected or ignored.

## Reproduction
1. Build an unsigned JWT whose payload is `{"user_id":"<victim>"}`.
2. Call `IdentityService.RevokeToken({token})` over gRPC (mTLS client).
3. Every `identity.refresh_tokens` row for the victim gets `revoked_at` set.

## Evidence
`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:299`
> `      // Decode without verify to handle expired tokens`

`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:300`
> `      const decoded = (jwt as any).decode(token) as any;`

`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:303`
> `          'UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',`

## Root cause hypothesis
The author wanted expired tokens to still log out and used `decode` instead of `verify(..., {ignoreExpiration:true})`.

## Confidence
high
