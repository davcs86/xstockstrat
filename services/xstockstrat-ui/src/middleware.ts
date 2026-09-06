import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getSessionFromRequest,
  ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS,
  generateTraceId,
  setSessionCookies,
  clearSessionCookies,
  rememberMeOptsFromRequest,
} from '@/lib/auth';
import { refreshSession } from '@/lib/identity';
import { HEADER_TRACE_ID } from '@/lib/headers';

export const config = {
  runtime: 'nodejs',
  matcher: [
    '/',
    // api/auth/refresh must stay excluded: a live browser caller (authRedirect.ts) POSTs an
    // expired token to it, and matching it here would redirect that refresh POST to /auth/login.
    // sw.js / manifest.webmanifest / icon-*.png are public PWA assets — must bypass the auth gate,
    // or the service worker never registers.
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|sw.js|manifest.webmanifest|icon-192.png|icon-512.png|icon-512-maskable.png|api/auth/login|api/auth/refresh|api/health|health|auth/login|auth/oauth-login|\\.well-known|api/oauth).+)',
  ],
};

export async function middleware(req: NextRequest) {
  const claims = await getSessionFromRequest(req);

  const traceId = req.headers.get(HEADER_TRACE_ID) ?? generateTraceId();

  if (!claims) {
    if (req.nextUrl.pathname === '/auth/login' || req.nextUrl.pathname === '/auth/oauth-login') {
      return NextResponse.next();
    }

    // Expired/missing access token: attempt refresh before redirecting — the refresh token
    // outlives the access TTL and the client-side interceptor cannot catch a server-side 307.
    const refreshToken = req.cookies.get('refresh_token')?.value;
    if (refreshToken) {
      const result = await refreshSession(refreshToken);
      if (result) {
        const response = NextResponse.next({
          request: {
            headers: new Headers({
              ...Object.fromEntries(req.headers),
              [HEADER_TRACE_ID]: traceId,
            }),
          },
        });
        setSessionCookies(
          response,
          result.accessToken,
          result.refreshToken,
          rememberMeOptsFromRequest(req),
        );
        return response;
      }
      // Refresh failed (token revoked/expired) — clear stale cookies before redirecting.
      const loginUrl = new URL('/auth/login', req.url);
      loginUrl.searchParams.set('redirect', req.nextUrl.pathname + req.nextUrl.search);
      const res = NextResponse.redirect(loginUrl);
      clearSessionCookies(res);
      return res;
    }

    // No refresh token at all — redirect to login.
    const loginUrl = new URL('/auth/login', req.url);
    loginUrl.searchParams.set('redirect', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  if (claims.expires_at - Math.floor(Date.now() / 1000) < ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS) {
    // In-process refresh via the identity client (Node runtime), not a self-fetch to
    // /api/auth/refresh; rotated cookies are set on the same response.
    const refreshToken = req.cookies.get('refresh_token')?.value;
    const result = refreshToken ? await refreshSession(refreshToken) : null;
    if (!result) {
      const loginUrl = new URL('/auth/login', req.url);
      loginUrl.searchParams.set('redirect', req.nextUrl.pathname + req.nextUrl.search);
      const res = NextResponse.redirect(loginUrl);
      clearSessionCookies(res);
      return res;
    }
    const response = NextResponse.next({
      request: {
        headers: new Headers({ ...Object.fromEntries(req.headers), [HEADER_TRACE_ID]: traceId }),
      },
    });
    // Preserve "Remember me" persistence across rotation — keep the rolling Max-Age, don't
    // downgrade to a session cookie.
    setSessionCookies(
      response,
      result.accessToken,
      result.refreshToken,
      rememberMeOptsFromRequest(req),
    );
    return response;
  }

  return NextResponse.next({
    request: {
      headers: new Headers({ ...Object.fromEntries(req.headers), [HEADER_TRACE_ID]: traceId }),
    },
  });
}
