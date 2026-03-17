import { Pool } from 'pg';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { ConfigWatcher } from '../services/configWatcher';
import { getLogger } from '../services/logger';

const log = getLogger('identity:impl');

export class IdentityServiceImpl {
  constructor(
    private readonly pool: Pool,
    private readonly config: ConfigWatcher,
  ) {}

  private get jwtSecret(): string {
    // Secret keys are not stored in config service — sourced from env only
    return process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production';
  }

  private get accessTtlSeconds(): number {
    return this.config.getInt('identity.jwt.access_ttl_seconds', 900);
  }

  private get refreshTtlSeconds(): number {
    return this.config.getInt('identity.jwt.refresh_ttl_seconds', 2592000);
  }

  /**
   * AuthenticateUser — validates credentials, returns JWT pair.
   * TODO: replace stub with real bcrypt password verification against identity.users table.
   */
  async authenticateUser(call: any, callback: any) {
    const { email, password } = call.request;
    if (!email || !password) {
      return callback({ code: 3, message: 'email and password required' });
    }
    try {
      const result = await this.pool.query(
        'SELECT user_id, password_hash, roles FROM identity.users WHERE email = $1',
        [email]
      );
      if (result.rows.length === 0) {
        return callback({ code: 16, message: 'invalid credentials' });
      }
      const user = result.rows[0];
      // TODO: bcrypt.compare(password, user.password_hash)
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        user_id: user.user_id,
        email,
        roles: user.roles ?? [],
        issued_at: { seconds: now },
        expires_at: { seconds: now + this.accessTtlSeconds },
      };
      // TODO: sign with jsonwebtoken using this.jwtSecret
      const accessToken = `stub.${Buffer.from(JSON.stringify(claims)).toString('base64')}.sig`;
      const refreshToken = uuidv4();
      callback(null, {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: { seconds: now + this.accessTtlSeconds },
        claims,
      });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  /**
   * ValidateToken — parses and validates JWT, returns claims.
   */
  async validateToken(call: any, callback: any) {
    const { token } = call.request;
    if (!token) return callback({ code: 3, message: 'token required' });
    try {
      // TODO: jsonwebtoken.verify(token, this.jwtSecret)
      const parts = token.split('.');
      if (parts.length < 2) return callback({ code: 16, message: 'invalid token' });
      const claims = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      callback(null, claims);
    } catch (err: any) {
      callback({ code: 16, message: 'invalid token' });
    }
  }

  async refreshToken(call: any, callback: any) {
    // TODO: validate refresh token against identity.refresh_tokens table
    callback({ code: 12, message: 'not implemented' });
  }

  async revokeToken(call: any, callback: any) {
    callback(null, { success: true });
  }

  async createApiKey(call: any, callback: any) {
    const { user_id, name, scopes } = call.request;
    const rawKey = `xss_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyId = uuidv4();
    const now = new Date();

    try {
      await this.pool.query(
        `INSERT INTO identity.api_keys (key_id, user_id, name, key_prefix, key_hash, scopes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [keyId, user_id, name, rawKey.slice(0, 8), keyHash, scopes ?? [], now]
      );
      log.info('API key created', { key_id: keyId, user_id });
      callback(null, {
        key_id: keyId,
        key_prefix: rawKey.slice(0, 8),
        user_id,
        name,
        scopes: scopes ?? [],
        created_at: { seconds: Math.floor(now.getTime() / 1000) },
      });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  async validateApiKey(call: any, callback: any) {
    const { api_key } = call.request;
    if (!api_key) return callback({ code: 3, message: 'api_key required' });
    const keyHash = crypto.createHash('sha256').update(api_key).digest('hex');
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
        user_id: r.user_id,
        email: r.email,
        roles: [...(r.roles ?? []), ...(r.scopes ?? [])],
        issued_at: { seconds: now },
        expires_at: { seconds: now + 3600 },
      });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  async listApiKeys(call: any, callback: any) {
    const { user_id } = call.request;
    try {
      const result = await this.pool.query(
        'SELECT key_id, key_prefix, user_id, name, scopes, created_at FROM identity.api_keys WHERE user_id = $1',
        [user_id]
      );
      callback(null, {
        keys: result.rows.map(r => ({
          key_id: r.key_id, key_prefix: r.key_prefix, user_id: r.user_id,
          name: r.name, scopes: r.scopes,
          created_at: { seconds: Math.floor(new Date(r.created_at).getTime() / 1000) },
        }))
      });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  async revokeApiKey(call: any, callback: any) {
    try {
      await this.pool.query('DELETE FROM identity.api_keys WHERE key_id = $1 AND user_id = $2',
        [call.request.key_id, call.request.user_id]);
      callback(null, { success: true });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }
}
