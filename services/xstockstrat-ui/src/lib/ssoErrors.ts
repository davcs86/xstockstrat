import { NextResponse } from 'next/server';
import { recordAuthEvent } from './bffMetrics';
import type { LinkRefusal, ResolveRefusal } from './ssoRefusals';
import { TXN_COOKIE_OPTS } from './ssoTxn';

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

// Typed on the refusal mirror, so a new identity detail fails typecheck until it is mapped (D-123).
const RESOLVE_REFUSAL_CODES: Record<ResolveRefusal, SsoErrorCode> = {
  'not linked': 'not_linked',
  'account inactive': 'inactive',
};
const LINK_REFUSAL_CODES: Record<LinkRefusal, LinkErrorCode> = {
  'invalid credentials': 'invalid_credentials',
  'account inactive': 'inactive',
  'account already linked': 'already_linked_other',
  'already linked to this issuer': 'already_linked_self',
  'link disabled': 'failed',
};

export function resolveRefusalCode(detail: string): SsoErrorCode {
  return Object.hasOwn(RESOLVE_REFUSAL_CODES, detail)
    ? RESOLVE_REFUSAL_CODES[detail as ResolveRefusal]
    : 'failed';
}

export function linkRefusalCode(detail: string): LinkErrorCode | null {
  return Object.hasOwn(LINK_REFUSAL_CODES, detail)
    ? LINK_REFUSAL_CODES[detail as LinkRefusal]
    : null;
}

// The only place that records sso_login_failed / sso_login_error / sso_link_failed (spec-level choice 6).
export function ssoErrorRedirect(
  target: { dest: 'login'; code: SsoErrorCode } | { dest: 'link'; code: LinkErrorCode },
  appOrigin: string | null,
  opts: { fault?: boolean; clearTxnCookie?: string } = {},
): NextResponse {
  if (target.dest === 'login') {
    if (opts.fault) recordAuthEvent('sso_login_error');
    else recordAuthEvent('sso_login_failed', target.code);
  } else {
    recordAuthEvent('sso_link_failed', target.code);
  }
  const path = `${target.dest === 'login' ? '/auth/login' : '/accounts/sso'}?error=${target.code}`;
  // Relative only when APP_URL is invalid (D-82, D-131).
  const location = appOrigin ? new URL(path, appOrigin).href : path;
  const res = new NextResponse(null, { status: 303, headers: { location } });
  if (opts.clearTxnCookie) {
    res.cookies.set(opts.clearTxnCookie, '', { ...TXN_COOKIE_OPTS, maxAge: 0 });
  }
  return res;
}
