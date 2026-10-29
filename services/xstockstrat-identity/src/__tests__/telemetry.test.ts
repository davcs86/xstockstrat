import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResource } from '../telemetry';

// Feature 171 — the built OTel Resource must omit the removed trading_mode attribute.
test('built Resource omits trading_mode, keeps the trio', () => {
  process.env.TRADING_MODE = 'paper';
  const attrs = buildResource().attributes as Record<string, unknown>;
  assert.equal('trading_mode' in attrs, false);
  assert.ok(attrs['service.name']);
  assert.ok('deployment.environment' in attrs);
  assert.equal(attrs['platform'], 'xstockstrat');
});
