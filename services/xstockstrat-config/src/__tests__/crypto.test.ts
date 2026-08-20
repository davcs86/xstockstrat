/**
 * AES-256-GCM secret encryption (feature 147). Mirrors xstockstrat-trading's broker-credential
 * scheme. Proves round-trip fidelity, that ciphertext never contains the plaintext, that tampering
 * is rejected (GCM auth), and that the master-key loader fails closed on a missing/short key.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// A deterministic 32-byte (64 hex) test key. Set before importing the module under test so the
// default-param loadMasterKey() calls resolve it.
const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

let encryptSecret: typeof import('../crypto').encryptSecret;
let decryptSecret: typeof import('../crypto').decryptSecret;
let loadMasterKey: typeof import('../crypto').loadMasterKey;

before(async () => {
  process.env.CONFIG_SECRETS_ENCRYPTION_KEY = TEST_KEY;
  const mod = await import('../crypto.js');
  encryptSecret = mod.encryptSecret;
  decryptSecret = mod.decryptSecret;
  loadMasterKey = mod.loadMasterKey;
});

describe('config secret crypto', () => {
  it('round-trips a plaintext through encrypt/decrypt', () => {
    const pt = 'fmp-live-abc123';
    const blob = encryptSecret(pt);
    assert.equal(decryptSecret(blob), pt);
  });

  it('never stores the plaintext in the ciphertext bytes (AC-1)', () => {
    const pt = 'fmp-live-abc123';
    const blob = encryptSecret(pt);
    assert.ok(!blob.toString('utf8').includes(pt), 'ciphertext must not contain the plaintext');
    assert.ok(!blob.toString('latin1').includes(pt), 'ciphertext must not contain the plaintext (latin1)');
  });

  it('produces a distinct ciphertext each call (random nonce)', () => {
    const a = encryptSecret('same-value');
    const b = encryptSecret('same-value');
    assert.notEqual(a.toString('hex'), b.toString('hex'), 'nonce reuse would make ciphertexts equal');
  });

  it('rejects a one-byte-tampered ciphertext (GCM auth)', () => {
    const blob = encryptSecret('secret');
    blob[blob.length - 1] ^= 0x01; // flip a tag bit
    assert.throws(() => decryptSecret(blob));
  });

  it('rejects a ciphertext decrypted with a different key', () => {
    const blob = encryptSecret('secret');
    const otherKey = Buffer.from('ff'.repeat(32), 'hex');
    assert.throws(() => decryptSecret(blob, otherKey));
  });

  it('rejects a too-short blob', () => {
    assert.throws(() => decryptSecret(Buffer.from([1, 2, 3])));
  });

  it('loadMasterKey fails closed on a missing key', () => {
    const saved = process.env.CONFIG_SECRETS_ENCRYPTION_KEY;
    delete process.env.CONFIG_SECRETS_ENCRYPTION_KEY;
    try {
      assert.throws(() => loadMasterKey(), /required/);
    } finally {
      process.env.CONFIG_SECRETS_ENCRYPTION_KEY = saved;
    }
  });

  it('loadMasterKey fails closed on a wrong-length key', () => {
    const saved = process.env.CONFIG_SECRETS_ENCRYPTION_KEY;
    process.env.CONFIG_SECRETS_ENCRYPTION_KEY = 'abcd'; // 2 bytes, not 32
    try {
      assert.throws(() => loadMasterKey(), /32 bytes/);
    } finally {
      process.env.CONFIG_SECRETS_ENCRYPTION_KEY = saved;
    }
  });
});
