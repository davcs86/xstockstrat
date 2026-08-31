import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getSessionFromRequest,
  ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS,
  generateTraceId,
  setSessionCookies,
  clearSessionCookies,
} from '@/lib/auth';
import { refreshSession } from '@/lib/identity';
import { HEADER_TRACE_ID } from '@/lib/headers';

export const config = {
  runtime: 'nodejs',
  matcher: [
    '/',
    // api/auth/refresh is excluded alongside login/health because it retains a LIVE browser
    // caller — src/lib/authRedirect.ts:40 (feature 153) POSTs to it with an expired/invalid
    // access token when a data call gets Unauthenticated. Matching it here would run the auth
    // gate on that already-expired cookie and redirect the browser's refresh POST to
    // /auth/login, regressing the durable @AC-5/@AC-6 guarantees (C-16). It is no longer a
    // middleware self-call — the near-expiry refresh below now runs in-process via
    // refreshSession(), never by fetching this route.
    // sw.js / manifest.webmanifest / icon-*.png (feature 165) are public PWA assets — they must be
    // served without the auth gate, or the service worker never registers and install fails.
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
    // Unified login page lives at the domain root, outside all basePaths.
    const loginUrl = new URL('/auth/login', req.url);
    loginUrl.searchParams.set('redirect', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  if (claims.expires_at - Math.floor(Date.now() / 1000) < ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS) {
    // In-process refresh: call the identity gRPC client directly (Node.js runtime) instead of
    // self-fetching /api/auth/refresh. Rotated cookies are set on the same response we return.
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
    setSessionCookies(response, result.accessToken, result.refreshToken);
    return response;
  }

  return NextResponse.next({
    request: {
      headers: new Headers({ ...Object.fromEntries(req.headers), [HEADER_TRACE_ID]: traceId }),
    },
  });
}
