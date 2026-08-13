import { describe, it, expect, afterEach } from 'vitest';
import { buildInternalRefreshUrl } from './auth';

const ORIGINAL_PORT = process.env.PORT;

afterEach(() => {
  if (ORIGINAL_PORT === undefined) delete process.env.PORT;
  else process.env.PORT = ORIGINAL_PORT;
});

describe('buildInternalRefreshUrl', () => {
  it('loops back over plain HTTP to 127.0.0.1, never the request origin', () => {
    delete process.env.PORT;
    const url = buildInternalRefreshUrl();
    expect(url.protocol).toBe('http:');
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.pathname).toBe('/api/auth/refresh');
  });

  it('defaults to port 3000 when PORT is unset (matches Dockerfile EXPOSE)', () => {
    delete process.env.PORT;
    expect(buildInternalRefreshUrl().port).toBe('3000');
  });

  it('honors PORT when the platform sets one', () => {
    process.env.PORT = '8080';
    expect(buildInternalRefreshUrl().port).toBe('8080');
  });
});
