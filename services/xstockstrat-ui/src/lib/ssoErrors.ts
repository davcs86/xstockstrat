import { NextResponse } from 'next/server';
import { recordAuthEvent } from './bffMetrics';
import type { LinkRefusal, ResolveRefusal, SessionRefusal } from './ssoRefusals';
import { TXN_COOKIE_OPTS } from './ssoTxn';
import type { LinkErrorCode, SsoErrorCode } from './ssoErrorCodes';

export {
  LINK_ERROR_CODES,
  LINK_ERROR_MESSAGES,
  SSO_ERROR_CODES,
  SSO_ERROR_MESSAGES,
  type LinkErrorCode,
  type SsoErrorCode,
} from './ssoErrorCodes';

// Typed on the refusal mirror, so a new identity detail fails typecheck until it is mapped (D-123).
const RESOLVE_REFUSAL_CODES: Record<ResolveRefusal, SsoErrorCode> = {
  'not linked': 'not_linked',
  'account inactive': 'inactive',
  'sso disabled': 'failed',
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

const SESSION_REFUSAL_CODES: Record<SessionRefusal, SsoErrorCode> = {
  'account inactive': 'inactive',
  'sso disabled': 'failed',
};

export function sessionRefusalCode(detail: string): SsoErrorCode {
  return Object.hasOwn(SESSION_REFUSAL_CODES, detail)
    ? SESSION_REFUSAL_CODES[detail as SessionRefusal]
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
