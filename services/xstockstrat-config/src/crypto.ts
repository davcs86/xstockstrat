/**
 * Secret-at-rest encryption for xstockstrat-config (feature 147).
 *
 * Ports the AES-256-GCM scheme used by xstockstrat-trading for broker-account credentials
 * (services/xstockstrat-trading/internal/repository/account_repo.go EncryptCredentials/
 * DecryptCredentials) so config secrets are stored the same way, with the same env-var-hex key
 * custody as BROKER_ACCOUNTS_ENCRYPTION_KEY. Wire layout is byte-compatible with the Go side:
 *
 *   nonce(12) || ciphertext || authTag(16)
 *
 * (Go's gcm.Seal(nonce, nonce, plaintext, nil) prepends the 12-byte nonce and appends the 16-byte
 * GCM tag; Node's cipher produces ciphertext then getAuthTag() separately, so we concatenate.)
 *
 * The master key is CONFIG_SECRETS_ENCRYPTION_KEY — a 64-hex-char (32-byte) string. It is a
 * bootstrap secret delivered as a type: SECRET env var (never itself stored in config). decrypt
 * throws on any GCM authentication failure (wrong key / corrupt bytes) so callers can distinguish a
 * decrypt failure from an unset secret — never returning a partial/garbage plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32; // AES-256
const ENV_KEY = 'CONFIG_SECRETS_ENCRYPTION_KEY';

/**
 * Parse and validate the master key from CONFIG_SECRETS_ENCRYPTION_KEY. Throws if the env var is
 * absent or not exactly 32 bytes of hex, so the service never silently encrypts with a zero/short
 * key. Called at boot (index.ts) to fail fast, and per-operation here.
 */
export function loadMasterKey(): Buffer {
  const hex = process.env[ENV_KEY];
  if (!hex) {
    throw new Error(`${ENV_KEY} is required (64 hex chars / 32 bytes) to encrypt config secrets`);
  }
  let key: Buffer;
  try {
    key = Buffer.from(hex, 'hex');
  } catch {
    throw new Error(`${ENV_KEY} must be valid hex`);
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(`${ENV_KEY} must decode to ${KEY_BYTES} bytes (got ${key.length})`);
  }
  return key;
}

/** Encrypt plaintext → nonce(12) || ciphertext || authTag(16). */
export function encryptSecret(plaintext: string, key: Buffer = loadMasterKey()): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]);
}

/**
 * Decrypt a buffer produced by encryptSecret. Throws on any authentication failure (wrong key,
 * corrupt/truncated bytes) — never returns a partial value.
 */
export function decryptSecret(blob: Buffer, key: Buffer = loadMasterKey()): string {
  if (blob.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error('ciphertext too short');
  }
  const nonce = blob.subarray(0, NONCE_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ciphertext = blob.subarray(NONCE_BYTES, blob.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
