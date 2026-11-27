/**
 * Unit tests for `hasInternalCallerAuthority` (feature 102 — broker-state-reconciliation).
 *
 * `design.md` Open Risk #4: "a negative test asserting an internal-caller write of `ACTIVE`
 * is rejected must exist before this ships" — the single highest-stakes case here (case 3).
 * This is the pure-function layer; `internalCallerSetConfig.test.ts` (Step 8) is the paired
 * end-to-end loopback-gRPC layer proving the same direction restriction wired into the real
 * `setConfig` handler, mirroring `setConfigAuthz.test.ts`'s own two-layer split.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import { HEADER_INTERNAL_CALLER, hasInternalCallerAuthority } from '../grpc/authz';

function callWith(callerID: string, subjectaltname?: string) {
  const metadata = new grpc.Metadata();
  if (callerID) metadata.set(HEADER_INTERNAL_CALLER, callerID);
  return {
    metadata,
    getAuthContext: () => (subjectaltname === undefined ? {} : { sslPeerCertificate: { subjectaltname } }),
  };
}

const TRADING_SAN = 'DNS:xstockstrat-trading';

describe('hasInternalCallerAuthority', () => {
  it('authorizes the allow-listed caller for an allowed target value (REDUCE_ONLY)', () => {
    assert.equal(
      hasInternalCallerAuthority(
        callWith('trading-reconciliation-poller', TRADING_SAN),
        'platform',
        'trading_state',
        'REDUCE_ONLY',
      ),
      true,
    );
  });

  it('authorizes the same caller for a second allowed target value (HALTED)', () => {
    assert.equal(
      hasInternalCallerAuthority(
        callWith('trading-reconciliation-poller', TRADING_SAN),
        'platform',
        'trading_state',
        'HALTED',
      ),
      true,
    );
  });

  it('denies the same caller writing ACTIVE — direction restriction (Open Risk #4)', () => {
    assert.equal(
      hasInternalCallerAuthority(
        callWith('trading-reconciliation-poller', TRADING_SAN),
        'platform',
        'trading_state',
        'ACTIVE',
      ),
      false,
    );
  });

  it('denies an unlisted caller id even for an otherwise-allowed value', () => {
    assert.equal(
      hasInternalCallerAuthority(
        callWith('some-other-caller', TRADING_SAN),
        'platform',
        'trading_state',
        'HALTED',
      ),
      false,
    );
  });

  it('scopes the allow-list to (namespace, key), not just callerID', () => {
    assert.equal(
      hasInternalCallerAuthority(
        callWith('trading-reconciliation-poller', TRADING_SAN),
        'platform',
        'log_level',
        'HALTED',
      ),
      false,
    );
  });

  it('fails closed on absent metadata', () => {
    assert.equal(hasInternalCallerAuthority({}, 'platform', 'trading_state', 'HALTED'), false);
  });

  it('@AC-25 authorizes the bare `trading_state` key (exact match)', () => {
    assert.equal(
      hasInternalCallerAuthority(
        callWith('trading-reconciliation-poller', TRADING_SAN),
        'platform',
        'trading_state',
        'REDUCE_ONLY',
      ),
      true,
    );
  });

  it('306 @AC-3 denies the prefixed `platform.trading_state` spelling (exact key equality)', () => {
    assert.equal(
      hasInternalCallerAuthority(
        callWith('trading-reconciliation-poller', TRADING_SAN),
        'platform',
        'platform.trading_state',
        'REDUCE_ONLY',
      ),
      false,
    );
  });

  it('@AC-1 (319) denies the poller when the peer SAN is xstockstrat-notify', () => {
    assert.equal(
      hasInternalCallerAuthority(
        callWith('trading-reconciliation-poller', 'DNS:xstockstrat-notify'),
        'platform',
        'trading_state',
        'HALTED',
      ),
      false,
    );
  });

  it('fails closed when the call has no getAuthContext at all', () => {
    const { metadata } = callWith('trading-reconciliation-poller');
    assert.equal(hasInternalCallerAuthority({ metadata }, 'platform', 'trading_state', 'HALTED'), false);
  });

  it('fails closed when the peer presents no SAN', () => {
    assert.equal(
      hasInternalCallerAuthority(
        callWith('trading-reconciliation-poller'),
        'platform',
        'trading_state',
        'HALTED',
      ),
      false,
    );
  });

  it('authorizes when xstockstrat-trading appears anywhere in a comma-separated SAN list', () => {
    assert.equal(
      hasInternalCallerAuthority(
        callWith('trading-reconciliation-poller', 'DNS:localhost, IP Address:127.0.0.1, DNS:xstockstrat-trading'),
        'platform',
        'trading_state',
        'HALTED',
      ),
      true,
    );
  });
});
