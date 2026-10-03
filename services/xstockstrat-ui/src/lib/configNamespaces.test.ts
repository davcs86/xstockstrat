import { describe, expect, it } from 'vitest';
import { configUiHref } from './configNamespaces';

describe('configUiHref', () => {
  it('keeps env and omits an empty user', () => {
    expect(configUiHref('/config-ui', 'staging', '')).toBe('/config-ui?env=staging');
  });

  it('carries the per-user scope and keeps the namespace path', () => {
    expect(configUiHref('/config-ui/marketdata', 'production', 'test-user-001')).toBe(
      '/config-ui/marketdata?env=production&user=test-user-001',
    );
  });

  it('url-encodes the user id', () => {
    expect(configUiHref('/config-ui', 'staging', 'a b&c')).toBe(
      '/config-ui?env=staging&user=a+b%26c',
    );
  });
});
