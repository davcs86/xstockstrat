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

  async createApiKey(call: any, callback: any) {
    const { userId, name, scopes } = call.request;
    const rawKey = `xss_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyId = uuidv4();
    const now = new Date();

    try {
      await this.pool.query(
        `INSERT INTO identity.api_keys (key_id, user_id, name, key_prefix, key_hash, scopes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [keyId, userId, name, rawKey.slice(0, 8), keyHash, scopes ?? [], now]
      );
      log.info('API key created', { keyId, userId });
      callback(null, {
        keyId,
        keyPrefix: rawKey.slice(0, 8),
        userId,
        name,
        scopes: scopes ?? [],
        createdAt: now,
      });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  async validateApiKey(call: any, callback: any) {
    const { apiKey } = call.request;
    if (!apiKey) return callback({ code: 3, message: 'apiKey required' });
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    try {
      const result = await this.pool.query(
        `SELECT k.user_id, k.scopes, u.email, u.roles
         FROM identity.api_keys k
         JOIN identity.users u ON u.user_id = k.user_id
         WHERE k.key_hash = $1 AND (k.expires_at IS NULL OR k.expires_at > NOW())`,
        [keyHash]
      );
      if (result.rows.length === 0) return callback({ code: 16, message: 'invalid api key' });
      const r = result.rows[0];
      const now = Math.floor(Date.now() / 1000);
      callback(null, {
        userId: r.user_id,
        email: r.email,
        roles: [...(r.roles ?? []), ...(r.scopes ?? [])],
        issuedAt: secondsToDate(now),
        expiresAt: secondsToDate(now + 3600),
      });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  async listApiKeys(call: any, callback: any) {
    const { userId } = call.request;
    try {
      const result = await this.pool.query(
        'SELECT key_id, key_prefix, user_id, name, scopes, created_at FROM identity.api_keys WHERE user_id = $1',
        [userId]
      );
      callback(null, {
        keys: result.rows.map(r => ({
          keyId: r.key_id,
          keyPrefix: r.key_prefix,
          userId: r.user_id,
          name: r.name,
          scopes: r.scopes,
          createdAt: new Date(r.created_at),
        }))
      });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  async revokeApiKey(call: any, callback: any) {
    try {
      await this.pool.query('DELETE FROM identity.api_keys WHERE key_id = $1 AND user_id = $2',
        [call.request.keyId, call.request.userId]);
      callback(null, { success: true });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }
}
