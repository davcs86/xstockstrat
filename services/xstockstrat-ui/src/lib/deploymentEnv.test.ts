import { describe, it, expect, afterEach } from 'vitest';
import { Environment } from '@xstockstrat/proto/common/v1/common_pb';
import { getNativeConfigEnv, isNativeConfigEnvironment } from './deploymentEnv';

const ORIGINAL_APPLICATION_ENV = process.env.APPLICATION_ENV;

afterEach(() => {
  if (ORIGINAL_APPLICATION_ENV === undefined) delete process.env.APPLICATION_ENV;
  else process.env.APPLICATION_ENV = ORIGINAL_APPLICATION_ENV;
});

describe('getNativeConfigEnv', () => {
  it('returns "production" only when APPLICATION_ENV is exactly "production"', () => {
    process.env.APPLICATION_ENV = 'production';
    expect(getNativeConfigEnv()).toBe('production');
  });

  it('normalizes "development" to "dev"', () => {
    process.env.APPLICATION_ENV = 'development';
    expect(getNativeConfigEnv()).toBe('dev');
  });

  it('falls back to "dev" when APPLICATION_ENV is unset', () => {
    delete process.env.APPLICATION_ENV;
    expect(getNativeConfigEnv()).toBe('dev');
  });
});

describe('isNativeConfigEnvironment', () => {
  it('matches DEV, not PRODUCTION, on a dev-native deployment', () => {
    process.env.APPLICATION_ENV = 'development';
    expect(isNativeConfigEnvironment(Environment.DEV)).toBe(true);
    expect(isNativeConfigEnvironment(Environment.PRODUCTION)).toBe(false);
  });

  it('matches PRODUCTION, not DEV, on a production-native deployment', () => {
    process.env.APPLICATION_ENV = 'production';
    expect(isNativeConfigEnvironment(Environment.PRODUCTION)).toBe(true);
    expect(isNativeConfigEnvironment(Environment.DEV)).toBe(false);
  });

  it('treats UNSPECIFIED as DEV on a dev-native deployment (matches)', () => {
    process.env.APPLICATION_ENV = 'development';
    expect(isNativeConfigEnvironment(Environment.UNSPECIFIED)).toBe(true);
  });

  it('treats UNSPECIFIED as DEV on a production-native deployment (does not match)', () => {
    process.env.APPLICATION_ENV = 'production';
    expect(isNativeConfigEnvironment(Environment.UNSPECIFIED)).toBe(false);
  });
});
