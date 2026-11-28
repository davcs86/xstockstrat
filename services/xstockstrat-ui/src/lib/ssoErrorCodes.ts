// Client-safe: no server-only imports, so 'use client' pages can read the codes and messages.
export const SSO_ERROR_CODES = [
  'failed',
  'not_configured',
  'not_linked',
  'inactive',
  'no_access',
] as const;
export type SsoErrorCode = (typeof SSO_ERROR_CODES)[number];

export const LINK_ERROR_CODES = [
  'failed',
  'not_configured',
  'no_access',
  'invalid_credentials',
  'inactive',
  'already_linked_other',
  'already_linked_self',
] as const;
export type LinkErrorCode = (typeof LINK_ERROR_CODES)[number];

const FAILED = 'Sign-in failed. Try again.';
const NOT_CONFIGURED = 'SSO not configured';
const INACTIVE = 'This account is disabled. Ask an admin.';
const NOT_LINKED = "Your single sign-on account isn't linked to an xstockstrat account.";

export const SSO_ERROR_MESSAGES = {
  failed: FAILED,
  not_configured: NOT_CONFIGURED,
  not_linked: {
    both: `${NOT_LINKED} Sign in with your password and choose Link SSO, or ask an admin.`,
    oidc: `${NOT_LINKED} Ask an admin.`,
  },
  inactive: INACTIVE,
  no_access: "You don't have access to xstockstrat. Ask an admin.",
} as const satisfies Record<SsoErrorCode, string | { both: string; oidc: string }>;

export const LINK_ERROR_MESSAGES: Record<LinkErrorCode, string> = {
  failed: FAILED,
  not_configured: NOT_CONFIGURED,
  no_access: "Your single sign-on account doesn't have access to xstockstrat. Ask an admin.",
  invalid_credentials: 'Incorrect password.',
  inactive: INACTIVE,
  already_linked_other: 'This sign-in is already linked to another account. Ask an admin.',
  already_linked_self:
    'This account is already linked to a single sign-on account. Ask an admin to unlink it first.',
};
