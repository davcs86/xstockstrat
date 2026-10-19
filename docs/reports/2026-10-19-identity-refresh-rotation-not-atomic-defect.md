# Defect: Refresh-token rotation is not atomic (double-spend and lost-token window)

**Recorded**: 2026-10-19
**Severity**: SEV-1
**Impact type**: token-rotation-double-spend
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-identity, xstockstrat-ui, xstockstrat-agent
**Config-only fix possible**: no
**Source**: `services/xstockstrat-identity/docs/context-constitution-findings.md` § Latent bugs row 1 (`refreshOAuthToken` revoke/insert non-transactional); extended here to first-party `refreshToken`

## Observed
Both rotation handlers do check-then-act across separate autocommit pool queries:
1. `SELECT … WHERE token_hash = $1 AND rt.revoked_at IS NULL` (no `FOR UPDATE`),
2. `UPDATE … SET revoked_at = NOW() WHERE token_id = $1` (no `AND revoked_at IS NULL`, rowCount unchecked),
3. `INSERT` of the new refresh token.
Two concurrent refreshes of the same token both pass step 1 and both mint a new access + refresh
pair, so a stolen refresh token stays usable alongside the legitimate one (rotation does not detect
reuse). A crash or DB error between step 2 and step 3 revokes the old token without issuing a new one,
so the user is logged out. `refreshOAuthToken` adds a fourth separate query (`last_used_at` bump).
This affects first-party UI sessions (`RefreshToken`) and MCP agent OAuth grants (`RefreshOAuthToken`).

## Expected
Rotation runs in one transaction, with a conditional claim such as
`UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW() RETURNING …`.
Exactly one concurrent caller wins; the loser gets UNAUTHENTICATED; the new token is inserted in the same transaction.

## Reproduction
1. Authenticate and get a refresh token R (UI login, or the OAuth code exchange for the agent).
2. Send two `RefreshToken` (or `RefreshOAuthToken`) RPCs with R concurrently.
3. Both return success, each with a distinct new refresh token, and both new tokens are active in `identity.refresh_tokens`.
4. Separately, inject a failure after the revoke UPDATE: R is revoked and no successor row exists.

## Evidence
`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:241`
> `           AND rt.revoked_at IS NULL`

`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:253` (refreshToken)
> `        'UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE token_id = $1',`

`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:525` (refreshOAuthToken)
> `        'UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE token_id = $1',`

`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:532`
> `      const newRefreshToken = await this.issueRefreshToken(user_id, client_id ?? undefined);`

## Root cause hypothesis
Rotation was written as SELECT-then-UPDATE-then-INSERT on `this.pool` with no transaction, row lock,
or conditional revoke. Neither handler checks the revoke's rowCount, so nobody detects that a concurrent caller already consumed the token.

## Confidence
high (the code shape is unambiguous; the concurrent double-spend has not been reproduced against a live DB)
