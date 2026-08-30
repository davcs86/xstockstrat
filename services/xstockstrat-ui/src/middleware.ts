import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getSessionFromRequest,
  ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS,
  generateTraceId,
  buildInternalRefreshUrl,
} from '@/lib/auth';
import { HEADER_TRACE_ID } from '@/lib/headers';

export const config = {
  matcher: [
    '/',
    // api/auth/refresh is excluded alongside login/health: it is called only by this
    // middleware's own near-expiry refresh below, never by the browser. Without the
    // exclusion, that self-call re-enters the auth gate on the still-not-yet-refreshed
    // cookie, which is still within the refresh threshold, triggering another self-call.
    // sw.js / manifest.webmanifest / icon-*.png (feature 163) are public PWA assets — they must be
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
    const refreshRes = await fetch(buildInternalRefreshUrl(), {
      method: 'POST',
      headers: { cookie: req.headers.get('cookie') ?? '' },
    });
    if (!refreshRes.ok) {
      const loginUrl = new URL('/auth/login', req.url);
      loginUrl.searchParams.set('redirect', req.nextUrl.pathname + req.nextUrl.search);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next({
    request: {
      headers: new Headers({ ...Object.fromEntries(req.headers), [HEADER_TRACE_ID]: traceId }),
    },
  });
}
