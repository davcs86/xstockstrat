/**
 * Secret-at-rest encryption (AES-256-GCM). Wire layout `nonce(12) || ciphertext || authTag(16)`
 * must stay byte-compatible with the Go side (xstockstrat-trading's account_repo.go).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32; // AES-256
const ENV_KEY = 'CONFIG_SECRETS_ENCRYPTION_KEY';

/** Parse the master key from CONFIG_SECRETS_ENCRYPTION_KEY; throws unless it is 32 bytes of hex. */
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
