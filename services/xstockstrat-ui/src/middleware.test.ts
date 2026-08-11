import { describe, it, expect } from 'vitest';
import { config } from './middleware';

// The negative-lookahead matcher pattern is the second entry (the first, '/', is a literal).
function matches(pathname: string): boolean {
  const pattern = config.matcher[1] as string;
  return new RegExp(`^${pattern}$`).test(pathname);
}

describe('middleware matcher', () => {
  it('excludes api/auth/refresh — it is an internal-only call made by this middleware, never the browser', () => {
    expect(matches('/api/auth/refresh')).toBe(false);
  });

  it('still excludes the sibling auth/health paths', () => {
    expect(matches('/api/auth/login')).toBe(false);
    expect(matches('/api/health')).toBe(false);
    expect(matches('/auth/login')).toBe(false);
  });

  it('still matches a protected app route', () => {
    expect(matches('/trader/positions')).toBe(true);
  });
});
