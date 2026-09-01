/**
 * Unit tests for `hasSecretCallerAuthority` (feature 166 — mcp-client-signal-source).
 *
 * The GetSecret read-side allow-list. feature 147 seeded an exact-`keys` grant for marketdata;
 * this feature adds a `keyPrefixes` grant so xstockstrat-ingest can resolve its dynamic per-source
 * bearer secrets `ingest.mcp_credential.<slug>` (AC-3) without enumerating every slug — while the
 * fail-closed default (absent/unlisted caller, or a non-prefixed key) stays intact (PRESERVE
 * @AC-5 @feature-147). Pure-function layer; no live server.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import { HEADER_INTERNAL_CALLER, hasSecretCallerAuthority } from '../grpc/authz';

function mdWith(callerID: string): grpc.Metadata {
  const m = new grpc.Metadata();
  m.set(HEADER_INTERNAL_CALLER, callerID);
  return m;
}

describe('hasSecretCallerAuthority', () => {
  it('authorizes ingest for a mcp_credential.<slug> key via the keyPrefixes grant (AC-3)', () => {
    assert.equal(
      hasSecretCallerAuthority(mdWith('ingest'), 'ingest', 'mcp_credential.acme-mcp'),
      true,
    );
  });

  it('denies ingest a non-prefixed ingest key (cannot read arbitrary ingest keys as secrets)', () => {
    assert.equal(
      hasSecretCallerAuthority(mdWith('ingest'), 'ingest', 'backfill.max_concurrent_jobs'),
      false,
    );
  });

  it('denies a different caller the ingest secret prefix (cross-caller denied)', () => {
    assert.equal(
      hasSecretCallerAuthority(mdWith('marketdata'), 'ingest', 'mcp_credential.acme-mcp'),
      false,
    );
  });

  it('fails closed when no x-internal-caller header is present', () => {
    assert.equal(
      hasSecretCallerAuthority(new grpc.Metadata(), 'ingest', 'mcp_credential.acme-mcp'),
      false,
    );
  });

  it('preserves the marketdata exact-keys grant (feature 147 regression)', () => {
    assert.equal(
      hasSecretCallerAuthority(mdWith('marketdata'), 'marketdata', 'alpaca.api_key'),
      true,
    );
  });
});
