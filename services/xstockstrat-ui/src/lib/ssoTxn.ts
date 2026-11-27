import { createHash, hkdfSync } from 'node:crypto';
import { CompactEncrypt, compactDecrypt } from 'jose';
import type { NextRequest, NextResponse } from 'next/server';

// Encrypted (dir/A256GCM), never an HS256 JWS: verifyAccessToken accepts any JWT_SECRET JWS (R-7).
const TXN_TTL_S = 600;
const TXN_COOKIE_PREFIX = 'sso_txn_';
export const SSO_LINK_COOKIE = 'sso_link';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type SsoTxn =
  | {
      purpose: 'login';
      state: string;
      nonce: string;
      code_verifier: string;
      remember: boolean;
      redirect: string;
      exp: number;
    }
  | {
      purpose: 'link';
      state: string;
      nonce: string;
      code_verifier: string;
      user_id: string;
      created_at: number;
      exp: number;
    };

export type SsoLink = {
  link_id: string;
  iss: string;
  sub: string;
  label: string;
  user_id: string;
  exp: number;
};

const isProduction = process.env.NODE_ENV === 'production';

export const TXN_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProduction,
  path: '/api/auth/sso/callback',
  maxAge: TXN_TTL_S,
};

const nowS = () => Math.floor(Date.now() / 1000);

function key(info: 'xstockstrat-ui/sso-txn' | 'xstockstrat-ui/sso-link'): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return new Uint8Array(hkdfSync('sha256', secret, '', info, 32));
}

function seal(payload: object, info: Parameters<typeof key>[0]): Promise<string> {
  return new CompactEncrypt(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .encrypt(key(info));
}

// Local decrypt and exp check only; no network (D-135).
async function open<T extends { exp: number }>(
  jwe: string,
  info: Parameters<typeof key>[0],
): Promise<T | null> {
  try {
    const { plaintext } = await compactDecrypt(jwe, key(info), {
      keyManagementAlgorithms: ['dir'],
      contentEncryptionAlgorithms: ['A256GCM'],
    });
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as T;
    return typeof payload?.exp === 'number' && payload.exp >= nowS() ? payload : null;
  } catch {
    return null;
  }
}

export function sealSsoTxn(txn: DistributiveOmit<SsoTxn, 'exp' | 'created_at'>): Promise<string> {
  const now = nowS();
  const full = txn.purpose === 'link' ? { ...txn, created_at: now } : txn;
  return seal({ ...full, exp: now + TXN_TTL_S }, 'xstockstrat-ui/sso-txn');
}

export function openSsoTxn(jwe: string): Promise<SsoTxn | null> {
  return open<SsoTxn>(jwe, 'xstockstrat-ui/sso-txn');
}

export function txnCookieName(state: string): string {
  return `${TXN_COOKIE_PREFIX}${createHash('sha256').update(state).digest('hex').slice(0, 16)}`;
}

export function clearAllTxnCookies(req: NextRequest, res: NextResponse): void {
  for (const { name } of req.cookies.getAll()) {
    if (name.startsWith(TXN_COOKIE_PREFIX))
      res.cookies.set(name, '', { ...TXN_COOKIE_OPTS, maxAge: 0 });
  }
}

// exp is absolute (the txn's), so the cookie never outlives the link start + 600 s (D-107).
export function sealSsoLink(link: SsoLink): Promise<string> {
  return seal(link, 'xstockstrat-ui/sso-link');
}

export function openSsoLink(jwe: string): Promise<SsoLink | null> {
  return open<SsoLink>(jwe, 'xstockstrat-ui/sso-link');
}

export function ssoLinkCookieOpts(exp: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction,
    path: '/',
    maxAge: Math.max(0, exp - nowS()),
  };
}

export function clearSsoLink(res: NextResponse): void {
  res.cookies.set(SSO_LINK_COOKIE, '', { ...ssoLinkCookieOpts(0), maxAge: 0 });
}
