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

  it('normalizes "development" to "staging" (feature 147)', () => {
    process.env.APPLICATION_ENV = 'development';
    expect(getNativeConfigEnv()).toBe('staging');
  });

  it('falls back to "staging" when APPLICATION_ENV is unset', () => {
    delete process.env.APPLICATION_ENV;
    expect(getNativeConfigEnv()).toBe('staging');
  });
});

describe('isNativeConfigEnvironment', () => {
  it('matches STAGING (and the deprecated DEV), not PRODUCTION, on a staging-native deployment', () => {
    process.env.APPLICATION_ENV = 'development';
    expect(isNativeConfigEnvironment(Environment.STAGING)).toBe(true);
    expect(isNativeConfigEnvironment(Environment.DEV)).toBe(true); // DEV maps to staging (feature 147)
    expect(isNativeConfigEnvironment(Environment.PRODUCTION)).toBe(false);
  });

  it('matches PRODUCTION, not STAGING, on a production-native deployment', () => {
    process.env.APPLICATION_ENV = 'production';
    expect(isNativeConfigEnvironment(Environment.PRODUCTION)).toBe(true);
    expect(isNativeConfigEnvironment(Environment.STAGING)).toBe(false);
  });

  it('treats UNSPECIFIED as STAGING on a staging-native deployment (matches)', () => {
    process.env.APPLICATION_ENV = 'development';
    expect(isNativeConfigEnvironment(Environment.UNSPECIFIED)).toBe(true);
  });

  it('treats UNSPECIFIED as STAGING on a production-native deployment (does not match)', () => {
    process.env.APPLICATION_ENV = 'production';
    expect(isNativeConfigEnvironment(Environment.UNSPECIFIED)).toBe(false);
  });
});
