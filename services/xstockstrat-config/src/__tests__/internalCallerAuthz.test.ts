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

function mdWith(callerID: string): grpc.Metadata {
  const m = new grpc.Metadata();
  m.set(HEADER_INTERNAL_CALLER, callerID);
  return m;
}

describe('hasInternalCallerAuthority', () => {
  it('authorizes the allow-listed caller for an allowed target value (REDUCE_ONLY)', () => {
    assert.equal(
      hasInternalCallerAuthority(
        mdWith('trading-reconciliation-poller'),
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
        mdWith('trading-reconciliation-poller'),
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
        mdWith('trading-reconciliation-poller'),
        'platform',
        'trading_state',
        'ACTIVE',
      ),
      false,
    );
  });

  it('denies an unlisted caller id even for an otherwise-allowed value', () => {
    assert.equal(
      hasInternalCallerAuthority(mdWith('some-other-caller'), 'platform', 'trading_state', 'HALTED'),
      false,
    );
  });

  it('scopes the allow-list to (namespace, key), not just callerID', () => {
    assert.equal(
      hasInternalCallerAuthority(
        mdWith('trading-reconciliation-poller'),
        'platform',
        'log_level',
        'HALTED',
      ),
      false,
    );
  });

  it('fails closed on absent metadata', () => {
    assert.equal(hasInternalCallerAuthority(undefined, 'platform', 'trading_state', 'HALTED'), false);
  });
});
