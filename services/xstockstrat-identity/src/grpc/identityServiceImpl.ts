import { Pool } from 'pg';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { ConfigWatcher } from '../services/configWatcher';
import { getLogger } from '../services/logger';

const log = getLogger('identity:impl');

// ts-proto's grpc-js serializer maps `google.protobuf.Timestamp` fields to JS
// `Date` and calls `.getTime()` on them during encode. Responses must therefore
// carry `Date` instances, not `{ seconds }` plain objects — otherwise encoding
// throws a TypeError, which grpc-js surfaces to callers as an INTERNAL
// trailers-only error (the handler's own try/catch cannot intercept it because
// the failure happens after `callback(null, ...)` returns). The Connect adapter
// converts these Dates to protobuf-es Timestamps for the HTTP path.
function secondsToDate(seconds: number): Date {
  return new Date(seconds * 1000);
}

export class IdentityServiceImpl {
  constructor(
    private readonly pool: Pool,
    private readonly config: ConfigWatcher,
  ) {}

  private get jwtSecret(): string {
    // Secret keys are not stored in config service — sourced from env only.
    // JWT_SECRET must be set in the environment; see .env.example.
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required but not set. See .env.example.');
    }
    return secret;
  }

  private get accessTtlSeconds(): number {
    return this.config.getInt('identity.jwt.access_ttl_seconds', 900);
  }

  private get refreshTtlSeconds(): number {
    return this.config.getInt('identity.jwt.refresh_ttl_seconds', 2592000);
  }

  /**
   * AuthenticateUser — validates credentials, returns JWT pair.
   */
  async authenticateUser(call: any, callback: any) {
    const { email, password } = call.request;
    if (!email || !password) {
      return callback({ code: 3, message: 'email and password required' });
    }
    try {
      const result = await this.pool.query(
        'SELECT user_id, password_hash, roles FROM identity.users WHERE email = $1 AND is_active = true',
        [email]
      );
      if (result.rows.length === 0) {
        return callback({ code: 16, message: 'invalid credentials' });
      }
      const user = result.rows[0];

      const passwordValid = await bcrypt.compare(password, user.password_hash);
      if (!passwordValid) {
        return callback({ code: 16, message: 'invalid credentials' });
      }

      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + this.accessTtlSeconds;
      // JWT payload uses snake_case claim names — these are internal JWT fields, not proto fields
      const claimsPayload = {
        user_id: user.user_id,
        email,
        roles: user.roles ?? [],
        issued_at: now,
        expires_at: expiresAt,
      };

      const accessToken = (jwt as any).sign(claimsPayload, this.jwtSecret, {
        expiresIn: this.accessTtlSeconds,
      });

      const refreshToken = uuidv4();
      const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

      await this.pool.query(
        `INSERT INTO identity.refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval)`,
        [user.user_id, refreshTokenHash, this.refreshTtlSeconds]
      );

      log.info('User authenticated', { userId: user.user_id });
      callback(null, {
        accessToken,
        refreshToken,
        expiresAt: secondsToDate(expiresAt),
        claims: {
          userId: user.user_id,
          email,
          roles: user.roles ?? [],
          issuedAt: secondsToDate(now),
          expiresAt: secondsToDate(expiresAt),
        },
      });
    } catch (err: any) {
      log.error('authenticateUser failed', { error: err.message });
      callback({ code: 13, message: err.message });
    }
  }

  /**
   * ValidateToken — verifies JWT signature and expiry, returns claims.
   */
  async validateToken(call: any, callback: any) {
    const { token } = call.request;
    if (!token) return callback({ code: 3, message: 'token required' });
    try {
      const decoded = (jwt as any).verify(token, this.jwtSecret) as any;
      callback(null, {
        userId: decoded.user_id ?? '',
        email: decoded.email ?? '',
        roles: decoded.roles ?? [],
        issuedAt: secondsToDate(decoded.issued_at ?? Math.floor(Date.now() / 1000)),
        expiresAt: secondsToDate(decoded.expires_at ?? decoded.exp ?? 0),
        aud: decoded.aud ?? '',
      });
    } catch (err: any) {
      callback({ code: 16, message: 'invalid or expired token' });
    }
  }

  /**
   * RefreshToken — validates refresh token, rotates it, issues new JWT pair.
   */
  async refreshToken(call: any, callback: any) {
    const { refreshToken } = call.request;
    if (!refreshToken) return callback({ code: 3, message: 'refreshToken required' });

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    try {
      const result = await this.pool.query(
        `SELECT rt.token_id, rt.user_id, u.email, u.roles
         FROM identity.refresh_tokens rt
         JOIN identity.users u ON u.user_id = rt.user_id
         WHERE rt.token_hash = $1
           AND rt.revoked_at IS NULL
           AND rt.expires_at > NOW()
           AND u.is_active = true`,
        [tokenHash]
      );
      if (result.rows.length === 0) {
        return callback({ code: 16, message: 'invalid or expired refresh token' });
      }
      const { token_id, user_id, email, roles } = result.rows[0];

      // Revoke old refresh token (rotation)
      await this.pool.query(
        'UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE token_id = $1',
        [token_id]
      );

      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + this.accessTtlSeconds;
      const claimsPayload = { user_id, email, roles: roles ?? [], issued_at: now, expires_at: expiresAt };

      const newAccessToken = (jwt as any).sign(claimsPayload, this.jwtSecret, {
        expiresIn: this.accessTtlSeconds,
      });

      const newRefreshToken = uuidv4();
      const newRefreshTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
      await this.pool.query(
        `INSERT INTO identity.refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval)`,
        [user_id, newRefreshTokenHash, this.refreshTtlSeconds]
      );

      log.info('Token refreshed', { userId: user_id });
      callback(null, {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresAt: secondsToDate(expiresAt),
        claims: {
          userId: user_id,
          email,
          roles: roles ?? [],
          issuedAt: secondsToDate(now),
          expiresAt: secondsToDate(expiresAt),
        },
      });
    } catch (err: any) {
      log.error('refreshToken failed', { error: err.message });
      callback({ code: 13, message: err.message });
    }
  }

  /**
   * RevokeToken — revokes all active refresh tokens for the token's owner.
   */
  async revokeToken(call: any, callback: any) {
    const { token } = call.request;
    if (!token) return callback(null, { success: true });
    try {
      // Decode without verify to handle expired tokens
      const decoded = (jwt as any).decode(token) as any;
      if (decoded?.user_id) {
        await this.pool.query(
          'UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
          [decoded.user_id]
        );
        log.info('Tokens revoked', { userId: decoded.user_id });
      }
      callback(null, { success: true });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  // ── OAuth 2.1 authorization-server backend (feature 049 Part B) ───────────

  /** Mint an audience-bound access JWT for the OAuth flow (reuses the standard claim shape). */
  private mintOAuthAccessToken(
    userId: string,
    email: string,
    roles: string[],
    audience: string,
  ): { accessToken: string; expiresIn: number } {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + this.accessTtlSeconds;
    const claimsPayload = {
      user_id: userId,
      email,
      roles: roles ?? [],
      issued_at: now,
      expires_at: expiresAt,
      aud: audience,
    };
    const accessToken = (jwt as any).sign(claimsPayload, this.jwtSecret, {
      expiresIn: this.accessTtlSeconds,
    });
    return { accessToken, expiresIn: this.accessTtlSeconds };
  }

  /**
   * Insert a fresh rotating refresh token for a user; returns the raw token.
   * An optional `clientId` tags the token with the OAuth client that minted it so
   * "My Authorized Apps" (feature 051) can list/revoke it. First-party sessions pass
   * no clientId → NULL client_id (unchanged behavior).
   */
  private async issueRefreshToken(userId: string, clientId?: string): Promise<string> {
    const refreshToken = uuidv4();
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await this.pool.query(
      `INSERT INTO identity.refresh_tokens (user_id, token_hash, expires_at, client_id)
       VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval, $4)`,
      [userId, refreshTokenHash, this.refreshTtlSeconds, clientId ?? null]
    );
    return refreshToken;
  }

  /**
   * RegisterOAuthClient — RFC 7591 Dynamic Client Registration (public client, no secret).
   */
  async registerOAuthClient(call: any, callback: any) {
    const redirectUris: string[] = call.request.redirectUris ?? [];
    const clientName: string = call.request.clientName ?? '';
    if (redirectUris.length === 0) {
      return callback({ code: 3, message: 'at least one redirect_uri is required' });
    }
    // Minimum: every redirect URI must be https:// (the agent edge / config allowlist
    // may tighten this further — Step 13/20).
    for (const uri of redirectUris) {
      if (!uri.startsWith('https://')) {
        return callback({ code: 3, message: 'redirect_uris must use https' });
      }
    }
    const clientId = `oauthc_${crypto.randomBytes(16).toString('hex')}`;
    try {
      await this.pool.query(
        `INSERT INTO identity.oauth_clients (client_id, redirect_uris, client_name)
         VALUES ($1, $2, $3)`,
        [clientId, redirectUris, clientName || null]
      );
      log.info('OAuth client registered', { clientId });
      callback(null, {
        clientId,
        redirectUris,
        clientName,
        createdAt: new Date(),
      });
    } catch (err: any) {
      log.error('registerOAuthClient failed', { error: err.message });
      callback({ code: 13, message: err.message });
    }
  }

  /**
   * GetOAuthClient — look up a registered client (used by the agent for exact-redirect validation).
   */
  async getOAuthClient(call: any, callback: any) {
    const { clientId } = call.request;
    if (!clientId) return callback({ code: 3, message: 'client_id required' });
    try {
      const result = await this.pool.query(
        'SELECT client_id, redirect_uris, client_name, created_at FROM identity.oauth_clients WHERE client_id = $1',
        [clientId]
      );
      if (result.rows.length === 0) return callback({ code: 5, message: 'client not found' });
      const r = result.rows[0];
      callback(null, {
        clientId: r.client_id,
        redirectUris: r.redirect_uris ?? [],
        clientName: r.client_name ?? '',
        createdAt: new Date(r.created_at),
      });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  /**
   * IssueAuthCode — mint a single-use authorization code bound to the PKCE challenge and an
   * exact-matched redirect URI. Stores the SHA-256 hash of the code (60s TTL).
   */
  async issueAuthCode(call: any, callback: any) {
    const { userId, clientId, redirectUri, codeChallenge, resource } = call.request;
    if (!userId || !clientId || !redirectUri || !codeChallenge) {
      return callback({ code: 3, message: 'user_id, client_id, redirect_uri, code_challenge required' });
    }
    try {
      const clientRes = await this.pool.query(
        'SELECT redirect_uris FROM identity.oauth_clients WHERE client_id = $1',
        [clientId]
      );
      if (clientRes.rows.length === 0) return callback({ code: 5, message: 'client not found' });
      const registered: string[] = clientRes.rows[0].redirect_uris ?? [];
      if (!registered.includes(redirectUri)) {
        return callback({ code: 3, message: 'redirect_uri does not match a registered uri' });
      }
      const rawCode = crypto.randomBytes(32).toString('hex');
      const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
      await this.pool.query(
        `INSERT INTO identity.oauth_auth_codes
           (code, client_id, user_id, redirect_uri, code_challenge, resource, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + interval '60 seconds')`,
        [codeHash, clientId, userId, redirectUri, codeChallenge, resource || null]
      );
      log.info('OAuth auth code issued', { clientId, userId });
      callback(null, { code: rawCode });
    } catch (err: any) {
      log.error('issueAuthCode failed', { error: err.message });
      callback({ code: 13, message: err.message });
    }
  }

  /**
   * ExchangeAuthCode — verify PKCE (S256), single-use + TTL + exact redirect/client match, then
   * mint an audience-bound access JWT and a rotating refresh token.
   */
  async exchangeAuthCode(call: any, callback: any) {
    const { code, codeVerifier, redirectUri, clientId, resource } = call.request;
    if (!code || !codeVerifier) {
      return callback({ code: 3, message: 'code and code_verifier required' });
    }
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    try {
      const result = await this.pool.query(
        `SELECT ac.client_id, ac.user_id, ac.redirect_uri, ac.code_challenge, ac.resource,
                ac.consumed_at, ac.expires_at, u.email, u.roles
         FROM identity.oauth_auth_codes ac
         JOIN identity.users u ON u.user_id = ac.user_id
         WHERE ac.code = $1`,
        [codeHash]
      );
      if (result.rows.length === 0) return callback({ code: 16, message: 'invalid_grant' });
      const row = result.rows[0];
      if (row.consumed_at !== null) return callback({ code: 16, message: 'invalid_grant' });
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        return callback({ code: 16, message: 'invalid_grant' });
      }
      if (row.redirect_uri !== redirectUri || row.client_id !== clientId) {
        return callback({ code: 16, message: 'invalid_grant' });
      }
      // PKCE S256: base64url(sha256(code_verifier)) === stored code_challenge
      const challenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      if (challenge !== row.code_challenge) {
        return callback({ code: 16, message: 'invalid_grant' });
      }
      // Single-use: consume the code.
      await this.pool.query(
        'UPDATE identity.oauth_auth_codes SET consumed_at = NOW() WHERE code = $1',
        [codeHash]
      );
      const audience = resource || row.resource || '';
      const { accessToken, expiresIn } = this.mintOAuthAccessToken(
        row.user_id, row.email, row.roles ?? [], audience,
      );
      const refreshToken = await this.issueRefreshToken(row.user_id, clientId);
      log.info('OAuth code exchanged', { clientId, userId: row.user_id });
      callback(null, { accessToken, tokenType: 'Bearer', expiresIn, refreshToken });
    } catch (err: any) {
      log.error('exchangeAuthCode failed', { error: err.message });
      callback({ code: 13, message: err.message });
    }
  }

  /**
   * RefreshOAuthToken — rotate the refresh token (revoke old, insert new) and mint a fresh
   * audience-bound access JWT. Mirrors refreshToken but returns the OAuthTokenResponse shape.
   */
  async refreshOAuthToken(call: any, callback: any) {
    const { refreshToken, resource } = call.request;
    if (!refreshToken) return callback({ code: 3, message: 'refresh_token required' });
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    try {
      const result = await this.pool.query(
        `SELECT rt.token_id, rt.user_id, rt.client_id, u.email, u.roles
         FROM identity.refresh_tokens rt
         JOIN identity.users u ON u.user_id = rt.user_id
         WHERE rt.token_hash = $1
           AND rt.revoked_at IS NULL
           AND rt.expires_at > NOW()
           AND u.is_active = true`,
        [tokenHash]
      );
      if (result.rows.length === 0) return callback({ code: 16, message: 'invalid_grant' });
      const { token_id, user_id, client_id, email, roles } = result.rows[0];
      // Best-effort "last refreshed" timestamp (feature 051) — bumped only on rotation,
      // surfaced by ListAuthorizedApps and labeled "Last refreshed" in the UI (NOT per-request access).
      await this.pool.query(
        'UPDATE identity.refresh_tokens SET last_used_at = NOW() WHERE token_id = $1',
        [token_id]
      );
      // Rotation: revoke the presented refresh token.
      await this.pool.query(
        'UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE token_id = $1',
        [token_id]
      );
      const { accessToken, expiresIn } = this.mintOAuthAccessToken(
        user_id, email, roles ?? [], resource || '',
      );
      // Carry the OAuth client_id forward so the rotated token stays listable/revocable.
      const newRefreshToken = await this.issueRefreshToken(user_id, client_id ?? undefined);
      log.info('OAuth token refreshed', { userId: user_id });
      callback(null, { accessToken, tokenType: 'Bearer', expiresIn, refreshToken: newRefreshToken });
    } catch (err: any) {
      log.error('refreshOAuthToken failed', { error: err.message });
      callback({ code: 13, message: err.message });
    }
  }

  // ── Authorized-apps management (feature 051) ──────────────────────────────

  /**
   * ListAuthorizedApps — the OAuth clients the calling user has active grants for, derived
   * from `identity.refresh_tokens` rows tagged with a `client_id` (JOIN `oauth_clients` for
   * name/redirects). Per-user scoped (WHERE rt.user_id = $1). Returns only non-sensitive
   * metadata — never token hashes or secrets (FR-7).
   */
  async listAuthorizedApps(call: any, callback: any) {
    const { userId } = call.request;
    if (!userId) return callback({ code: 3, message: 'userId required' });
    try {
      const result = await this.pool.query(
        `SELECT rt.client_id,
                oc.client_name,
                oc.redirect_uris,
                MIN(rt.created_at)   AS authorized_at,
                MAX(rt.last_used_at) AS last_used_at
         FROM identity.refresh_tokens rt
         JOIN identity.oauth_clients oc ON oc.client_id = rt.client_id
         WHERE rt.user_id = $1
           AND rt.client_id IS NOT NULL
           AND rt.revoked_at IS NULL
           AND rt.expires_at > NOW()
         GROUP BY rt.client_id, oc.client_name, oc.redirect_uris`,
        [userId]
      );
      callback(null, {
        apps: result.rows.map(r => ({
          clientId: r.client_id,
          clientName: r.client_name ?? r.client_id,
          authorizedAt: new Date(r.authorized_at),
          lastUsedAt: r.last_used_at ? new Date(r.last_used_at) : undefined,
          redirectUris: r.redirect_uris ?? [],
        })),
      });
    } catch (err: any) {
      log.error('listAuthorizedApps failed', { error: err.message });
      callback({ code: 13, message: err.message });
    }
  }

  /**
   * RevokeAuthorizedApp — revoke all of the calling user's active refresh tokens for one OAuth
   * client (invalidates the grant; access JWTs expire naturally). Scoped by BOTH user_id AND
   * client_id (IDOR-safe, mirrors revokeApiKey) — a forged/foreign client_id matches zero rows.
   */
  async revokeAuthorizedApp(call: any, callback: any) {
    const { userId, clientId } = call.request;
    if (!userId || !clientId) {
      return callback({ code: 3, message: 'userId and clientId required' });
    }
    try {
      await this.pool.query(
        `UPDATE identity.refresh_tokens SET revoked_at = NOW()
         WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NULL`,
        [userId, clientId]
      );
      log.info('Authorized app revoked', { userId, clientId });
      callback(null, { success: true });
    } catch (err: any) {
      log.error('revokeAuthorizedApp failed', { error: err.message });
      callback({ code: 13, message: err.message });
    }
  }
}
