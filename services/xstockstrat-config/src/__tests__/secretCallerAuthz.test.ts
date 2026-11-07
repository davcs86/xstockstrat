/**
 * Unit tests for `hasSecretCallerAuthority` (feature 166 — mcp-client-signal-source).
 *
 * The GetSecret read-side allow-list. feature 147 seeded an exact-`keys` grant for marketdata;
 * this feature adds a `keyPrefixes` grant so xstockstrat-ingest can resolve its dynamic per-source
 * bearer secrets `ingest.mcp_credential.<slug>` (AC-3) without enumerating every slug — while the
 * fail-closed default (absent/unlisted caller, or a non-prefixed key) stays intact (PRESERVE
 * @AC-5 @feature-147). Feature 224 binds the ingest grant to the mTLS peer SAN
 * `xstockstrat-ingest`. Pure-function layer; no live server.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import {
  HEADER_INTERNAL_CALLER,
  hasSecretCallerAuthority,
  secretDenialReason,
} from '../grpc/authz';

function callWith(callerID: string, subjectaltname?: string) {
  const metadata = new grpc.Metadata();
  if (callerID) metadata.set(HEADER_INTERNAL_CALLER, callerID);
  return {
    metadata,
    getAuthContext: () => (subjectaltname === undefined ? {} : { sslPeerCertificate: { subjectaltname } }),
  };
}

const INGEST_SAN = 'DNS:xstockstrat-ingest';

describe('hasSecretCallerAuthority', () => {
  it('authorizes ingest for a mcp_credential.<slug> key via the keyPrefixes grant (AC-3)', () => {
    assert.equal(
      hasSecretCallerAuthority(callWith('ingest', INGEST_SAN), 'ingest', 'mcp_credential.acme-mcp'),
      true,
    );
  });

  it('denies ingest a non-prefixed ingest key (cannot read arbitrary ingest keys as secrets)', () => {
    assert.equal(
      hasSecretCallerAuthority(callWith('ingest', INGEST_SAN), 'ingest', 'backfill.max_concurrent_jobs'),
      false,
    );
  });

  it('denies a different caller the ingest secret prefix (cross-caller denied)', () => {
    assert.equal(
      hasSecretCallerAuthority(callWith('marketdata', INGEST_SAN), 'ingest', 'mcp_credential.acme-mcp'),
      false,
    );
  });

  it('fails closed when no x-internal-caller header is present', () => {
    assert.equal(
      hasSecretCallerAuthority(callWith('', INGEST_SAN), 'ingest', 'mcp_credential.acme-mcp'),
      false,
    );
  });

  it('preserves the marketdata exact-keys grant (feature 147 regression)', () => {
    assert.equal(
      hasSecretCallerAuthority(callWith('marketdata', 'DNS:xstockstrat-marketdata'), 'marketdata', 'alpaca.api_key'),
      true,
    );
  });

  it('accepts the ingest SAN anywhere in a comma-separated subjectaltname list', () => {
    assert.equal(
      hasSecretCallerAuthority(
        callWith('ingest', 'DNS:other.internal, IP Address:10.0.0.1, DNS:xstockstrat-ingest'),
        'ingest',
        'mcp_credential.acme-mcp',
      ),
      true,
    );
  });

  it('denies ingest when the peer SAN is another service, a near-miss, or absent', () => {
    for (const san of ['DNS:xstockstrat-client', 'DNS:xstockstrat-ingest-evil', 'xstockstrat-ingest', undefined]) {
      assert.equal(
        hasSecretCallerAuthority(callWith('ingest', san), 'ingest', 'mcp_credential.acme-mcp'),
        false,
        `SAN ${san} must be denied`,
      );
    }
  });

  it('denies ingest when the call exposes no getAuthContext at all (fail closed)', () => {
    const { metadata } = callWith('ingest');
    assert.equal(hasSecretCallerAuthority({ metadata }, 'ingest', 'mcp_credential.acme-mcp'), false);
  });
});

describe('secretDenialReason parity with hasSecretCallerAuthority', () => {
  // Every combination of the allow-list's callers, namespaces, keys and peer SANs, plus misses.
  const callers = ['marketdata', 'ingest', 'notify', ''];
  const namespaces = ['marketdata', 'ingest'];
  const keys = [
    'alpaca.api_key',
    'fmp.api_key',
    'mcp_credential.acme-mcp',
    'backfill.max_concurrent_jobs',
  ];
  const sans = [
    undefined,
    'DNS:xstockstrat-marketdata',
    INGEST_SAN,
    'DNS:xstockstrat-ingest-evil',
    'DNS:other.internal, IP Address:10.0.0.1, DNS:xstockstrat-ingest',
  ];

  it('returns a reason exactly when the gate denies, across every grant combination', () => {
    const seen = new Set<string | null>();
    for (const caller of callers) {
      for (const ns of namespaces) {
        for (const key of keys) {
          for (const san of sans) {
            const call = callWith(caller, san);
            const reason = secretDenialReason(call, ns, key);
            seen.add(reason);
            assert.equal(
              reason !== null,
              !hasSecretCallerAuthority(call, ns, key),
              `caller=${caller} ns=${ns} key=${key} san=${san} reason=${reason}`,
            );
          }
        }
      }
    }
    // The sweep reaches every branch, so the parity above is not vacuous.
    assert.deepEqual(
      [...seen].sort(),
      ['key_not_granted', 'no_caller_header', 'peer_san_mismatch', 'unknown_caller', null].sort(),
    );
  });

  it('agrees with the gate when the call exposes no getAuthContext', () => {
    const { metadata } = callWith('ingest');
    assert.equal(
      secretDenialReason({ metadata }, 'ingest', 'mcp_credential.acme-mcp'),
      'peer_san_mismatch',
    );
    assert.equal(
      hasSecretCallerAuthority({ metadata }, 'ingest', 'mcp_credential.acme-mcp'),
      false,
    );
  });
});
