# Defect: OAuth auth-code exchange is check-then-act, so one authorization code can be redeemed more than once

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: auth-code-replay
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-identity
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-23 (auth-code single-use half only; flagged security) and D-21 (mint/refresh duplication, residual after hotfix `5bd271d`). Re-verified against main-dev @ a053b0e on 2026-10-21; current lines below.

## Observed

### D-23 — Single-use auth codes are check-then-act

`ExchangeAuthCode` reads the code row with a plain `SELECT` (no row lock), checks `consumed_at !== null` in JS,
verifies expiry, redirect URI, client id and PKCE, and only then runs an **unconditional**
`UPDATE … SET consumed_at = NOW() WHERE code = $1`. Each statement is its own autocommit query on the pool. Two
concurrent exchanges of the same code both pass the JS check before either UPDATE lands, and both mint an
audience-bound access JWT plus an independent refresh token. OAuth 2.1 requires an authorization code to be
redeemable exactly once; an intercepted code (with its verifier) replayed in parallel with the legitimate client
yields a second, independently refreshable grant that revoking the first token family does not cover.

The refresh-rotation half of the scan's D-23 is **not** part of this report: it was fixed by hotfix `5bd271d`
(report `2026-10-19-identity-refresh-rotation-not-atomic-defect`, now `resolved`). Both refresh handlers now go
through `rotateRefreshToken`, a single transaction with a conditional `UPDATE … WHERE revoked_at IS NULL …
RETURNING`. The auth-code path was not changed by that hotfix.

### D-21 — Token mint / refresh-issue logic is still duplicated (residual)

After `5bd271d` the duplicated refresh **lookup** (the scan's two SELECT sites) is gone. What remains:
- the access-JWT claim build + `jwt.sign` is written inline in `authenticateUser` and again in `refreshToken`,
  beside the `mintOAuthAccessToken` helper that differs only by `aud`;
- `authenticateUser` generates, hashes and INSERTs its refresh token inline instead of calling
  `issueRefreshToken`, which already exists and already takes a transaction client.

Consequence today: any change to claim shape, TTL or refresh-token storage must be made in two or three places, and
the D-23 fix (which naturally reuses `issueRefreshToken` inside a transaction) does not cover first-party login.

## Expected

- D-23: an authorization code is redeemed at most once under concurrency. The consume is a conditional claim
  (`UPDATE … SET consumed_at = NOW() WHERE code = $1 AND consumed_at IS NULL AND expires_at > NOW() RETURNING …`),
  ideally in the same transaction as the successor refresh-token INSERT (mirroring `rotateRefreshToken`). Of N
  concurrent exchanges of one valid code, exactly one succeeds and the rest get `UNAUTHENTICATED` (`invalid_grant`).
- D-21: one access-token mint helper and one refresh-token issue helper are used by first-party login, first-party
  refresh and both OAuth paths, with claim shape unchanged (first-party tokens carry no `aud`).

## Reproduction

1. Against a real Postgres (as the `5bd271d` hotfix did for refresh): register an OAuth client, `IssueAuthCode`
   for user `u-1` with a known PKCE verifier, then fire 20 concurrent `ExchangeAuthCode` calls with the same
   `code`, `code_verifier`, `redirect_uri` and `client_id`.
2. Count successes and distinct refresh tokens in `identity.refresh_tokens` for `u-1` / that `client_id`. Expected
   by the bug: more than one success and more than one refresh token. Correct: exactly one.
3. D-21: `grep -n "jwt as any).sign\|INSERT INTO identity.refresh_tokens" identityServiceImpl.ts` shows three sign
   sites and two refresh INSERT sites.

## Evidence

### D-23 — Single-use auth codes are check-then-act

`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:481-491` (unlocked read + JS check)
> const result = await this.pool.query(
>   `SELECT ac.client_id, ac.user_id, ac.redirect_uri, ac.code_challenge, ac.resource,
>           ac.consumed_at, ac.expires_at, u.email, u.roles
> ...
> if (row.consumed_at !== null) return callback({ code: 16, message: 'invalid_grant' });

`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:503-511` (unconditional consume, separate refresh INSERT)
> await this.pool.query(
>   'UPDATE identity.oauth_auth_codes SET consumed_at = NOW() WHERE code = $1',
>   [codeHash]
> );
> ...
> const refreshToken = await this.issueRefreshToken(row.user_id, clientId);

Reference fix pattern from `5bd271d`: `identityServiceImpl.ts:340-370` (`rotateRefreshToken`, BEGIN →
conditional `UPDATE … WHERE … revoked_at IS NULL … RETURNING` → `issueRefreshToken(…, client)` → COMMIT).

### D-21 — Token mint / refresh-issue duplication (residual)

`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:166-176` (authenticateUser) and `:243-249`
(refreshToken) build claims and call `(jwt as any).sign(…)` inline; `:295-315` `mintOAuthAccessToken` is the same
build plus `aud`.

`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:178-185` (authenticateUser inline)
> const refreshToken = uuidv4();
> const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
> await this.pool.query(
>   `INSERT INTO identity.refresh_tokens (user_id, token_hash, expires_at)

duplicates `:321-334` `issueRefreshToken(userId, clientId?, db = this.pool)`.

## Root cause hypothesis

The OAuth exchange was written as read-validate-write with independent autocommit queries; the hotfix for the
identical refresh-rotation race (`5bd271d`) was scoped to refresh only. D-21 is helper extraction done for the OAuth
path but never back-applied to first-party login/refresh.

## Confidence

high for the code shape (direct read of current code). The concurrent double-redeem has not yet been executed
against Postgres for the auth-code path; the identical pattern on refresh rotation double-minted in 19/20 and 20/20
trials per the `5bd271d` commit message.
