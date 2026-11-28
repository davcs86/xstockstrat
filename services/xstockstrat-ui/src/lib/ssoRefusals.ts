// Must equal identity's EXTERNAL_IDENTITY_REFUSALS and the vector file's `refusals` (D-123).
export const SSO_REFUSALS = {
  resolve: ['not linked', 'account inactive', 'sso disabled'],
  link: [
    'invalid credentials',
    'account inactive',
    'account already linked',
    'already linked to this issuer',
    'link disabled',
  ],
  session: ['account inactive', 'sso disabled'],
} as const;

export type ResolveRefusal = (typeof SSO_REFUSALS.resolve)[number];
export type LinkRefusal = (typeof SSO_REFUSALS.link)[number];
export type SessionRefusal = (typeof SSO_REFUSALS.session)[number];
