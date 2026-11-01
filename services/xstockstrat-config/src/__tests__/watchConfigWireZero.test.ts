/**
 * A stored 0 / 0.0 / '' survives the WatchConfig wire on both the SNAPSHOT and the DELTA leg
 * (feature 244 @AC-10): the Python readers honour a stored zero only if the stream still carries it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceDefinition } from '../grpc/serviceDefinition';

const ZERO_ROWS = [
  { key: 'analysis.test.zero_int', value_type: 'int', value_data: '0' },
  { key: 'analysis.test.zero_float', value_type: 'float', value_data: '0' },
  { key: 'analysis.test.zero_string', value_type: 'string', value_data: '' },
].map((r) => ({
  namespace: 'analysis',
  ...r,
  is_secret: false,
  description: 'stored-zero wire test',
  default_value: '',
  environment: 'production',
}));

function overTheWire(payload: unknown): any {
  const method = createConfigServiceDefinition().watchConfig;
  return method.responseDeserialize(method.responseSerialize(payload as any));
}

function assertZeros(d: any, leg: string) {
  const intVal = d.values['analysis.test.zero_int']?.intVal;
  assert.notEqual(intVal, undefined, `${leg}: zero_int must carry intVal`);
  assert.equal(intVal, 0, `${leg}: zero_int`);
  const floatVal = d.values['analysis.test.zero_float']?.floatVal;
  assert.notEqual(floatVal, undefined, `${leg}: zero_float must carry floatVal`);
  assert.equal(floatVal, 0, `${leg}: zero_float`);
  const stringVal = d.values['analysis.test.zero_string']?.stringVal;
  assert.notEqual(stringVal, undefined, `${leg}: zero_string must carry stringVal`);
  assert.equal(stringVal, '', `${leg}: zero_string`);
}

describe('WatchConfig wire carries stored zeros — @AC-10', () => {
  it('a stored 0, 0.0 and "" survive serialization on SNAPSHOT and DELTA', async () => {
    const pool: any = {
      query: async () => ({ rows: ZERO_ROWS }),
      connect: async () => ({ query: async () => {}, on: () => {} }),
    };
    const impl: any = new ConfigServiceImpl(pool);
    await impl.reloadNamespace('analysis', 'production');

    const writes: any[] = [];
    const fakeCall: any = {
      request: { namespace: 'analysis', client_id: 'c', environment: 2 }, // ENVIRONMENT_PRODUCTION, global
      on: () => {},
      write: (p: any) => writes.push(p),
    };
    impl.watchConfig(fakeCall);
    await new Promise((r) => setTimeout(r, 20)); // SNAPSHOT write + subscriber registration are async
    assert.equal(
      writes.length,
      1,
      'the subscriber must receive the initial SNAPSHOT and be registered',
    );

    await impl.broadcastToSubscribers('analysis', 'production');
    assert.equal(writes.length, 2, 'the registered subscriber must receive the DELTA');

    assertZeros(overTheWire(writes[0]), 'SNAPSHOT');
    assertZeros(overTheWire(writes[1]), 'DELTA');
  });
});
