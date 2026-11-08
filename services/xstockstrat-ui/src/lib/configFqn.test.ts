import { describe, expect, it } from 'vitest';
import { configFqn } from './configFqn';

describe('configFqn (feature 296)', () => {
  it('composes <namespace>.<key> from a namespace-relative key', () => {
    expect(configFqn('marketdata', 'backfill.batch_size')).toBe('marketdata.backfill.batch_size');
  });

  it('keeps an already-prefixed key unchanged, never ns.ns.key', () => {
    expect(configFqn('marketdata', 'marketdata.backfill.batch_size')).toBe(
      'marketdata.backfill.batch_size',
    );
  });

  it('only a full "<namespace>." prefix counts', () => {
    expect(configFqn('ingest', 'ingestion.rate')).toBe('ingest.ingestion.rate');
    expect(configFqn('platform', 'log_level')).toBe('platform.log_level');
  });
});
