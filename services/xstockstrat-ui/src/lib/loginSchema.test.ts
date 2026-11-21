import { describe, expect, it } from 'vitest';
import { credentialsSchema } from './loginSchema';

const parse = (email: string) =>
  credentialsSchema.safeParse({ email, password: 'pw', rememberMe: false });

describe('credentialsSchema email', () => {
  it.each(['admin@localhost', 'user@example.com', 'a.b+c@sub.example.co'])(
    'accepts %s',
    (email) => {
      expect(parse(email).success).toBe(true);
    },
  );

  it.each(['', 'plain', 'a@', '@localhost', 'a b@localhost'])('rejects %j', (email) => {
    const r = parse(email);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe('Enter a valid email address');
  });

  it('requires a password', () => {
    const r = credentialsSchema.safeParse({
      email: 'a@localhost',
      password: '',
      rememberMe: false,
    });
    expect(r.success).toBe(false);
  });
});
