import { describe, it, expect } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import { errMessage } from './errMessage';

describe('errMessage', () => {
  it('returns the raw message of a ConnectError (no "[code]" prefix)', () => {
    expect(errMessage(new ConnectError('boom', Code.Unavailable))).toBe('boom');
  });

  it('returns the message of a plain Error', () => {
    expect(errMessage(new Error('x'))).toBe('x');
  });
});
