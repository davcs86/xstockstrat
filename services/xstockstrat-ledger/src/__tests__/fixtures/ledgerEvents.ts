// Canonical ledger event-row fixtures (C-13); catalogued in ./INVENTORY.md.

// makeEventRow produces DB-row shaped objects (snake_case from PostgreSQL columns)
export function makeEventRow(overrides: any = {}) {
  const now = new Date('2024-01-01T00:00:00Z');
  return {
    event_id: 'evt-1',
    event_type: 'order.filled',
    source_service: 'xstockstrat-trading',
    correlation_id: null,
    stream_key: 'order:1',
    payload: {},
    metadata: {},
    occurred_at: now,
    recorded_at: now,
    sequence: 1,
    ...overrides,
  };
}

// Serializes to exactly 8000 chars — over the trigger's 7000-char trim threshold.
export const LARGE_PAYLOAD = { blob: 'x'.repeat(8000 - '{"blob":""}'.length) };

export const TRIMMED_RECORDED_AT = '2026-10-21T12:00:00.123456+00:00';

// The trimmed NOTIFY body: exactly the trigger's stub keys, and no `payload` key.
export function toTrimmedStub(row: any, overrides: any = {}) {
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    stream_key: row.stream_key,
    sequence: row.sequence,
    recorded_at: TRIMMED_RECORDED_AT,
    ...overrides,
  };
}
