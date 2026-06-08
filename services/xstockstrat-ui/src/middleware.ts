import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getSessionFromRequest,
  ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS,
  generateTraceId,
} from '@/lib/auth';

export const config = {
  matcher: [
    '/',
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|api/auth/login|api/health|health|auth/login|auth/oauth-login|\\.well-known|api/oauth).+)',
  ],
};

export async function middleware(req: NextRequest) {
  const claims = await getSessionFromRequest(req);

  const traceId = req.headers.get('x-trace-id') ?? generateTraceId();

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
    const refreshUrl = new URL('/api/auth/refresh', req.url);
    const refreshRes = await fetch(refreshUrl, {
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
      headers: new Headers({ ...Object.fromEntries(req.headers), 'x-trace-id': traceId }),
    },
  });
}
